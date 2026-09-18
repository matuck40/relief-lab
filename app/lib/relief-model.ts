import { Color, ExtrudeGeometry } from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { prepareClosedMesh } from "./mesh";

export type Level = number;
export type LevelHeights = Record<number, number>;
export type CurveQuality = "preview" | "export";

export type ReliefPart = {
  id: string;
  name: string;
  color: string;
  level: Level;
  vertices: number[][];
  triangles: number[][];
  components: ReliefMesh[];
};

export type ReliefMesh = {
  vertices: number[][];
  triangles: number[][];
};

export type ReliefModel = {
  parts: ReliefPart[];
  width: number;
  depth: number;
  height: number;
  triangleCount: number;
  modeledShapeCount: number;
};

type RawPart = {
  name: string;
  color: string;
  level: Level;
  vertices: number[][];
  triangles: number[][];
};

function levelStart(level: Level, heights: LevelHeights) {
  return Object.entries(heights).reduce(
    (total, [key, height]) => total + (Number(key) < level ? height : 0),
    0,
  );
}

function printableColor(value: string) {
  const color = new Color("#808080");
  try { color.setStyle(value); } catch { /* Keep neutral fallback. */ }
  return `#${color.getHexString()}`;
}

// Three.js interprets this value as subdivisions per curved SVG segment.
// Scale it with the requested print width so circles stay smooth without
// producing needlessly large meshes for small models.
export function curveSegmentsForWidth(targetWidth: number, quality: CurveQuality = "preview") {
  const previewSegments = Math.max(12, Math.min(48, Math.ceil(Math.max(1, targetWidth) / 3)));
  return quality === "export"
    ? Math.max(24, Math.min(72, Math.ceil(previewSegments * 1.5)))
    : previewSegments;
}

export function buildReliefModel(
  markup: string,
  shapeLevels: Record<string, Level[]>,
  heights: LevelHeights,
  targetWidth: number,
  levelNames: Record<number, string> = {},
  quality: CurveQuality = "preview",
  colorAssignments: Record<string, string> = {},
): ReliefModel {
  const loader = new SVGLoader();
  const data = loader.parse(markup);
  const rawParts: RawPart[] = [];
  const modeledIds = new Set<string>();
  const curveSegments = curveSegmentsForWidth(targetWidth, quality);

  data.paths.forEach((path) => {
    const node = path.userData.node as Element | undefined;
    const shapeId = node?.getAttribute("data-relief-id");
    if (!shapeId) return;
    const assignedLevels = shapeLevels[shapeId] ?? [1];
    if (!assignedLevels.length) return;
    const sourceColor = node.getAttribute("data-relief-fill") || path.userData.style?.fill || "#808080";
    const color = printableColor(colorAssignments[sourceColor] ?? sourceColor);
    path.subPaths.forEach((subPath) => { subPath.autoClose = true; });
    const shapes = path.toShapes();
    if (!shapes.length) return;
    modeledIds.add(shapeId);

    assignedLevels.forEach((level) => {
      const depth = Math.max(0.01, heights[level] ?? 0.2);
      const zStart = levelStart(level, heights);
      shapes.forEach((shape) => {
        // Each SVG shape remains an independent watertight component. Joining
        // touching contours here can create non-manifold vertices in slicers.
        const geometry = new ExtrudeGeometry(shape, {
          depth,
          bevelEnabled: false,
          curveSegments,
        });
        geometry.translate(0, 0, zStart);
        const positions = geometry.getAttribute("position");
        if (!positions || positions.count < 3) {
          geometry.dispose();
          return;
        }

        const vertices = Array.from({ length: positions.count }, (_, index) => [
          positions.getX(index), positions.getY(index), positions.getZ(index),
        ]);
        const geometryIndex = geometry.getIndex();
        const triangles: number[][] = [];
        if (geometryIndex) {
          for (let index = 0; index < geometryIndex.count; index += 3) {
            triangles.push([
              geometryIndex.getX(index), geometryIndex.getX(index + 1), geometryIndex.getX(index + 2),
            ]);
          }
        } else {
          for (let index = 0; index < positions.count; index += 3) triangles.push([index, index + 1, index + 2]);
        }
        rawParts.push({
          name: levelNames[level] || (level === 0 ? "Base" : `Nível ${level}`),
          color,
          level,
          vertices,
          triangles,
        });
        geometry.dispose();
      });
    });
  });

  if (!rawParts.length) {
    return { parts: [], width: targetWidth, depth: 0, height: 0, triangleCount: 0, modeledShapeCount: 0 };
  }

  const bounds = rawParts.reduce((result, part) => {
    part.vertices.forEach(([x, y, z]) => {
      result.minX = Math.min(result.minX, x); result.maxX = Math.max(result.maxX, x);
      result.minY = Math.min(result.minY, y); result.maxY = Math.max(result.maxY, y);
      result.maxZ = Math.max(result.maxZ, z);
    });
    return result;
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: 0 });
  const { minX, maxX, minY, maxY, maxZ } = bounds;
  const sourceWidth = Math.max(0.001, maxX - minX);
  const sourceDepth = Math.max(0.001, maxY - minY);
  const scale = Math.max(1, targetWidth) / sourceWidth;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const merged = new Map<string, ReliefPart>();

  rawParts.forEach((part) => {
    const key = `${part.level}:${part.color}`;
    const prepared = prepareClosedMesh(
      part.vertices.map(([x, y, z]) => [
        (x - centerX) * scale,
        -(y - centerY) * scale,
        z,
      ]),
      part.triangles.map(([a, b, c]) => [a, c, b]),
    );
    if (!prepared.triangles.length) return;
    const current = merged.get(key) ?? {
      id: `part-${merged.size + 1}`,
      name: part.name,
      color: part.color,
      level: part.level,
      vertices: [],
      triangles: [],
      components: [],
    };
    const offset = current.vertices.length;
    current.vertices.push(...prepared.vertices);
    current.triangles.push(...prepared.triangles.map(([a, b, c]) => [a + offset, b + offset, c + offset]));
    current.components.push(prepared);
    merged.set(key, current);
  });

  const parts = [...merged.values()].sort((a, b) => a.level - b.level || a.color.localeCompare(b.color));
  return {
    parts,
    width: targetWidth,
    depth: sourceDepth * scale,
    height: maxZ,
    triangleCount: parts.reduce((total, part) => total + part.triangles.length, 0),
    modeledShapeCount: modeledIds.size,
  };
}
