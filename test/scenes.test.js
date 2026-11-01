import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createScenes } from "../server/scenes.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ec-scenes-"));
const scene = (n) => ({ elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, type: "rectangle" })), appState: { viewBackgroundColor: "#fff" } });

test("write/read/list round-trips a plain .excalidraw file", () => {
  const dir = tmp();
  const s = createScenes(dir);
  s.write("Trading flow", scene(2));
  assert.ok(fs.existsSync(path.join(dir, "Trading flow.excalidraw")));
  assert.equal(s.read("Trading flow").elements.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "Trading flow.excalidraw"), "utf8")).type, "excalidraw");
  assert.deepEqual(s.list().map((x) => x.name), ["Trading flow"]);
});

test("names cannot escape the folder", () => {
  const s = createScenes(tmp());
  for (const bad of ["../x", "a/b", ".hidden", "", "x".repeat(101), "a\\b", "..", "name\0", "a:b", "what?", "star*", "pipe|x", " lead", "trail ", "dot."]) {
    assert.throws(() => s.write(bad, scene(1)), /bad scene name/, JSON.stringify(bad));
    assert.throws(() => s.read(bad), /bad scene name/, JSON.stringify(bad));
  }
});

test("a scene needs an elements array", () => {
  assert.throws(() => createScenes(tmp()).write("a", { nope: 1 }), /elements array/);
});

test("history keeps the overwritten state, at most one snapshot per interval", () => {
  const s = createScenes(tmp());
  s.write("a", scene(1));
  assert.deepEqual(s.history("a"), []);
  s.write("a", scene(2)); // overwrites 1 -> snapshot holds the 1-element version
  s.write("a", scene(3)); // within the interval -> no new snapshot
  const v = s.history("a");
  assert.equal(v.length, 1);
  assert.equal(s.readHistory("a", v[0]).elements.length, 1);
  assert.equal(s.read("a").elements.length, 3);
});

test("identical saves do not create history", () => {
  const s = createScenes(tmp());
  s.write("a", scene(1));
  s.write("a", scene(1));
  assert.deepEqual(s.history("a"), []);
});

test("history timestamps are validated", () => {
  const s = createScenes(tmp());
  s.write("a", scene(1));
  assert.throws(() => s.readHistory("a", "../../etc/passwd"), /bad timestamp/);
});

test("listing an empty or missing folder is fine", () => {
  assert.deepEqual(createScenes(path.join(tmp(), "nope")).list(), []);
});

test("names people actually give notes are accepted (Obsidian-style): unicode, brackets, plus signs, dates", () => {
  const s = createScenes(tmp());
  for (const ok of ["Résumé notes", "Python (basics)", "C++ notes", "2026-11-01 Daily", "Notes_2026", "日本語のメモ", "Q&A #1", "x".repeat(100)]) {
    s.write(ok, scene(1));
    assert.equal(s.read(ok).elements.length, 1, ok);
  }
  assert.equal(s.list().length, 8);
});

test("safeSceneName turns any title into an accepted name", async () => {
  const { safeSceneName, validSceneName } = await import("../src/lib/names.js");
  assert.equal(safeSceneName("Trading: post-mortem?"), "Trading post-mortem");
  assert.equal(safeSceneName("  ../../etc/passwd  "), "etc passwd");
  assert.equal(safeSceneName("..."), "Untitled");
  assert.equal(safeSceneName(""), "Untitled");
  assert.equal(safeSceneName(null), "Untitled");
  assert.equal(safeSceneName("a".repeat(300)).length, 100);
  for (const t of ["x/y", "a\\b", "name.", ".dot", "p|q", "C++ notes", "Résumé"]) assert.ok(validSceneName(safeSceneName(t)), t);
});
