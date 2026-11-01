// Pure scene helpers: no DOM, no Excalidraw imports, so they run under `node --test`.

const live = (els) => els.filter((e) => !e.isDeleted);
const rid = () => Math.floor(Math.random() * 2 ** 31);

export function bump(el, patch) {
  return { ...el, ...patch, version: (el.version || 0) + 1, versionNonce: rid(), updated: Date.now() };
}

export function labelOf(el, byId) {
  if (el.type === "text") return el.text || "";
  const t = el.boundElements?.find((b) => b.type === "text");
  return (t && byId[t.id]?.text) || "";
}

// ---- what the model is told about the canvas ----
// Returns { text, knownIds }. Selected elements come first, marked with ">".
export function describeScene(elements, selectedIds = new Set(), cap = 150) {
  const els = live(elements);
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  const lines = [];
  const knownIds = [];
  const clip = (s) => s.slice(0, 40).replace(/\n/g, " ");
  const shown = els.filter((e) => !(e.type === "text" && e.containerId && byId[e.containerId]));
  const ordered = [...shown.filter((e) => selectedIds.has(e.id)), ...shown.filter((e) => !selectedIds.has(e.id))].slice(0, cap);
  for (const e of ordered) {
    const mark = selectedIds.has(e.id) ? ">" : " ";
    const label = clip(labelOf(e, byId));
    if (e.type === "arrow" || e.type === "line") {
      const a = e.startBinding && byId[e.startBinding.elementId];
      const b = e.endBinding && byId[e.endBinding.elementId];
      const name = (x) => (x ? `${clip(labelOf(x, byId)) || x.type}(${x.id})` : "?");
      lines.push(`${mark} id=${e.id} ${e.type}${label ? ` "${label}"` : ""} ${name(a)} -> ${name(b)}`);
    } else {
      lines.push(`${mark} id=${e.id} ${e.type}${label ? ` "${label}"` : ""} @(${Math.round(e.x)},${Math.round(e.y)}) ${Math.round(e.width)}x${Math.round(e.height)}`);
    }
    knownIds.push(e.id);
  }
  return { text: lines.join("\n"), knownIds };
}

export function selectedIdsOf(appState) {
  return new Set(Object.entries(appState?.selectedElementIds || {}).filter(([, v]) => v).map(([k]) => k));
}

// ---- placing new content ----
export function freeSpace(elements) {
  const l = live(elements);
  if (!l.length) return { ox: 0, oy: 0 };
  return { ox: Math.min(...l.map((e) => e.x)), oy: Math.max(...l.map((e) => e.y + e.height)) + 120 };
}

// Prefix every id the reply introduced so repeated requests never collide ("api" -> "k3f-api").
// References to ids the skeleton does not define (existing canvas elements) stay as they are.
export function namespaceIds(skeleton, prefix) {
  const own = new Set(skeleton.filter((e) => e.id).map((e) => e.id));
  const re = (ref) => (ref && ref.id && own.has(ref.id) ? { ...ref, id: prefix + ref.id } : ref);
  let n = 0;
  return skeleton.map((e) => {
    const out = { ...e, id: e.id ? prefix + e.id : `${prefix}auto${n++}` };
    if (e.start) out.start = re(e.start);
    if (e.end) out.end = re(e.end);
    return out;
  });
}

// point on the edge of `a` facing `b` (side midpoints, top/bottom when mostly vertical)
export function edge(a, b) {
  const aw = a.width ?? 200, ah = a.height ?? 80;
  const bw = b.width ?? 200, bh = b.height ?? 80;
  const acx = a.x + aw / 2, acy = a.y + ah / 2;
  const dx = b.x + bw / 2 - acx, dy = b.y + bh / 2 - acy;
  return Math.abs(dx) * ah >= Math.abs(dy) * aw
    ? [acx + Math.sign(dx || 1) * (aw / 2), acy]
    : [acx, acy + Math.sign(dy || 1) * (ah / 2)];
}

