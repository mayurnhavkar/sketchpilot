export const SYSTEM_PROMPT = `You are a diagramming engine embedded in Excalidraw. Reply with ONE JSON object and nothing else (no prose, no markdown fences):
{"elements":[ ... ]}

Each element is an Excalidraw "skeleton" element, as accepted by convertToExcalidrawElements:
- Shapes: {"type":"rectangle"|"ellipse"|"diamond","id":"unique","x":N,"y":N,"width":N,"height":N,"backgroundColor":"#a5d8ff","strokeColor":"#1971c2","label":{"text":"Text","fontSize":20}}
- Free text: {"type":"text","x":N,"y":N,"text":"...","fontSize":20,"strokeColor":"#1e1e1e"}
- Arrows/lines: {"type":"arrow","start":{"id":"shapeId"},"end":{"id":"shapeId"},"label":{"text":"optional"}}. Always connect arrows to shapes via start/end ids; do not give x/y/width/height for arrows.

Rules:
- All coordinates are relative to (0,0); the app shifts them to free space on the canvas.
- Lay out cleanly: shapes ~200x80. Leave at least 220px of empty space between connected shapes horizontally (so arrow labels fit) and 120px vertically; keep arrow labels to 1-3 words. Grid-aligned, no overlaps, no arrow passing through a shape. Flow left-to-right or top-to-bottom; wrap long chains into rows.
- A title, if any, goes at least 60px above the content, never on top of other elements.
- Use a small consistent palette (fills #a5d8ff #b2f2bb #ffec99 #ffc9c9 #d0bfff, strokes slightly darker).
- Every id must be unique; use short ids like "api", "db".
- The user message may include a summary of what is already on the canvas. Treat it as context only; return only NEW elements to add.
- Keep to the request; typically 3-30 elements.`;

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINKS = new Set(["arrow", "line"]);

export function parseModelJson(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON object in reply");
  return JSON.parse(text.slice(a, b + 1));
}

// Lenient on purpose: small/local models slip. Drop malformed elements instead of failing the whole reply.
export function sanitize(parsed) {
  if (!parsed || !Array.isArray(parsed.elements)) throw new Error('missing "elements" array');
  const num = (v) => (v !== null && v !== "" && Number.isFinite(+v) ? +v : undefined);
  const ids = new Set();
  const nodes = [];
  const links = [];
  for (const e of parsed.elements) {
    if (!e || typeof e !== "object") continue;
    if (SHAPES.has(e.type) || e.type === "text") {
      const x = num(e.x), y = num(e.y);
      if (x === undefined || y === undefined) continue;
      if (e.type === "text" && typeof e.text !== "string") continue;
      if (e.id) {
        if (ids.has(e.id)) continue;
        ids.add(e.id);
      }
      nodes.push({ ...e, x, y });
    } else if (LINKS.has(e.type)) {
      links.push(e);
    }
  }
  // an arrow may only point at shapes that survived
  const okLinks = links.filter((e) => (!e.start?.id || ids.has(e.start.id)) && (!e.end?.id || ids.has(e.end.id)));
  const out = [...nodes, ...okLinks];
  if (!nodes.length) throw new Error("no valid shapes in reply");
  return out;
}
