import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/lib/color-palette.ts", import.meta.url), "utf8");
const threeUrl = new URL("../node_modules/three/build/three.module.js", import.meta.url).href;
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('from "three"', `from "${threeUrl}"`);
const paletteTools = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("limits a palette while preserving perceptually distinct frequent colors", () => {
  const result = paletteTools.suggestColorAssignments([
    { color: "#ffffff", weight: 50 },
    { color: "#eeeeee", weight: 8 },
    { color: "#233d6e", weight: 35 },
    { color: "#294878", weight: 7 },
    { color: "#e63939", weight: 30 },
  ], 3);

  assert.equal(result.palette.length, 3);
  assert.equal(result.assignments["#ffffff"], result.assignments["#eeeeee"]);
  assert.equal(result.assignments["#233d6e"], result.assignments["#294878"]);
  assert.notEqual(result.assignments["#233d6e"], result.assignments["#e63939"]);
});

test("a one-color limit maps every source color to one material", () => {
  const result = paletteTools.suggestColorAssignments([
    { color: "white", weight: 20 },
    { color: "#111111", weight: 5 },
    { color: "rgb(230, 57, 57)", weight: 10 },
  ], 1);

  assert.equal(result.palette.length, 1);
  assert.equal(new Set(Object.values(result.assignments)).size, 1);
});

test("equivalent CSS spellings receive the same suggested assignment", () => {
  const result = paletteTools.suggestColorAssignments([
    { color: "#fff", weight: 5 },
    { color: "#ffffff", weight: 5 },
    { color: "#eeeeee", weight: 1 },
    { color: "#e63939", weight: 10 },
  ], 1);

  assert.equal(result.assignments["#fff"], result.assignments["#ffffff"]);
  assert.equal(new Set(Object.values(result.assignments)).size, 1);
});