// Give bound arrows real coordinates so they span the gap between their shapes.
// `byId` holds both the new skeleton shapes and the existing canvas elements.
export function connect(e, byId) {
  if (e.type !== "arrow" || !e.start?.id || !e.end?.id) return e;
  const a = byId[e.start.id], b = byId[e.end.id];
  if (!a || !b) return e;
  const [sx, sy] = edge(a, b);
  const [ex, ey] = edge(b, a);
  // a 0 width/height is treated as "unset" by the converter and replaced by a default
  return { ...e, x: sx, y: sy, width: ex - sx || 0.01, height: ey - sy || 0.01 };
}

// The converter only binds arrows to shapes inside the same batch. For arrows that point at
// elements already on the canvas, add the binding ourselves. -> { created, patched: Map<id, element> }
export function bindToExisting(created, existingById, skeleton) {
  const patched = new Map();
  const wire = (arrow, side, ref) => {
    const target = patched.get(ref.id) || existingById[ref.id];
    if (!target) return arrow;
    patched.set(target.id, bump(target, { boundElements: [...(target.boundElements || []), { id: arrow.id, type: "arrow" }] }));
    return { ...arrow, [side]: { elementId: target.id, focus: 0, gap: 4 } };
  };
  const out = created.map((el) => {
    const sk = skeleton.find((s) => s.id === el.id);
    if (!sk || el.type !== "arrow") return el;
    let a = el;
    if (sk.start?.id && existingById[sk.start.id]) a = wire(a, "startBinding", sk.start);
    if (sk.end?.id && existingById[sk.end.id]) a = wire(a, "endBinding", sk.end);
    return a;
  });
  return { created: out, patched };
}

// ---- edits to existing elements ----
// ---- bound-text layout (what Excalidraw does when you edit a label) ----
const FONT_NAMES = { 1: "Virgil", 2: "Helvetica", 3: "Cascadia", 5: "Excalifont", 6: "Nunito" };
const PAD = 5;

export function boundTextMaxWidth(c) {
  if (c.type === "ellipse") return Math.round((c.width / 2) * Math.SQRT2) - PAD * 2;
  if (c.type === "diamond") return Math.round(c.width / 2) - PAD * 2;
  return c.width - PAD * 2;
}

// greedy word wrap; `measure(text, font)` -> pixel width
export function wrapText(text, font, maxWidth, measure) {
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, font) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

// Re-wrap, re-measure and re-center a container's label.
export function layoutBoundText(t, container, measure) {
  const font = `${t.fontSize}px ${FONT_NAMES[t.fontFamily] || "sans-serif"}`;
  const wrapped = wrapText(t.originalText ?? t.text, font, boundTextMaxWidth(container), measure);
  const lines = wrapped.split("\n");
  const width = Math.max(...lines.map((l) => measure(l, font)));
  const height = lines.length * t.fontSize * (t.lineHeight || 1.25);
  return bump(t, {
    text: wrapped,
    width,
    height,
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
  });
}

export function applyUpdates(elements, updates, measure) {
  if (!updates.length) return elements;
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const boundText = new Map(); // container id -> its bound text element id
  for (const e of elements) if (e.type === "text" && e.containerId) boundText.set(e.containerId, e.id);
  const patches = new Map();
  const add = (id, p) => patches.set(id, { ...(patches.get(id) || {}), ...p });
  for (const { id, set } of updates) {
    const e = byId[id];
    if (!e || e.isDeleted) continue;
    for (const [k, v] of Object.entries(set)) {
      if (k === "text") {
        if (e.type === "text") add(id, { text: v, originalText: v });
        else if (boundText.has(id)) add(boundText.get(id), { text: v, originalText: v });
      } else if (k === "fontSize") {
        if (e.type === "text") add(id, { fontSize: v });
        else if (boundText.has(id)) add(boundText.get(id), { fontSize: v });
      } else if ((k === "width" || k === "height") && ["arrow", "line", "text"].includes(e.type)) {
        continue; // sizes of arrows and text follow their content
      } else {
        add(id, { [k]: v });
      }
    }
  }
  let out = elements.map((e) => (patches.has(e.id) ? bump(e, patches.get(e.id)) : e));
  if (measure) {
    // labels whose text/font changed, or whose container was resized
    const resized = new Set(updates.filter((u) => "width" in u.set || "height" in u.set).map((u) => u.id));
    const outById = Object.fromEntries(out.map((e) => [e.id, e]));
    out = out.map((e) => {
      const c = e.type === "text" && e.containerId && outById[e.containerId];
      return c && (patches.has(e.id) || resized.has(c.id)) ? layoutBoundText(e, c, measure) : e;
    });
  }
  return out;
}

