import { GROUP_STYLE, ICON } from "./layout.js";
import { bump } from "../scene.js";

const INK = "#232F3E"; // AWS arrow / text colour
const GENERIC = { fill: "#F2F3F3", stroke: "#7D8998" };

export const iconFileId = (file) => `aws-${file.replace(/\.svg$/, "").replace(/[^a-z0-9]+/g, "-")}`;

// utf-8 safe base64 data URL for an SVG document
export function svgToDataUrl(svg) {
  const b64 =
    typeof Buffer !== "undefined" ? Buffer.from(svg, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}

// fixed width, so prefixes sort in creation order (the newest diagram is the greatest)
export function newDiagramPrefix(now = Date.now()) {
  return `aws${now.toString(36).padStart(9, "0")}_`;
}

// icons: Map(file -> svg text). Returns { skeleton, files, centers, bbox } for convertToExcalidrawElements.
// Every skeleton id starts with `prefix`, which is how a diagram is found again later (edit / replace).
export function renderAws(layout, { spec, prefix, origin = { x: 0, y: 0 }, icons }) {
  const pts = [
    ...layout.groups.flatMap((g) => [[g.x, g.y], [g.x + g.w, g.y + g.h]]),
    ...layout.nodes.flatMap((n) => [[n.x, n.y], [n.x + n.w, n.y + (n.labelBox ? n.labelBox.y - n.y + n.labelBox.h : n.h)]]),
    ...layout.edges.flatMap((e) => e.points),
  ];
  const minX = Math.min(...pts.map((p) => p[0])), minY = Math.min(...pts.map((p) => p[1]));
  const maxX = Math.max(...pts.map((p) => p[0])), maxY = Math.max(...pts.map((p) => p[1]));
  const dx = origin.x - minX + (spec.title ? 0 : 0), dy = origin.y - minY + (spec.title ? 44 : 0);
  const X = (v) => v + dx, Y = (v) => v + dy;

  const skeleton = [];
  const files = {};
  const centers = [];
  const useIcon = (file) => {
    const svg = icons.get(file);
    if (!svg) return null;
    const id = iconFileId(file);
    files[id] ||= { id, mimeType: "image/svg+xml", dataURL: svgToDataUrl(svg), created: 1 };
    return id;
  };
  const base = { roughness: 0, strokeWidth: 2, roundness: null, fillStyle: "solid" };

  if (spec.title) {
    skeleton.push({ type: "text", id: `${prefix}title`, x: X(minX), y: origin.y, text: spec.title, fontSize: 24, fontFamily: 2, strokeColor: INK });
  }

  // 1. groups, outermost first
  for (const g of layout.groups) {
    const st = GROUP_STYLE[g.kind] || GROUP_STYLE.generic;
    skeleton.push({
      ...base, type: "rectangle", id: `${prefix}g-${g.id}`, x: X(g.x), y: Y(g.y), width: g.w, height: g.h,
      strokeColor: st.color, backgroundColor: st.fill || "transparent", strokeStyle: st.dashed ? "dashed" : "solid",
    });
    const fid = st.icon ? useIcon(`groups/${st.icon}.svg`) : null;
    if (fid) skeleton.push({ type: "image", id: `${prefix}gi-${g.id}`, fileId: fid, x: X(g.x), y: Y(g.y), width: 32, height: 32, status: "saved" });
    const label = g.label || st.name;
    if (label) {
      skeleton.push({
        type: "text", id: `${prefix}gl-${g.id}`, x: X(g.x) + (fid ? 40 : 12), y: Y(g.y) + (fid ? 6 : 8), text: label,
        fontSize: 16, fontFamily: 2, strokeColor: g.kind === "aws-cloud" ? INK : st.color,
      });
    }
  }

  // 2. edges (under the icons)
  // The converter cannot bind arrows to image elements, so arrows are bound after conversion (bindArrows).
  const nodeIds = new Map(layout.nodes.map((n) => [n.id, `${prefix}n-${n.id}`]));
  const links = [];
  layout.edges.forEach((e, i) => {
    if (e.points.length < 2) return;
    links.push({ arrow: `${prefix}e-${i}`, from: nodeIds.get(e.from), to: nodeIds.get(e.to) });
    const [p0] = e.points;
    skeleton.push({
      ...base, type: "arrow", id: `${prefix}e-${i}`, x: X(p0[0]), y: Y(p0[1]),
      points: e.points.map((p) => [p[0] - p0[0], p[1] - p0[1]]),
      endArrowhead: "triangle", startArrowhead: e.bidirectional ? "triangle" : null, strokeColor: INK,
      ...(e.label ? { label: { text: e.label, fontSize: 13, fontFamily: 2, strokeColor: INK } } : {}),
    });
  });

  // 3. icons and their labels
  for (const n of layout.nodes) {
    const fid = n.file ? useIcon(n.file) : null;
    const gid = [`${prefix}grp-${n.id}`];
    if (fid) skeleton.push({ type: "image", id: `${prefix}n-${n.id}`, fileId: fid, x: X(n.x), y: Y(n.y), width: ICON, height: ICON, status: "saved", groupIds: gid });
    else skeleton.push({ ...base, type: "rectangle", id: `${prefix}n-${n.id}`, x: X(n.x), y: Y(n.y), width: ICON, height: ICON, strokeColor: GENERIC.stroke, backgroundColor: GENERIC.fill, groupIds: gid });
    const lx = n.labelBox ? n.labelBox.x : n.x, ly = n.labelBox ? n.labelBox.y : n.y + ICON + 6;
    const tid = `${prefix}t-${n.id}`;
    skeleton.push({ type: "text", id: tid, x: X(lx), y: Y(ly), text: n.lines.join("\n"), fontSize: 14, fontFamily: 2, textAlign: "center", strokeColor: INK, groupIds: gid });
    centers.push({ id: tid, cx: X(n.x + n.w / 2) });
  }

  // 4. numbered step badges, a quarter of the way along the longest segment of each numbered edge
  //    (the longest segment is the least likely to be shared with a sibling edge or to hold the label)
  layout.edges.forEach((e, i) => {
    if (!e.step || e.points.length < 2) return;
    let best = [e.points[0], e.points[1]], bestLen = -1;
    for (let k = 0; k + 1 < e.points.length; k++) {
      const len = Math.hypot(e.points[k + 1][0] - e.points[k][0], e.points[k + 1][1] - e.points[k][1]);
      if (len > bestLen) [best, bestLen] = [[e.points[k], e.points[k + 1]], len];
    }
    const t = bestLen > 0 ? Math.min(0.25, 26 / bestLen) : 0;
    const cx = X(best[0][0] + (best[1][0] - best[0][0]) * t), cy = Y(best[0][1] + (best[1][1] - best[0][1]) * t);
    skeleton.push({
      ...base, strokeWidth: 1, type: "ellipse", id: `${prefix}s-${i}`, x: cx - 11, y: cy - 11, width: 22, height: 22,
      strokeColor: INK, backgroundColor: INK, label: { text: String(e.step), fontSize: 12, fontFamily: 2, strokeColor: "#FFFFFF" },
    });
  });

  return { skeleton, files, centers, links, bbox: { x: X(minX), y: Y(minY), w: maxX - minX, h: maxY - minY } };
}

// text boxes are measured by Excalidraw after conversion; centre them under their icons
export function recenterLabels(elements, centers) {
  const cx = new Map(centers.map((c) => [c.id, c.cx]));
  return elements.map((e) => (cx.has(e.id) ? { ...e, x: cx.get(e.id) - e.width / 2 } : e));
}

// Bind each arrow to the icons at both ends, so it follows when an icon is moved.
export function bindArrows(elements, links) {
  const patch = new Map();
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const attach = (id, arrowId) => {
    const el = patch.get(id) || byId[id];
    if (el) patch.set(id, { ...el, boundElements: [...(el.boundElements || []), { id: arrowId, type: "arrow" }] });
  };
  for (const l of links) {
    const arrow = patch.get(l.arrow) || byId[l.arrow];
    if (!arrow || !byId[l.from] || !byId[l.to]) continue;
    patch.set(l.arrow, bump(arrow, { startBinding: { elementId: l.from, focus: 0, gap: 2 }, endBinding: { elementId: l.to, focus: 0, gap: 2 } }));
    attach(l.from, l.arrow);
    attach(l.to, l.arrow);
  }
  return elements.map((e) => patch.get(e.id) || e);
}
