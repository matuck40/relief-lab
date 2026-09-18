import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server renders the Relief Lab product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Relief Lab/);
  assert.match(html, /Componha por níveis/);
  assert.match(html, /Arte vetorial/);
  assert.match(html, /Escolher SVG compartilhado/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("keeps the complete local SVG-to-3MF flow in the product source", async () => {
  const [page, model, exporter, preview, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/relief-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/export-3mf.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/three-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Arte.*Relevos.*Exportar/s);
  assert.match(page, /Sobreposições preservadas/);
  assert.match(page, /Baixar arquivo 3MF/);
  assert.match(page, /Curvas em alta resolução/);
  assert.match(page, /PALETA FINAL/);
  assert.match(page, /Sugerir atribuição/);
  assert.match(page, /suggestColorAssignments/);
  assert.match(page, /type Step = 1 \| 2 \| 3 \| 4/);
  assert.match(page, /Cores.*Exportar/s);
  assert.match(page, /COR ORIGINAL.*COR DO FILAMENTO/s);
  assert.match(page, /Cor do filamento para/);
  assert.match(page, /levelNames,\s*"export"/);
  assert.match(page, /function addRelief/);
  assert.match(page, /function assignIds/);
  assert.match(page, /function toggleLevel/);
  assert.match(page, /Vários níveis/);
  assert.match(page, /Não imprimir/);
  assert.match(page, /level-name-input/);
  assert.match(model, /SVGLoader/);
  assert.match(model, /ExtrudeGeometry/);
  assert.match(model, /assignedLevels\.forEach/);
  assert.match(model, /subPath\.autoClose = true/);
  assert.match(model, /curveSegmentsForWidth\(targetWidth, quality\)/);
  assert.match(model, /previewSegments \* 1\.5/);
  assert.match(model, /colorAssignments\[sourceColor\]/);
  assert.doesNotMatch(model, /curveSegments:\s*1\b/);
  assert.match(model, /current\.components\.push\(prepared\)/);
  assert.match(exporter, /<components>/);
  assert.match(model, /export type Level = number/);
  assert.match(exporter, /3D\/3dmodel\.model/);
  assert.match(exporter, /m:colorgroup/);
  assert.match(preview, /OrbitControls/);
  assert.match(layout, /Relief Lab — SVG multicor/);
});