// mark elements deleted, plus their bound text and any arrows attached to them
export function applyDeletes(elements, ids) {
  if (!ids.length) return elements;
  const dead = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of elements) {
      if (dead.has(e.id)) continue;
      const attached =
        (e.type === "text" && e.containerId && dead.has(e.containerId)) ||
        ((e.type === "arrow" || e.type === "line") && (dead.has(e.startBinding?.elementId) || dead.has(e.endBinding?.elementId)));
      if (attached) {
        dead.add(e.id);
        grew = true;
      }
    }
  }
  return elements.map((e) => (dead.has(e.id) && !e.isDeleted ? bump(e, { isDeleted: true }) : e));
}

// ---- styles ----
export const PALETTES = {
  pastel: { fills: ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffc9c9", "#d0bfff"], strokes: ["#1971c2", "#2f9e44", "#f08c00", "#e03131", "#7048e8"] },
  mono: { fills: ["#f1f3f5", "#e9ecef", "#dee2e6", "#ced4da", "#adb5bd"], strokes: ["#343a40", "#343a40", "#343a40", "#343a40", "#343a40"] },
  bold: { fills: ["#74c0fc", "#69db7c", "#ffd43b", "#ff8787", "#b197fc"], strokes: ["#1864ab", "#2b8a3e", "#e67700", "#c92a2a", "#5f3dc4"] },
};

// fontFamily ids: 2 Helvetica, 3 Cascadia, 5 Excalifont
export const STYLES = [
  { id: "sketch", name: "Hand-drawn", roughness: 1, fontFamily: 5, strokeWidth: 2, rounded: true, palette: "pastel", snap: false },
  { id: "clean", name: "Clean", roughness: 0, fontFamily: 2, strokeWidth: 1, rounded: true, palette: "pastel", snap: true },
  { id: "mono", name: "Mono", roughness: 0, fontFamily: 2, strokeWidth: 1, rounded: false, palette: "mono", snap: true },
  { id: "bold", name: "Bold sketch", roughness: 1, fontFamily: 5, strokeWidth: 3, rounded: true, palette: "bold", snap: false },
];

export const styleById = (id) => STYLES.find((s) => s.id === id) || STYLES[0];

const SHAPE = new Set(["rectangle", "ellipse", "diamond"]);

// Apply a style preset to freshly created elements. `recolor(element)` -> true repaints that node's fill
// (used for Mermaid output, which carries no colors of its own).
export function applyStyle(elements, style, { recolor = () => false } = {}) {
  const pal = PALETTES[style.palette] || PALETTES.pastel;
  const snap = (v) => (style.snap ? Math.round(v / 20) * 20 : v);
  return elements.map((e) => {
    const patch = { roughness: style.roughness };
    if (e.type === "text") patch.fontFamily = style.fontFamily;
    if (SHAPE.has(e.type) || e.type === "arrow" || e.type === "line") patch.strokeWidth = style.strokeWidth;
    if (e.type === "rectangle") patch.roundness = style.rounded ? { type: 3 } : null;
    if (SHAPE.has(e.type) && recolor(e)) {
      const i = e.type === "diamond" ? 2 : 0;
      patch.backgroundColor = pal.fills[i];
      patch.strokeColor = pal.strokes[i];
      patch.fillStyle = "solid";
    }
    if (style.snap && SHAPE.has(e.type)) Object.assign(patch, { x: snap(e.x), y: snap(e.y) });
    return { ...e, ...patch };
  });
}

export function summarizeResult(reply, createdLabels) {
  const parts = [];
  if (createdLabels.length) parts.push(`added ${createdLabels.slice(0, 12).join(", ")}${createdLabels.length > 12 ? "…" : ""}`);
  if (reply.update.length) parts.push(`updated ${reply.update.length} element(s)`);
  if (reply.delete.length) parts.push(`deleted ${reply.delete.length} element(s)`);
  return parts.join("; ") || "nothing";
}
