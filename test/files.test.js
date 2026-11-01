import { test } from "node:test";
import assert from "node:assert/strict";
import { readTextFiles, stripDrawingData, LIMITS } from "../src/lib/files.js";

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

test("attaching an Obsidian vault: notes yes; .obsidian config, .trash and drawing blobs no", async () => {
  const blob = "N4Ig".repeat(20000);
  const r = await readTextFiles([
    f("Linked List.md", "# Linked list", "Vault/Notes/Linked List.md"),
    f("Linked List.excalidraw.md", `---\nexcalidraw-plugin: parsed\n---\nMy notes above\n\n# Excalidraw Data\n\n## Text Elements\nHead ^abc12345\n\n%%\n## Drawing\n\`\`\`compressed-json\n${blob}\n\`\`\`\n%%\n`, "Vault/Notes/Linked List.excalidraw.md"),
    f("workspace.json", "{}", "Vault/.obsidian/workspace.json"),
    f("main.js", "x", "Vault/.obsidian/plugins/p/main.js"),
    f("Old.md", "deleted", "Vault/.trash/Old.md"),
  ]);
  assert.deepEqual(r.files.map((x) => x.name), ["Vault/Notes/Linked List.md", "Vault/Notes/Linked List.excalidraw.md"]);
  assert.equal(r.skipped, 3);
  const d = r.files[1].text;
  assert.match(d, /My notes above/);
  assert.match(d, /Head \^abc12345/); // text inside the drawing is kept
  assert.ok(!d.includes("compressed-json") && !d.includes("N4Ig") && r.chars < 500);
});

test("stripDrawingData leaves ordinary files alone and handles a file with no drawing section", () => {
  assert.equal(stripDrawingData("a.md", "## Drawing\nnot an excalidraw file"), "## Drawing\nnot an excalidraw file");
  assert.equal(stripDrawingData("a.excalidraw.md", "just text"), "just text");
});
