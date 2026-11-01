// Notes spec -> Excalidraw skeleton elements: a title block, full-width structure pictures, then a masonry grid
// of typed cards (points, code with syntax colours, tables, callouts, steps, Q&A). Pure and deterministic.
import { wrapText } from "../scene.js";
import { highlight, wrapCodeLine } from "./highlight.js";

export const CARD_W = 560;
const GAP = 32;
const PAD = 22;
const LH = 1.25; // set on every text element, so planned heights match what Excalidraw draws

const SANS = (s) => `${s}px Helvetica, Arial, sans-serif`;
// Excalidraw's own monospace face (fontFamily 3); measuring with the same name keeps the layout exact
const MONO = (s) => `${s}px Cascadia, monospace`;

const ACCENT = {
  points: { stroke: "#495057", fill: "#f8f9fa" },
  code: { stroke: "#1971c2", fill: "#e7f5ff" },
  table: { stroke: "#f08c00", fill: "#fff9db" },
  steps: { stroke: "#7048e8", fill: "#f3f0ff" },
  qa: { stroke: "#e8590c", fill: "#fff4e6" },
  tip: { stroke: "#2f9e44", fill: "#ebfbee" },
  warning: { stroke: "#e03131", fill: "#fff5f5" },
  note: { stroke: "#1971c2", fill: "#e7f5ff" },
  chain: { stroke: "#1971c2", fill: "#ffffff" },
};
const CALLOUT_LABEL = { tip: "Tip", warning: "Watch out", note: "Note" };

export const newNotesPrefix = (now = Date.now()) => `nt${now.toString(36).padStart(9, "0")}_`;

// rough default for tests / when no canvas is available
const estimate = (text, font) => text.length * parseFloat(font) * (/Cascadia|monospace/.test(font) ? 0.6 : 0.52);

