const MESH_PRECISION = 10_000_000;

function roundedCoordinate(value: number) {
  const rounded = Math.round(value * MESH_PRECISION) / MESH_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function prepareClosedMesh(vertices: number[][], triangles: number[][]) {
  const weldedVertices: number[][] = [];
  const vertexLookup = new Map<string, number>();
  const remap = vertices.map(([x, y, z]) => {
    const vertex = [roundedCoordinate(x), roundedCoordinate(y), roundedCoordinate(z)];
    const key = vertex.join(":");
    const existing = vertexLookup.get(key);
    if (existing !== undefined) return existing;
    const index = weldedVertices.length;
    weldedVertices.push(vertex);
    vertexLookup.set(key, index);
    return index;
  });

  const weldedTriangles = triangles.flatMap(([a, b, c]) => {
    const triangle = [remap[a], remap[b], remap[c]];
    if (triangle.some((index) => index === undefined) || new Set(triangle).size < 3) return [];
    const [va, vb, vc] = triangle.map((index) => weldedVertices[index]);
    const ab = vb.map((value, index) => value - va[index]);
    const ac = vc.map((value, index) => value - va[index]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    return cross.some((value) => Math.abs(value) > 1e-10) ? [triangle] : [];
  });

  const signedVolume = weldedTriangles.reduce((total, [a, b, c]) => {
    const va = weldedVertices[a];
    const vb = weldedVertices[b];
    const vc = weldedVertices[c];
    return total + (
      va[0] * (vb[1] * vc[2] - vb[2] * vc[1]) -
      va[1] * (vb[0] * vc[2] - vb[2] * vc[0]) +
      va[2] * (vb[0] * vc[1] - vb[1] * vc[0])
    ) / 6;
  }, 0);

  return {
    vertices: weldedVertices,
    triangles: signedVolume < 0
      ? weldedTriangles.map(([a, b, c]) => [a, c, b])
      : weldedTriangles,
  };
}
