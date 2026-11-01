import { test } from "node:test";
import assert from "node:assert/strict";
import { guard, cleanImages, cleanFiles, cleanPalette } from "../server/plugin.js";
import { DEFAULT_PALETTE } from "../server/prompt.js";

const T = "a".repeat(48);
const req = (headers) => ({ headers });

test("guard accepts a local host with the right token", () => {
  assert.equal(guard(req({ host: "127.0.0.1:5173", "x-ec-token": T }), T), null);
  assert.equal(guard(req({ host: "localhost:5173", origin: "http://localhost:5173", "x-ec-token": T }), T), null);
});

test("guard rejects foreign hosts (DNS rebinding), foreign origins, and bad tokens", () => {
  assert.equal(guard(req({ host: "evil.example", "x-ec-token": T }), T), "bad host");
  assert.equal(guard(req({ host: "localhost:5173", origin: "https://evil.example", "x-ec-token": T }), T), "bad origin");
  assert.equal(guard(req({ host: "localhost:5173", origin: "not a url", "x-ec-token": T }), T), "bad origin");
  assert.equal(guard(req({ host: "localhost:5173" }), T), "bad token");
  assert.equal(guard(req({ host: "localhost:5173", "x-ec-token": "b".repeat(48) }), T), "bad token");
  assert.equal(guard(req({ host: "localhost:5173", "x-ec-token": "short" }), T), "bad token");
});

test("cleanImages keeps real images only, max 3", () => {
  const ok = { mime: "image/png", data: "QUJD" };
  const out = cleanImages([ok, ok, ok, ok, { mime: "image/svg+xml", data: "QUJD" }, { mime: "image/png", data: "not base64!" }, null]);
  assert.equal(out.length, 3);
  assert.deepEqual(cleanImages("x"), []);
});

test("cleanFiles enforces per-file and total budgets", () => {
  const big = { name: "a.txt", text: "x".repeat(100_000) };
  const out = cleanFiles([big, big, big, big, { name: 5, text: "x" }]);
  assert.equal(out[0].text.length, 60_000);
  assert.ok(out.reduce((n, f) => n + f.text.length, 0) <= 150_000);
});

test("cleanPalette falls back unless every entry is a #rrggbb color", () => {
  assert.deepEqual(cleanPalette(["#aabbcc", "#112233"]), ["#aabbcc", "#112233"]);
  assert.deepEqual(cleanPalette(["red"]), DEFAULT_PALETTE);
  assert.deepEqual(cleanPalette(undefined), DEFAULT_PALETTE);
  assert.deepEqual(cleanPalette(["#aabbcc", "x\"><script>"]), DEFAULT_PALETTE);
});