export function renderNotes(spec, { measure = estimate, origin = { x: 0, y: 0 }, prefix } = {}) {
  let seq = 0;
  const nid = () => `${prefix}${(seq++).toString(36)}`;
  const m = (text, size, mono) => measure(text, mono ? MONO(size) : SANS(size));
  const wrap = (text, size, maxW) => wrapText(text, SANS(size), maxW, measure);
  const linesOf = (s) => s.split("\n").length;
  const textH = (s, size) => linesOf(s) * size * LH;

  const text = (x, y, s, { size = 15, color = "#212529", mono = false, family } = {}) => ({
    type: "text", id: nid(), x, y, text: s, fontSize: size, fontFamily: mono ? 3 : family ?? 2, strokeColor: color, lineHeight: LH,
  });
  const rect = (x, y, w, h, { fill = "transparent", stroke = "#ced4da", dash = false, round = true, sw = 1.5, label } = {}) => ({
    type: "rectangle", id: nid(), x, y, width: w, height: h, backgroundColor: fill, strokeColor: stroke, strokeWidth: sw,
    strokeStyle: dash ? "dashed" : "solid", roughness: 0, roundness: round ? { type: 3 } : null, fillStyle: "solid", ...(label ? { label } : {}),
  });
  const line = (x, y, pts, { color = "#ced4da", sw = 1 } = {}) => ({ type: "line", id: nid(), x, y, points: pts, strokeColor: color, strokeWidth: sw, roughness: 0 });
  const arrow = (x, y, pts, color = "#495057") => ({
    type: "arrow", id: nid(), x, y, points: pts, strokeColor: color, strokeWidth: 2, roughness: 0, roundness: null, endArrowhead: "triangle",
  });
  const label = (s, size, color, mono) => ({ text: s, fontSize: size, fontFamily: mono ? 3 : 2, strokeColor: color });
  const heading = (s, color, y = PAD - 2) => text(PAD, y, s, { size: 20, color, family: 5 });

  // ---------- card bodies; every builder returns { h, els } positioned relative to the card's top-left ----------
  const inner = CARD_W - PAD * 2;

  function points(sec) {
    const els = [];
    let y = PAD;
    if (sec.title) { els.push(heading(sec.title, ACCENT.points.stroke)); y += 34; }
    for (const b of sec.bullets) {
      const t = wrap(b, 15, inner - 18);
      els.push({ type: "ellipse", id: nid(), x: PAD, y: y + 6, width: 6, height: 6, backgroundColor: "#495057", strokeColor: "#495057", strokeWidth: 1, roughness: 0, fillStyle: "solid" });
      els.push(text(PAD + 18, y, t, { size: 15 }));
      y += textH(t, 15) + 8;
    }
    return { h: y + PAD - 8, els };
  }

  function code(sec) {
    const els = [];
    let y = PAD;
    if (sec.title) {
      els.push(heading(sec.title, ACCENT.code.stroke));
      const badge = sec.language && sec.language !== "text" ? sec.language : "";
      if (badge) els.push(text(CARD_W - PAD - m(badge, 12, true), PAD + 5, badge, { size: 12, color: "#6e7781", mono: true }));
      y += 36;
    }
    const cw = m("M".repeat(40), 14, true) / 40;
    const maxChars = Math.max(20, Math.floor((inner - 28) / cw));
    const lines = sec.code.split("\n").flatMap((l) => wrapCodeLine(l, maxChars));
    const body = lines.join("\n");
    const h = textH(body, 14) + 26;
    els.push(rect(PAD, y, inner, h, { fill: "#f6f8fa", stroke: "#d0d7de", sw: 1 }));
    for (const layer of highlight(body, sec.language)) els.push(text(PAD + 14, y + 13, layer.text, { size: 14, color: layer.color, mono: true }));
    return { h: y + h + PAD, els };
  }

  function table(sec) {
    const els = [];
    let y = PAD;
    if (sec.title) { els.push(heading(sec.title, ACCENT.table.stroke)); y += 34; }
    const n = sec.columns.length;
    const want = sec.columns.map((c, i) => Math.min(inner * 0.55, Math.max(m(c, 14), ...sec.rows.map((r) => m(r[i], 14))) + 18));
    const sum = want.reduce((a, b) => a + b, 0);
    const widths = want.map((w) => Math.max(56, (w / sum) * inner));
    const fix = inner - widths.reduce((a, b) => a + b, 0);
    widths[0] += fix; // rounding slack goes to the first column
    const xs = widths.map((_, i) => PAD + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const cell = (s, i) => wrap(s, 14, widths[i] - 16);
    const rows = [sec.columns, ...sec.rows].map((r) => r.map(cell));
    const heights = rows.map((r) => Math.max(...r.map((t) => textH(t, 14))) + 14);
    const total = heights.reduce((a, b) => a + b, 0);
    els.push(rect(PAD, y, inner, total, { fill: "#ffffff", stroke: "#e0c070", sw: 1 }));
    els.push(rect(PAD, y, inner, heights[0], { fill: "#ffec99", stroke: "#e0c070", sw: 1 }));
    let ry = y;
    rows.forEach((r, ri) => {
      r.forEach((t, ci) => els.push(text(xs[ci] + 8, ry + 7, t, { size: 14, color: ri === 0 ? "#5c3d00" : "#212529" })));
      ry += heights[ri];
      if (ri < rows.length - 1) els.push(line(PAD, ry, [[0, 0], [inner, 0]], { color: "#e9d78a" }));
    });
    for (let ci = 1; ci < n; ci++) els.push(line(xs[ci], y, [[0, 0], [0, total]], { color: "#f1e3a0" }));
    return { h: y + total + PAD, els };
  }

  function callout(sec) {
    const a = ACCENT[sec.kind] || ACCENT.note;
    const els = [rect(0, 0, 7, 10, { fill: a.stroke, stroke: a.stroke, round: false, sw: 1 })]; // height patched below
    let y = PAD;
    els.push(text(PAD + 4, y - 2, sec.title || CALLOUT_LABEL[sec.kind], { size: 20, color: a.stroke, family: 5 }));
    y += 32;
    const t = wrap(sec.text, 15, inner - 8);
    els.push(text(PAD + 4, y, t, { size: 15 }));
    const h = y + textH(t, 15) + PAD;
    els[0].height = h;
    return { h, els, bar: true };
  }

  function steps(sec) {
    const els = [];
    let y = PAD;
    if (sec.title) { els.push(heading(sec.title, ACCENT.steps.stroke)); y += 34; }
    sec.steps.forEach((s, i) => {
      const t = wrap(s, 15, inner - 40);
      const th = textH(t, 15);
      els.push({
        type: "ellipse", id: nid(), x: PAD, y: y + Math.max(0, (th - 26) / 2), width: 26, height: 26, backgroundColor: ACCENT.steps.stroke, strokeColor: ACCENT.steps.stroke,
        strokeWidth: 1, roughness: 0, fillStyle: "solid", label: label(String(i + 1), 14, "#ffffff"),
      });
      els.push(text(PAD + 38, y + Math.max(0, (26 - th) / 2), t, { size: 15 }));
      y += Math.max(th, 26) + 10;
    });
    return { h: y + PAD - 10, els };
  }

  function qa(sec) {
    const els = [];
    let y = PAD;
    if (sec.title) { els.push(heading(sec.title, ACCENT.qa.stroke)); y += 34; }
    for (const it of sec.items) {
      const q = wrap(it.q, 15, inner - 26), a = wrap(it.a, 15, inner - 26);
      els.push(text(PAD, y, "Q", { size: 15, color: ACCENT.qa.stroke, family: 5 }));
      els.push(text(PAD + 26, y, q, { size: 15, color: "#d9480f" }));
      y += textH(q, 15) + 4;
      els.push(text(PAD, y, "A", { size: 15, color: "#495057", family: 5 }));
      els.push(text(PAD + 26, y, a, { size: 15 }));
      y += textH(a, 15) + 14;
    }
    return { h: y + PAD - 14, els };
  }

  // a picture of a data structure, full width
  function chain(sec, W) {
    const els = [];
    const accent = ACCENT.chain.stroke;
    let y = PAD;
    if (sec.title) { els.push(heading(sec.title, accent)); y += 36; }
    const kind = sec.kind;
    const n = sec.nodes.length;
    const spec = { linked: { parts: [84, 52], gap: 64 }, doubly: { parts: [44, 84, 44], gap: 56 }, boxes: { parts: [120], gap: 64 }, array: { parts: [76], gap: 0 } }[kind];
    const natural = n * spec.parts.reduce((a, b) => a + b, 0) + (n - 1) * spec.gap + (kind === "linked" || kind === "doubly" ? spec.gap + 84 : 0);
    const f = Math.min(1, (W - PAD * 2 - 8) / natural);
    const sz = (v) => Math.round(v * f);
    const H = 52;
    const hasPtr = sec.pointers.length > 0;
    const top = y + (hasPtr ? 52 : 0);
    const cy = top + H / 2;
    let x = PAD + 4;
    const dataCenter = [];
    const place = (label0, fill, stroke, w, round = false) => {
      els.push(rect(x, top, w, H, { fill, stroke, round, sw: 2, label: label(label0, 18, "#1c2b3a") }));
      const c = x + w / 2;
      x += w;
      return c;
    };
    sec.nodes.forEach((nodeLabel, i) => {
      if (kind === "linked") {
        const c = place(nodeLabel, "#a5d8ff", "#1971c2", sz(84));
        dataCenter[i] = c;
        const nx = x;
        els.push(rect(x, top, sz(52), H, { fill: "#ffec99", stroke: "#f08c00", round: false, sw: 2, label: label("next", 14, "#a65f00") }));
        x += sz(52);
        els.push(arrow(nx + sz(52), cy, [[0, 0], [sz(spec.gap), 0]], "#495057"));
        x += sz(spec.gap);
      } else if (kind === "doubly") {
        els.push(rect(x, top, sz(44), H, { fill: "#ffec99", stroke: "#f08c00", round: false, sw: 2, label: label("prev", 13, "#a65f00") }));
        x += sz(44);
        dataCenter[i] = place(nodeLabel, "#a5d8ff", "#1971c2", sz(84));
        els.push(rect(x, top, sz(44), H, { fill: "#ffec99", stroke: "#f08c00", round: false, sw: 2, label: label("next", 13, "#a65f00") }));
        x += sz(44);
        els.push(arrow(x, cy - 9, [[0, 0], [sz(spec.gap), 0]], "#495057"));
        els.push(arrow(x + sz(spec.gap), cy + 9, [[0, 0], [-sz(spec.gap), 0]], "#495057"));
        x += sz(spec.gap);
      } else if (kind === "boxes") {
        dataCenter[i] = place(nodeLabel, "#a5d8ff", "#1971c2", sz(120), true);
        if (i < n - 1) {
          els.push(arrow(x, cy, [[0, 0], [sz(spec.gap), 0]], "#495057"));
          x += sz(spec.gap);
        }
      } else {
        dataCenter[i] = place(nodeLabel, i % 2 ? "#d0ebff" : "#a5d8ff", "#1971c2", sz(76));
        els.push(text(dataCenter[i] - 4, top + H + 4, String(i), { size: 12, color: "#868e96" }));
      }
    });
    if (kind === "linked" || kind === "doubly") {
      els.push(rect(x, top, sz(84), H, { fill: "#e9ecef", stroke: "#868e96", round: true, sw: 2, label: label(sec.end || "None", 16, "#495057") }));
      x += sz(84);
    }
    sec.pointers.forEach((p) => {
      const w = Math.max(54, m(p.label, 15) + 24);
      const c = dataCenter[p.at];
      els.push(rect(c - w / 2, y + 2, w, 30, { fill: "#ffd8a8", stroke: "#e8590c", sw: 2, label: label(p.label, 15, "#c2410c") }));
      els.push(arrow(c, y + 32, [[0, 0], [0, 16]], "#e8590c"));
    });
    let bottom = top + H + (kind === "array" ? 22 : 0);
    if (sec.caption) {
      const t = wrap(sec.caption, 15, W - PAD * 2);
      els.push(text(PAD + 4, bottom + 16, t, { size: 15, color: "#495057" }));
      bottom += 16 + textH(t, 15);
    }
    return { h: bottom + PAD, els };
  }

  // ---------- assemble ----------
  const body = spec.sections.filter((s) => s.type !== "chain");
  const banners = spec.sections.filter((s) => s.type === "chain");
  const cols = body.length <= 1 ? 1 : body.length === 2 ? 2 : body.length === 3 ? 3 : body.length === 4 ? 2 : 3;
  const gridW = Math.max(cols, 2) * CARD_W + (Math.max(cols, 2) - 1) * GAP;
  const out = [];
  const ox = origin.x;
  let y = origin.y;

  out.push(text(ox, y, spec.title, { size: 44, color: "#1971c2", family: 5 }));
  y += 44 * LH + 8;
  if (spec.subtitle) {
    const t = wrap(spec.subtitle, 20, gridW);
    out.push(text(ox, y, t, { size: 20, color: "#495057" }));
    y += textH(t, 20) + 8;
  }
  y += 18;

  let gi = 0;
  const putCard = (built, kind, x, yy, w) => {
    const a = ACCENT[kind];
    const group = [`${prefix}k${gi++}`];
    const els = [];
    els.push(rect(0, 0, w, built.h, { fill: a.fill, stroke: a.stroke, sw: 2 }));
    for (const e of built.els) els.push(e);
    for (const e of els) out.push({ ...e, x: (e.x || 0) + x, y: (e.y || 0) + yy, groupIds: group });
  };

  for (const sec of banners) {
    const built = chain(sec, gridW);
    putCard(built, "chain", ox, y, gridW);
    y += built.h + GAP;
  }

  const colY = new Array(cols).fill(y);
  const builders = { points, code, table, callout, steps, qa };
  for (const sec of body) {
    const built = builders[sec.type](sec);
    const kind = sec.type === "callout" ? sec.kind : sec.type;
    let c = 0;
    for (let i = 1; i < cols; i++) if (colY[i] < colY[c]) c = i;
    // callout: its accent bar sits on top of the card, drawn after the card background
    putCard(built, kind, ox + c * (CARD_W + GAP), colY[c], CARD_W);
    colY[c] += built.h + GAP;
  }

  const bottom = Math.max(...colY) - GAP;
  return { skeleton: out, bbox: { x: ox, y: origin.y, w: gridW, h: bottom - origin.y }, cols };
}

// Monospace text has an exactly known size. Excalidraw sizes an element from whatever font is loaded when it is
// created (a proportional fallback if Cascadia is not ready yet) and clips text to that width, so set it ourselves.
export function fixMonospace(elements, charWidth14) {
  return elements.map((e) => {
    if (e.type !== "text" || e.fontFamily !== 3) return e;
    const lines = e.text.split("\n");
    const cw = (charWidth14 * e.fontSize) / 14;
    return { ...e, width: Math.max(...lines.map((l) => l.length)) * cw, height: lines.length * e.fontSize * (e.lineHeight || LH) };
  });
}

// let the fonts the notes use finish loading before anything is measured
export async function loadNoteFonts(fonts = typeof document !== "undefined" ? document.fonts : null) {
  if (!fonts?.load) return;
  try {
    await Promise.race([
      Promise.all(["14px Cascadia", "20px Excalifont", "15px Helvetica"].map((f) => fonts.load(f))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {}
}
