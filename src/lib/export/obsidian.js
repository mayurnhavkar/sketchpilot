// The file format of Obsidian's Excalidraw plugin (read from its source and verified against the real plugin):
//   ---
//   excalidraw-plugin: parsed
//   ---
//   <any Markdown you want, kept as ordinary notes>
//
//   # Excalidraw Data
//
//   ## Text Elements
//
//   %%
//   ## Drawing
//   ```compressed-json
//   <LZString.compressToBase64(json), in 256-character lines>
//   ```
//   %%
// One file therefore holds searchable notes on top and the editable drawing below.
import lz from "lz-string";

export const PLUGIN_KEY = "excalidraw-plugin";

// The plugin keeps text ids that are already 8 characters and rewrites any other to a random 8-character id.
// If we hand it long ids again on a later export, every label looks new and gets added a second time (a real
// bug found in testing). So text ids are shortened deterministically, and every reference is updated, which
// makes the same element carry the same id on every export.
const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const isShortId = (id) => typeof id === "string" && /^[A-Za-z0-9]{8}$/.test(id);

function hash8(str, salt = 0) {
  let h1 = (0x811c9dc5 ^ salt) >>> 0, h2 = (0x9e3779b1 + salt) >>> 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  let n = (BigInt(h1) << 32n) | BigInt(h2);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += B62[Number(n % 62n)];
    n /= 62n;
  }
  return out;
}

export function shortenTextIds(elements) {
  const taken = new Set(elements.filter((e) => !(e.type === "text" && !isShortId(e.id))).map((e) => e.id));
  const map = new Map();
  for (const e of elements) {
    if (e.type !== "text" || isShortId(e.id)) continue;
    let salt = 0, id;
    do id = hash8(e.id, salt++); while (taken.has(id));
    taken.add(id);
    map.set(e.id, id);
  }
  if (!map.size) return elements;
  const re = (id) => map.get(id) ?? id;
  return elements.map((e) => ({
    ...e,
    id: re(e.id),
    ...(e.containerId ? { containerId: re(e.containerId) } : {}),
    ...(Array.isArray(e.boundElements) ? { boundElements: e.boundElements.map((b) => ({ ...b, id: re(b.id) })) } : {}),
  }));
}

// elements: the live elements; files: Excalidraw's BinaryFiles. Only files an image element uses are kept.
export function buildScene(elements, files = {}, background = "#ffffff") {
  const live = elements.filter((e) => !e.isDeleted);
  const used = new Set(live.filter((e) => e.type === "image").map((e) => e.fileId));
  return {
    type: "excalidraw",
    version: 2,
    source: "sketchpilot",
    elements: shortenTextIds(live),
    appState: { viewBackgroundColor: background },
    files: Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id))),
  };
}

export function toExcalidrawMd(markdown, scene) {
  const json = JSON.stringify(scene, null, 2);
  const chunks = lz.compressToBase64(json).match(/.{1,256}/g).join("\n\n"); // the plugin writes 256-character lines
  const fm = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  const rest = fm ? markdown.slice(fm[0].length) : markdown;
  const own = (fm ? fm[1] : "").split("\n").filter((l) => l && !l.startsWith(`${PLUGIN_KEY}:`));
  const front = [...own, `${PLUGIN_KEY}: parsed`].join("\n");
  return `---\n${front}\n---\n${rest.replace(/\s+$/, "")}\n\n# Excalidraw Data\n\n## Text Elements\n\n%%\n## Drawing\n\`\`\`compressed-json\n${chunks}\n\`\`\`\n%%\n`;
}

// -> { markdown, scene } or null. Reads back what toExcalidrawMd (or the plugin) wrote.
export function parseExcalidrawMd(text) {
  const m = text.match(/\n##? Drawing\n(?:%%\n)?[^`]*```(compressed-json|json)\n([\s\S]*?)```/);
  if (!m) return null;
  try {
    const raw = m[1] === "compressed-json" ? lz.decompressFromBase64(m[2].replace(/[\n\r]/g, "")) : m[2];
    const scene = JSON.parse(raw);
    if (!scene || !Array.isArray(scene.elements)) return null; // corrupt or not a drawing
    const at = text.search(/(^|\n)(%%\n+)?# Excalidraw Data/);
    return { markdown: (at < 0 ? text : text.slice(0, at)).trimEnd() + "\n", scene };
  } catch {
    return null;
  }
}
