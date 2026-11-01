import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDeletes, applyStyle, boundTextMaxWidth, layoutBoundText, wrapText, applyUpdates, bindToExisting, connect, describeScene, edge,
  freeSpace, labelOf, namespaceIds, selectedIdsOf, styleById, summarizeResult,
} from "../src/lib/scene.js";

const rect = (id, x, y, label, extra = {}) => ({
  id, type: "rectangle", x, y, width: 200, height: 80, version: 1, isDeleted: false,
  boundElements: label ? [{ id: `${id}-t`, type: "text" }] : [], ...extra,
});
const text = (id, container, t) => ({ id, type: "text", containerId: container, text: t, originalText: t, x: 0, y: 0, width: 50, height: 20, version: 1, isDeleted: false });
const scene = () => [
  rect("a", 0, 0, "Client"), text("a-t", "a", "Client"),
  rect("b", 400, 0, "API"), text("b-t", "b", "API"),
  { id: "ar", type: "arrow", x: 200, y: 40, width: 200, height: 0, startBinding: { elementId: "a" }, endBinding: { elementId: "b" }, boundElements: [], version: 1, isDeleted: false },
  { ...rect("gone", 0, 500), isDeleted: true },
];

test("describeScene lists ids, labels, hides bound text and deleted elements, marks selection first", () => {
  const { text: t, knownIds } = describeScene(scene(), new Set(["b"]));
  const lines = t.split("\n");
  assert.match(lines[0], /^> id=b rectangle "API"/);
  assert.ok(!t.includes("gone") && !t.includes("a-t"));
  assert.match(t, /id=ar arrow Client\(a\) -> API\(b\)/);
  assert.deepEqual(knownIds.sort(), ["a", "ar", "b"]);
});

test("describeScene caps the listing but keeps the selection", () => {
  const many = Array.from({ length: 300 }, (_, i) => rect(`r${i}`, i, 0));
  const { knownIds } = describeScene(many, new Set(["r299"]), 10);
  assert.equal(knownIds.length, 10);
  assert.equal(knownIds[0], "r299");
});

test("selectedIdsOf reads Excalidraw's selection map", () => {
  assert.deepEqual([...selectedIdsOf({ selectedElementIds: { a: true, b: false, c: true } })], ["a", "c"]);
  assert.equal(selectedIdsOf(undefined).size, 0);
});

test("freeSpace puts new content below existing elements, ignoring deleted ones", () => {
  assert.deepEqual(freeSpace([]), { ox: 0, oy: 0 });
  assert.deepEqual(freeSpace(scene()), { ox: 0, oy: 80 + 120 });
});

test("namespaceIds prefixes own ids and references, leaves canvas references alone, names unnamed arrows", () => {
  const out = namespaceIds(
    [{ type: "rectangle", id: "api" }, { type: "arrow", start: { id: "api" }, end: { id: "canvas-id" } }],
    "k_",
  );
  assert.equal(out[0].id, "k_api");
  assert.equal(out[1].start.id, "k_api");
  assert.equal(out[1].end.id, "canvas-id");
  assert.equal(out[1].id, "k_auto0");
});

test("edge picks facing sides; connect spans the gap and never returns a zero size", () => {
  const a = { x: 0, y: 0, width: 200, height: 80 };
  assert.deepEqual(edge(a, { x: 400, y: 0, width: 200, height: 80 }), [200, 40]);
  assert.deepEqual(edge(a, { x: 0, y: 300, width: 200, height: 80 }), [100, 80]);
  const arrow = connect({ type: "arrow", start: { id: "a" }, end: { id: "b" } }, { a, b: { x: 0, y: 300, width: 200, height: 80 } });
  assert.equal(arrow.width, 0.01);
  assert.equal(arrow.height, 220);
  assert.deepEqual(connect({ type: "arrow", start: { id: "a" }, end: { id: "zzz" } }, { a }).x, undefined);
});

test("bindToExisting wires arrows to canvas elements and updates their boundElements", () => {
  const existing = { b: rect("b", 400, 0, null) };
  const created = [{ id: "k_ar", type: "arrow" }];
  const skeleton = [{ id: "k_ar", type: "arrow", start: { id: "k_new" }, end: { id: "b" } }];
  const { created: out, patched } = bindToExisting(created, existing, skeleton);
  assert.equal(out[0].endBinding.elementId, "b");
  assert.equal(out[0].startBinding, undefined);
  assert.deepEqual(patched.get("b").boundElements, [{ id: "k_ar", type: "arrow" }]);
  assert.ok(patched.get("b").version > 1);
});

