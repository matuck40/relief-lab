import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { ExtrudeGeometry, Path, Shape } from "three";

const source = await (await import("node:fs/promises")).readFile(
  new URL("../app/lib/export-3mf.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exporter = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const meshSource = await (await import("node:fs/promises")).readFile(
  new URL("../app/lib/mesh.ts", import.meta.url),
  "utf8",
);
const meshJavascript = ts.transpileModule(meshSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const meshTools = await import(`data:text/javascript;base64,${Buffer.from(meshJavascript).toString("base64")}`);

const cube = {
  parts: [{
    id: "part-1",
    name: "Base",
    color: "#246bfd",
    level: 0,
    vertices: [
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 0],
      [0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1],
    ],
    triangles: [
      [0, 1, 2], [3, 4, 5], [4, 3, 6], [7, 2, 1],
      [4, 6, 1], [4, 2, 5], [7, 1, 6], [5, 2, 7],
      [4, 0, 2], [6, 3, 7], [1, 0, 4], [7, 3, 5],
    ],
  }],
  width: 1,
  depth: 1,
  height: 1,
  triangleCount: 12,
  modeledShapeCount: 1,
};

function unzipStored(bytes) {
  const archive = Buffer.from(bytes);
  const files = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    assert.equal(method, 0, "test parser expects stored ZIP entries");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    files.set(name, archive.subarray(dataStart, dataStart + size).toString("utf8"));
    offset = dataStart + size;
  }
  return files;
}

test("3MF package contains a valid core payload and material color", async () => {
  const packageFile = exporter.create3mfPackage(cube, "teste.svg");
  const files = unzipStored(packageFile.bytes);

  assert.deepEqual([...files.keys()], ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
  assert.match(files.get("[Content_Types].xml"), /application\/vnd\.ms-package\.3dmanufacturing-3dmodel\+xml/);
  assert.match(files.get("_rels/.rels"), /Target="\/3D\/3dmodel\.model"/);
  assert.match(files.get("3D/3dmodel.model"), /<m:color color="#246BFDFF"\/>/);
  assert.match(files.get("3D/3dmodel.model"), /<vertices>.*<triangles>/);
  assert.match(files.get("3D/3dmodel.model"), /<\/triangles><\/mesh><\/object>/);
  assert.match(files.get("3D/3dmodel.model"), /<object id="3" type="model" name="teste"><components><component objectid="2"\/><\/components><\/object>/);
  assert.match(files.get("3D/3dmodel.model"), /<item objectid="3"\/>/);

  await writeFile("/private/tmp/relief-lab-compatible.3mf", packageFile.bytes);
});

test("3MF export reports an open mesh without blocking the slicer", async () => {
  const openMesh = structuredClone(cube);
  openMesh.parts[0].triangles.pop();
  const topology = exporter.inspectReliefTopology(openMesh);
  assert.equal(topology.affectedPartCount, 1);
  assert.equal(topology.irregularEdgeCount, 3);
  const openPackage = exporter.create3mfPackage(openMesh, "aberto.svg");
  await writeFile("/private/tmp/relief-lab-open-mesh.3mf", openPackage.bytes);
});

test("preview triangles are welded into a slicer-compatible closed mesh", () => {
  const expandedVertices = cube.parts[0].triangles.flatMap((triangle) => (
    triangle.map((index) => cube.parts[0].vertices[index])
  ));
  const expandedTriangles = cube.parts[0].triangles.map((_, index) => [index * 3, index * 3 + 1, index * 3 + 2]);
  const prepared = meshTools.prepareClosedMesh(expandedVertices, expandedTriangles);

  assert.equal(prepared.vertices.length, 8);
  assert.equal(prepared.triangles.length, 12);
  exporter.validateReliefModel({ ...cube, parts: [{ ...cube.parts[0], ...prepared }] });
});

test("curved extrusions with a hole remain closed after welding", async () => {
  const shape = new Shape();
  shape.absellipse(0, 0, 10, 8, 0, Math.PI * 2, false);
  const hole = new Path();
  hole.absellipse(0, 0, 4, 3, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 24 });
  const positions = geometry.getAttribute("position");
  const vertices = Array.from({ length: positions.count }, (_, index) => [
    positions.getX(index), positions.getY(index), positions.getZ(index),
  ]);
  const triangles = Array.from({ length: positions.count / 3 }, (_, index) => [
    index * 3, index * 3 + 1, index * 3 + 2,
  ]);
  const prepared = meshTools.prepareClosedMesh(vertices, triangles);
  const curvedModel = { ...cube, parts: [{ ...cube.parts[0], ...prepared }] };
  const topology = exporter.inspectReliefTopology(curvedModel);
  geometry.dispose();

  assert.equal(topology.affectedPartCount, 0);
  assert.equal(topology.irregularEdgeCount, 0);
  const packageFile = exporter.create3mfPackage(curvedModel, "curvas-e-furo.svg");
  await writeFile("/private/tmp/relief-lab-curves-and-hole.3mf", packageFile.bytes);
});

