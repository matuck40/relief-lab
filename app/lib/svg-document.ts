export type SvgShape = {
  id: string;
  tag: string;
  fill: string;
  layerId: string;
};

export type SvgLayer = {
  id: string;
  name: string;
  shapeIds: string[];
  colors: string[];
};

export type ParsedSvgDocument = {
  name: string;
  markup: string;
  shapes: SvgShape[];
  colors: string[];
  layers: SvgLayer[];
};

const SHAPE_SELECTOR = "path, rect, circle, ellipse, polygon, polyline, line, text";
const DANGEROUS_SELECTOR = "script, foreignObject, iframe, object, embed, image, video, audio, a, use, style";

function normalizeColor(value: string | null) {
  if (!value) return null;
  const color = value.trim().toLowerCase();
  if (!color || color === "none" || color === "transparent" || color.startsWith("url(")) return null;
  return color;
}

function styleFill(element: Element) {
  return element.getAttribute("style")?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1] ?? null;
}

function inheritedFill(element: Element, root: Element) {
  let cursor: Element | null = element;
  while (cursor) {
    const fill = normalizeColor(cursor.getAttribute("fill")) ?? normalizeColor(styleFill(cursor));
    if (fill) return fill;
    if (cursor === root) break;
    cursor = cursor.parentElement;
  }
  return "#000000";
}

function sanitizeAttributes(root: Element) {
  root.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.toLowerCase();
      if (
        name.startsWith("on") || name === "href" || name === "xlink:href" ||
        value.includes("javascript:") || value.includes("url(")
      ) element.removeAttribute(attribute.name);
    });
  });
}

function layerName(element: Element, index: number) {
  return (
    element.getAttribute("inkscape:label") ||
    element.getAttribute("data-name") ||
    element.getAttribute("aria-label") ||
    element.getAttribute("id") ||
    `Grupo ${index + 1}`
  ).trim();
}

function findLayerGroups(root: Element) {
  const directGroups = Array.from(root.children).filter((child) => child.localName === "g");
  if (directGroups.length !== 1) return directGroups;

  // Illustrator often wraps the entire document in one outer layer group.
  // When that wrapper contains only groups, its immediate children are the
  // first useful organization level. Deeper descendants stay inside them.
  const wrapper = directGroups[0];
  const wrapperGroups = Array.from(wrapper.children).filter((child) => child.localName === "g");
  const shapeTags = new Set(SHAPE_SELECTOR.split(", "));
  const hasDirectShapes = Array.from(wrapper.children).some((child) => shapeTags.has(child.localName));
  return !hasDirectShapes && wrapperGroups.length ? wrapperGroups : directGroups;
}

export function parseSvgDocument(source: string, name: string): ParsedSvgDocument {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
    throw new Error("invalid svg");
  }

  const root = document.documentElement;
  root.querySelectorAll(DANGEROUS_SELECTOR).forEach((element) => element.remove());
  sanitizeAttributes(root);

  if (!root.getAttribute("viewBox")) {
    const width = Number.parseFloat(root.getAttribute("width") ?? "0");
    const height = Number.parseFloat(root.getAttribute("height") ?? "0");
    if (width > 0 && height > 0) root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  root.removeAttribute("width");
  root.removeAttribute("height");
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  root.setAttribute("aria-hidden", "true");
  root.classList.add("relief-svg");

  const layerGroups = findLayerGroups(root);
  const layerGroupSet = new Set(layerGroups);
  const layerIds = new Map(layerGroups.map((group, index) => [group, `layer-${index + 1}`]));

  const shapes = Array.from(root.querySelectorAll(SHAPE_SELECTOR)).map((element, index) => {
    const id = `shape-${index + 1}`;
    const fill = inheritedFill(element, root);
    let parent: Element | null = element.parentElement;
    while (parent && parent !== root && !layerGroupSet.has(parent)) parent = parent.parentElement;
    const layerId = parent && layerGroupSet.has(parent) ? layerIds.get(parent)! : "layer-ungrouped";
    element.setAttribute("data-relief-id", id);
    element.setAttribute("data-relief-fill", fill);
    element.setAttribute("data-relief-layer", layerId);
    element.classList.add("relief-shape");
    return { id, tag: element.localName, fill, layerId };
  });

  const colors = [...new Set(shapes.map((shape) => shape.fill))];
  const layers = layerGroups.map((group, index) => {
    const id = layerIds.get(group)!;
    const layerShapes = shapes.filter((shape) => shape.layerId === id);
    return {
      id,
      name: layerName(group, index),
      shapeIds: layerShapes.map((shape) => shape.id),
      colors: [...new Set(layerShapes.map((shape) => shape.fill))],
    };
  }).filter((layer) => layer.shapeIds.length > 0);

  const ungroupedShapes = shapes.filter((shape) => shape.layerId === "layer-ungrouped");
  if (ungroupedShapes.length) {
    layers.push({
      id: "layer-ungrouped",
      name: "Sem grupo",
      shapeIds: ungroupedShapes.map((shape) => shape.id),
      colors: [...new Set(ungroupedShapes.map((shape) => shape.fill))],
    });
  }

  return { name, markup: new XMLSerializer().serializeToString(root), shapes, colors, layers };
}