test("applyUpdates changes colors, and routes text/fontSize to the bound text of a container", () => {
  const out = applyUpdates(scene(), [
    { id: "a", set: { backgroundColor: "#ff0000", text: "Browser", fontSize: 30, width: 300 } },
    { id: "ar", set: { width: 999, strokeColor: "#00f" } }, // arrow size is ignored, color applies
  ]);
  const by = Object.fromEntries(out.map((e) => [e.id, e]));
  assert.equal(by.a.backgroundColor, "#ff0000");
  assert.equal(by.a.width, 300);
  assert.equal(by["a-t"].text, "Browser");
  assert.equal(by["a-t"].originalText, "Browser");
  assert.equal(by["a-t"].fontSize, 30);
  assert.equal(by.ar.width, 200);
  assert.equal(by.ar.strokeColor, "#00f");
  assert.equal(by.b.version, 1); // untouched elements are the same objects
  assert.equal(labelOf(by.a, by), "Browser");
});

test("applyDeletes also removes bound text and attached arrows", () => {
  const out = applyDeletes(scene(), ["a"]);
  const dead = out.filter((e) => e.isDeleted).map((e) => e.id).sort();
  assert.deepEqual(dead, ["a", "a-t", "ar", "gone"]);
  assert.equal(out.find((e) => e.id === "b").isDeleted, false);
  assert.equal(applyDeletes(scene(), []).length, 6);
});

test("applyStyle sets roughness/fonts, snaps to the grid, recolors nodes only on request", () => {
  const els = [{ type: "rectangle", x: 33, y: 47 }, { type: "diamond", x: 0, y: 0 }, { type: "text", x: 5, y: 5 }, { type: "arrow", x: 3, y: 3 }];
  const clean = styleById("clean");
  const out = applyStyle(els, clean, { recolor: () => true });
  assert.equal(out[0].roughness, 0);
  assert.deepEqual([out[0].x, out[0].y], [40, 40]);
  assert.equal(out[0].backgroundColor, "#a5d8ff");
  assert.equal(out[1].backgroundColor, "#ffec99");
  assert.equal(out[2].fontFamily, 2);
  assert.equal(out[3].x, 3); // arrows are not snapped
  const plain = applyStyle(els, styleById("sketch"));
  assert.equal(plain[0].backgroundColor, undefined);
  assert.equal(plain[0].x, 33);
  assert.equal(styleById("nope").id, "sketch");
});

test("summarizeResult is short and truthful", () => {
  assert.equal(summarizeResult({ update: [], delete: [] }, ["A", "B"]), "added A, B");
  assert.equal(summarizeResult({ update: [1], delete: [1, 2] }, []), "updated 1 element(s); deleted 2 element(s)");
  assert.equal(summarizeResult({ update: [], delete: [] }, []), "nothing");
});

const fakeMeasure = (text) => text.length * 10; // 10px per character

test("wrapText breaks on word boundaries and keeps explicit newlines", () => {
  assert.equal(wrapText("aaa bbb ccc", "x", 70, fakeMeasure), "aaa bbb\nccc");
  assert.equal(wrapText("a\nb c", "x", 100, fakeMeasure), "a\nb c");
  assert.equal(wrapText("verylongword", "x", 30, fakeMeasure), "verylongword"); // never splits a word
});

test("layoutBoundText wraps to the container, then centers the block in it", () => {
  const c = { id: "c", type: "rectangle", x: 100, y: 100, width: 110, height: 100 }; // max width 100
  const t = { id: "t", type: "text", containerId: "c", text: "old", originalText: "alpha beta gamma", fontSize: 20, fontFamily: 2, lineHeight: 1.25, version: 1 };
  const out = layoutBoundText(t, c, fakeMeasure);
  assert.equal(out.text, "alpha beta\ngamma");
  assert.equal(out.width, 100);
  assert.equal(out.height, 50);
  assert.equal(out.x, 105);
  assert.equal(out.y, 125);
});

test("diamonds and ellipses get a narrower text box", () => {
  const base = { x: 0, y: 0, width: 200, height: 100 };
  assert.equal(boundTextMaxWidth({ ...base, type: "rectangle" }), 190);
  assert.equal(boundTextMaxWidth({ ...base, type: "ellipse" }), 131);
  assert.equal(boundTextMaxWidth({ ...base, type: "diamond" }), 90);
});

test("applyUpdates relayouts a label when its text changes or its container is resized", () => {
  const els = [
    { ...rect("a", 0, 0, "Client"), type: "diamond", width: 200 }, { ...text("a-t", "a", "Client"), fontSize: 20, fontFamily: 2, lineHeight: 1.25 },
  ];
  const renamed = applyUpdates(els, [{ id: "a", set: { text: "Is the user name and pass valid" } }], fakeMeasure);
  const t1 = renamed.find((e) => e.id === "a-t");
  assert.ok(t1.text.includes("\n"), "wrapped");
  assert.ok(t1.width <= 90, "fits the diamond");
  const grown = applyUpdates(renamed, [{ id: "a", set: { width: 400 } }], fakeMeasure);
  assert.ok(grown.find((e) => e.id === "a-t").width > t1.width, "re-wrapped wider after the resize");
  // without a measurer nothing is relaid out
  assert.equal(applyUpdates(els, [{ id: "a", set: { text: "x" } }]).find((e) => e.id === "a-t").text, "x");
});