test("Illustrator-style collinear anchors do not leave open edges", () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(5, 0);
  shape.lineTo(10, 0);
  shape.lineTo(10, 10);
  shape.lineTo(5, 10);
  shape.lineTo(0, 10);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  const positions = geometry.getAttribute("position");
  const vertices = Array.from({ length: positions.count }, (_, index) => [
    positions.getX(index), positions.getY(index), positions.getZ(index),
  ]);
  const triangles = Array.from({ length: positions.count / 3 }, (_, index) => [
    index * 3, index * 3 + 1, index * 3 + 2,
  ]);
  const prepared = meshTools.prepareClosedMesh(vertices, triangles);
  const topology = exporter.inspectReliefTopology({ ...cube, parts: [{ ...cube.parts[0], ...prepared }] });
  geometry.dispose();

  assert.equal(topology.affectedPartCount, 0);
  assert.equal(topology.irregularEdgeCount, 0);
});

test("multiple closed shapes remain separate inside one level component", async () => {
  const secondMesh = {
    vertices: cube.parts[0].vertices.map(([x, y, z]) => [x + 2, y, z]),
    triangles: cube.parts[0].triangles,
  };
  const componentModel = structuredClone(cube);
  componentModel.parts[0].components = [
    { vertices: cube.parts[0].vertices, triangles: cube.parts[0].triangles },
    secondMesh,
  ];

  const packageFile = exporter.create3mfPackage(componentModel, "componentes.svg");
  const xml = unzipStored(packageFile.bytes).get("3D/3dmodel.model");
  assert.match(xml, /<object id="4" type="model" name="Base #246bfd"><components><component objectid="2"\/><component objectid="3"\/><\/components><\/object>/);
  assert.match(xml, /<object id="5" type="model" name="componentes"><components><component objectid="4"\/><\/components><\/object>/);
  assert.match(xml, /<item objectid="5"\/>/);
  assert.equal((xml.match(/<mesh>/g) ?? []).length, 2);
  assert.equal(exporter.inspectReliefTopology(componentModel).irregularEdgeCount, 0);
  await writeFile("/private/tmp/relief-lab-components.3mf", packageFile.bytes);
});

test("one assembled model keeps Z offsets and standard 3MF colors", async () => {
  const multicolorModel = structuredClone(cube);
  multicolorModel.parts.push({
    ...structuredClone(cube.parts[0]),
    id: "part-2",
    name: "Nível 1",
    color: "#e63939",
    level: 1,
    vertices: cube.parts[0].vertices.map(([x, y, z]) => [x, y, z + 1]),
  });
  const packageFile = exporter.create3mfPackage(multicolorModel, "multicor.svg");
  const files = unzipStored(packageFile.bytes);
  const modelXml = files.get("3D/3dmodel.model");

  assert.equal((modelXml.match(/<item /g) ?? []).length, 1);
  assert.match(modelXml, /<m:color color="#246BFDFF"\/>/);
  assert.match(modelXml, /<m:color color="#E63939FF"\/>/);
  await writeFile("/private/tmp/relief-lab-multicolor.3mf", packageFile.bytes);
});
