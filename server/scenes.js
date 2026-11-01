import fs from "node:fs";
import path from "node:path";

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;
const HISTORY_EVERY_MS = 5 * 60_000;
const HISTORY_KEEP = 30;

// One folder of plain .excalidraw files (open them in any Excalidraw), plus .history/<name>/<timestamp>.excalidraw
export function createScenes(dir) {
  const file = (name) => path.join(dir, `${name}.excalidraw`);
  const histDir = (name) => path.join(dir, ".history", name);
  const check = (name) => {
    if (!NAME_RE.test(name)) throw new Error("bad scene name (letters, digits, space, - _ ; max 60)");
  };

  function list() {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".excalidraw"))
      .map((f) => ({ name: f.slice(0, -".excalidraw".length), updated: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((s) => NAME_RE.test(s.name))
      .sort((a, b) => b.updated - a.updated);
  }

  function read(name) {
    check(name);
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  }

  function write(name, scene) {
    check(name);
    if (!Array.isArray(scene?.elements)) throw new Error("scene needs an elements array");
    fs.mkdirSync(dir, { recursive: true });
    const data = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "excalidraw-claude",
      elements: scene.elements,
      appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor || "#ffffff" },
      files: scene.files || {},
    });
    const f = file(name);
    if (fs.existsSync(f)) {
      const prev = fs.readFileSync(f, "utf8");
      if (prev !== data) snapshot(name, prev);
    }
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, f);
  }

  // keep the state we are about to overwrite, at most one snapshot per interval
  function snapshot(name, content) {
    const d = histDir(name);
    fs.mkdirSync(d, { recursive: true });
    const snaps = fs.readdirSync(d).filter((f) => f.endsWith(".excalidraw")).sort();
    const last = snaps.at(-1);
    if (last && Date.now() - Number(last.split(".")[0]) < HISTORY_EVERY_MS) return;
    fs.writeFileSync(path.join(d, `${Date.now()}.excalidraw`), content);
    for (const old of snaps.slice(0, Math.max(0, snaps.length + 1 - HISTORY_KEEP))) fs.rmSync(path.join(d, old), { force: true });
  }

  function history(name) {
    check(name);
    const d = histDir(name);
    if (!fs.existsSync(d)) return [];
    return fs
      .readdirSync(d)
      .filter((f) => /^\d+\.excalidraw$/.test(f))
      .map((f) => Number(f.split(".")[0]))
      .sort((a, b) => b - a);
  }

  function readHistory(name, ts) {
    check(name);
    if (!/^\d{10,16}$/.test(String(ts))) throw new Error("bad timestamp");
    return JSON.parse(fs.readFileSync(path.join(histDir(name), `${ts}.excalidraw`), "utf8"));
  }

  return { list, read, write, history, readHistory };
}
