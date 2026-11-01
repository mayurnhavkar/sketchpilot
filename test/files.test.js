import { test } from "node:test";
import assert from "node:assert/strict";
import { readTextFiles, LIMITS } from "../src/lib/files.js";

const f = (name, body, path) => {
  const file = new File([body], name);
  if (path) Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
};

test("reads text and code files with their relative paths", async () => {
  const r = await readTextFiles([f("a.md", "# hi", "docs/a.md"), f("b.py", "print(1)")]);
  assert.deepEqual(r.files.map((x) => x.name), ["docs/a.md", "b.py"]);
  assert.equal(r.skipped, 0);
});

test("skips secrets, dependency folders, binaries, huge and unknown files", async () => {
  const r = await readTextFiles([
    f(".env", "KEY=1"), f("id_rsa", "x"), f("server.pem", "x"), f("my_secret.json", "{}"),
    f("x.js", "1", "node_modules/pkg/x.js"), f("logo.png", "png"), f("big.md", "x".repeat(LIMITS.perFile + 1)),
    f("bin.txt", "a\u0000b"), f("ok.md", "fine"),
  ]);
  assert.deepEqual(r.files.map((x) => x.name), ["ok.md"]);
  assert.equal(r.skipped, 8);
});

test("stops adding files once the total budget is used", async () => {
  const chunk = "x".repeat(60_000);
  const r = await readTextFiles([f("1.md", chunk), f("2.md", chunk), f("3.md", chunk)]);
  assert.equal(r.files.length, 2);
  assert.equal(r.skipped, 1);
  assert.ok(r.chars <= LIMITS.total);
});
