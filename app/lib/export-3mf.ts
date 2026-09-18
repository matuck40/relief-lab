import type { ReliefModel } from "./relief-model";

const encoder = new TextEncoder();

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function little(value: number, bytes: number) {
  return Array.from({ length: bytes }, (_, index) => (value >>> (index * 8)) & 0xff);
}

function join(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => { result.set(chunk, offset); offset += chunk.length; });
  return result;
}

function displayColor(value: string) {
  const hex = value.replace(/^#/, "").toUpperCase();
  return `#${/^[0-9A-F]{6}$/.test(hex) ? hex : "808080"}FF`;
}

export function validateReliefModel(model: ReliefModel) {
  if (!model.parts.length) throw new Error("O modelo não contém sólidos para exportar.");

  model.parts.forEach((part) => {
    const meshes = part.components?.length ? part.components : [part];
    meshes.forEach((mesh) => {
      if (mesh.vertices.length < 4 || mesh.triangles.length < 4) {
        throw new Error(`O sólido ${part.name} não contém uma malha fechada.`);
      }
      if (mesh.vertices.some((vertex) => vertex.length !== 3 || vertex.some((value) => !Number.isFinite(value)))) {
        throw new Error(`O sólido ${part.name} contém coordenadas inválidas.`);
      }

      mesh.triangles.forEach((triangle) => {
        if (
          triangle.length !== 3 ||
          new Set(triangle).size !== 3 ||
          triangle.some((index) => !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length)
        ) throw new Error(`O sólido ${part.name} contém faces inválidas.`);
      });
    });
  });
}

export function inspectReliefTopology(model: ReliefModel) {
  let irregularEdgeCount = 0;
  let affectedPartCount = 0;
  model.parts.forEach((part) => {
    let partHasIrregularEdges = false;
    const meshes = part.components?.length ? part.components : [part];
    meshes.forEach((mesh) => {
      const edges = new Map<string, number>();
      mesh.triangles.forEach(([v1, v2, v3]) => {
        [[v1, v2], [v2, v3], [v3, v1]].forEach(([a, b]) => {
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        });
      });
      const meshIrregularEdges = [...edges.values()].filter((count) => count !== 2).length;
      if (meshIrregularEdges) partHasIrregularEdges = true;
      irregularEdgeCount += meshIrregularEdges;
    });
    if (partHasIrregularEdges) affectedPartCount += 1;
  });
  return { irregularEdgeCount, affectedPartCount };
}

function zipStore(files: Record<string, string>) {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const localHeader = new Uint8Array([
      ...little(0x04034b50, 4), ...little(20, 2), ...little(0, 2), ...little(0, 2),
      ...little(0, 2), ...little(0, 2), ...little(crc, 4), ...little(data.length, 4),
      ...little(data.length, 4), ...little(nameBytes.length, 2), ...little(0, 2),
    ]);
    localChunks.push(localHeader, nameBytes, data);

    const centralHeader = new Uint8Array([
      ...little(0x02014b50, 4), ...little(20, 2), ...little(20, 2), ...little(0, 2),
      ...little(0, 2), ...little(0, 2), ...little(0, 2), ...little(crc, 4),
      ...little(data.length, 4), ...little(data.length, 4), ...little(nameBytes.length, 2),
      ...little(0, 2), ...little(0, 2), ...little(0, 2), ...little(0, 2),
      ...little(0, 4), ...little(offset, 4),
    ]);
    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  });

  const central = join(centralChunks);
  const end = new Uint8Array([
    ...little(0x06054b50, 4), ...little(0, 2), ...little(0, 2),
    ...little(Object.keys(files).length, 2), ...little(Object.keys(files).length, 2),
    ...little(central.length, 4), ...little(offset, 4), ...little(0, 2),
  ]);
  return join([...localChunks, central, end]);
}

function modelXml(model: ReliefModel, projectName: string) {
  const materials = [...new Set(model.parts.map((part) => part.color))];
  const objects: string[] = [];
  const partObjectIds: number[] = [];
  let nextObjectId = 2;

  model.parts.forEach((part) => {
    const meshes = part.components?.length ? part.components : [part];
    const meshObjectIds = meshes.map((mesh, componentIndex) => {
      const objectId = nextObjectId++;
      const vertices = mesh.vertices.map(([x, y, z]) => `<vertex x="${x.toFixed(7)}" y="${y.toFixed(7)}" z="${z.toFixed(7)}"/>`).join("");
      const triangles = mesh.triangles.map(([v1, v2, v3]) => `<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`).join("");
      const componentSuffix = meshes.length > 1 ? ` — forma ${componentIndex + 1}` : "";
      const name = `${part.name} ${part.color}${componentSuffix}`;
      objects.push(`<object id="${objectId}" type="model" name="${escapeXml(name)}" pid="1" pindex="${materials.indexOf(part.color)}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`);
      return objectId;
    });

    if (meshObjectIds.length === 1) {
      partObjectIds.push(meshObjectIds[0]);
      return;
    }

    const parentId = nextObjectId++;
    const components = meshObjectIds.map((objectId) => `<component objectid="${objectId}"/>`).join("");
    objects.push(`<object id="${parentId}" type="model" name="${escapeXml(`${part.name} ${part.color}`)}"><components>${components}</components></object>`);
    partObjectIds.push(parentId);
  });

  // One build item keeps every level under the same XY/Z transform. Slicers
  // may auto-arrange separate build items and thereby destroy the relief.
  const rootObjectId = nextObjectId;
  const rootComponents = partObjectIds.map((objectId) => `<component objectid="${objectId}"/>`).join("");
  objects.push(`<object id="${rootObjectId}" type="model" name="${escapeXml(projectName)}"><components>${rootComponents}</components></object>`);

  const colors = materials.map((color) => `<m:color color="${displayColor(color)}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"><metadata name="Title">${escapeXml(projectName)}</metadata><metadata name="Application">Relief Lab</metadata><resources><m:colorgroup id="1">${colors}</m:colorgroup>${objects.join("")}</resources><build><item objectid="${rootObjectId}"/></build></model>`;
}

export function create3mfPackage(model: ReliefModel, filename: string) {
  validateReliefModel(model);
  const baseName = filename.replace(/\.svg$/i, "").replace(/[^a-z0-9_-]+/gi, "-") || "relief-lab";
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    "3D/3dmodel.model": modelXml(model, baseName),
  };
  return { bytes: zipStore(files), filename: `${baseName}.3mf` };
}

export function download3mf(model: ReliefModel, filename: string) {
  const packageFile = create3mfPackage(model, filename);
  const blob = new Blob([packageFile.bytes.buffer as ArrayBuffer], { type: "model/3mf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = packageFile.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
