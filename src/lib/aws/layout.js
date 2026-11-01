// Pure AWS-spec layout, in two steps:
//  1. structure: nested groups are arranged the way AWS reference diagrams are drawn (flow tiers left to right,
//     availability zones side by side, subnets stacked inside a zone), sized bottom-up and placed on an 8px grid;
//  2. routing: every edge is routed orthogonally around the icons on that grid (A* with bend / overlap penalties).
// The model never positions anything, so the result is deterministic and independent of model quality.
export const ICON = 64;
const GRID = 8;
const LINE_H = 18;
const CHAR_W = 7.4; // average Helvetica width at 14px; replaced by a real measurer in the browser
const PAD = { top: 52, side: 28, bottom: 28 };
const GAP = { col: 96, row: 40 };

export const GROUP_STYLE = {
  "aws-cloud": { color: "#242F3E", icon: "aws-cloud", name: "AWS Cloud" },
  account: { color: "#E7157B", icon: "account", name: "AWS account" },
  region: { color: "#00A4A6", dashed: true, icon: "region", name: "Region" },
  vpc: { color: "#8C4FFF", icon: "vpc", name: "VPC" },
  az: { color: "#00A4A6", dashed: true, name: "Availability Zone" },
  "public-subnet": { color: "#7AA116", fill: "#F2F6E9", icon: "public-subnet", name: "Public subnet" },
  "private-subnet": { color: "#00A4A6", fill: "#E9F6F6", icon: "private-subnet", name: "Private subnet" },
  "security-group": { color: "#DD344C", name: "Security group" },
  "auto-scaling-group": { color: "#ED7100", dashed: true, icon: "auto-scaling-group", name: "Auto Scaling group" },
  "corporate-data-center": { color: "#7D8998", icon: "corporate-data-center", name: "Corporate data center" },
  "server-contents": { color: "#7D8998", icon: "server-contents", name: "Server contents" },
  "ec2-instance-contents": { color: "#ED7100", icon: "ec2-instance-contents", name: "EC2 instance contents" },
  generic: { color: "#7D8998", dashed: true, name: "" },
};

const snap = (v) => Math.round(v / GRID) * GRID;
const estimate = (text) => text.length * CHAR_W;

// wrap to at most 3 short lines so labels stay under their icon
export function wrapLabel(label, max = 16) {
  const lines = [];
  let line = "";
  for (const w of label.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > max) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  if (lines.length > 3) return [...lines.slice(0, 2), lines.slice(2).join(" ").slice(0, max - 1) + "…"];
  return lines.length ? lines : [""];
}

// Flow tier of every node: longest path from a source, ignoring edges that would close a cycle.
export function nodeTiers(spec) {
  const out = new Map(spec.nodes.map((n) => [n.id, []]));
  for (const e of spec.edges) out.get(e.from)?.push(e.to);
  const state = new Map(), back = new Set();
  const dfs = (u) => {
    state.set(u, 1);
    for (const v of out.get(u) || []) {
      if (state.get(v) === 1) back.add(`${u}>${v}`);
      else if (!state.has(v)) dfs(v);
    }
    state.set(u, 2);
  };
  for (const n of spec.nodes) if (!state.has(n.id)) dfs(n.id);
  const tier = new Map(spec.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < spec.nodes.length; pass++) {
    let changed = false;
    for (const e of spec.edges) {
      if (back.has(`${e.from}>${e.to}`)) continue;
      if (tier.get(e.to) < tier.get(e.from) + 1) {
        tier.set(e.to, tier.get(e.from) + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return tier;
}

// ---------- step 1: structure ----------
function arrange(spec, measure) {
  const tier = nodeTiers(spec);
  const groupById = new Map(spec.groups.map((g) => [g.id, g]));
  const kids = new Map();
  const order = new Map();
  let seq = 0;
  const add = (parent, item) => {
    const k = parent && groupById.has(parent) ? parent : "__root";
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(item);
    order.set(item.id, seq++);
  };
  for (const g of spec.groups) add(g.parent, { kind: "group", id: g.id });
  for (const n of spec.nodes) add(n.parent, { kind: "node", id: n.id });

  const rankMemo = new Map();
  const rank = (item) => {
    if (rankMemo.has(item.id)) return rankMemo.get(item.id);
    const r = item.kind === "node" ? tier.get(item.id) : Math.min(...(kids.get(item.id) || []).map(rank), Infinity);
    const v = Number.isFinite(r) ? r : 0;
    rankMemo.set(item.id, v);
    return v;
  };
  const byRank = (a, b) => rank(a) - rank(b) || order.get(a.id) - order.get(b.id);

  const columnsByTier = (items) => {
    const m = new Map();
    for (const it of [...items].sort(byRank)) {
      const r = rank(it);
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(it);
    }
    return [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k));
  };

  // -> { w, h, cols: [{ items: [sized], w, h }], pad } for groups; { w, h, lines } for nodes
  const sized = new Map();
  const size = (item) => {
    if (sized.has(item.id)) return sized.get(item.id);
    let s;
    if (item.kind === "node") {
      const n = spec.nodes.find((x) => x.id === item.id);
      const lines = wrapLabel(n.label);
      const lw = Math.max(...lines.map((l) => measure(l)));
      s = { item, w: Math.max(ICON + 32, Math.ceil(lw) + 16), h: ICON + 8 + lines.length * LINE_H, lines };
    } else {
      const g = groupById.get(item.id);
      const children = kids.get(g.id) || [];
      // flow reads left to right at every level: tiers become columns, same-tier siblings (e.g. two zones) stack
      const cols = columnsByTier(children);
      const placed = cols.map((items) => {
        const sz = items.map(size);
        return { items: sz, w: Math.max(...sz.map((x) => x.w)), h: sz.reduce((a, x) => a + x.h, 0) + GAP.row * (sz.length - 1) };
      });
      const gapCol = GAP.col;
      const contentW = placed.length ? placed.reduce((a, c) => a + c.w, 0) + gapCol * (placed.length - 1) : 0;
      const contentH = placed.length ? Math.max(...placed.map((c) => c.h)) : 0;
      s = { item, group: g, cols: placed, gapCol, w: Math.max(220, contentW + PAD.side * 2), h: Math.max(120, contentH + PAD.top + PAD.bottom), contentW, contentH };
    }
    sized.set(item.id, s);
    return s;
  };
  return { kids, size, groupById, columnsByTier };
}

export function layoutAws(spec, { measure = estimate } = {}) {
  const { kids, size, columnsByTier } = arrange(spec, measure);
  const groups = [], nodes = [];

  // place a sized item with its top-left corner at (x, y)
  const place = (s, x, y, depth) => {
    if (s.item.kind === "node") {
      const ix = snap(x + (s.w - ICON) / 2), iy = snap(y);
      const lw = Math.max(...s.lines.map((l) => measure(l)));
      nodes.push({
        ...spec.nodes.find((n) => n.id === s.item.id), x: ix, y: iy, w: ICON, h: ICON, lines: s.lines,
        labelBox: { x: ix + ICON / 2 - lw / 2, y: iy + ICON + 6, w: lw, h: s.lines.length * LINE_H },
      });
      return;
    }
    const gx = snap(x), gy = snap(y);
    groups.push({ ...s.group, x: gx, y: gy, w: snap(s.w), h: snap(s.h), depth });
    let cx = gx + PAD.side + (s.w - PAD.side * 2 - s.contentW) / 2;
    for (const col of s.cols) {
      let cy = gy + PAD.top + (s.h - PAD.top - PAD.bottom - col.h) / 2;
      for (const it of col.items) {
        place(it, cx + (col.w - it.w) / 2, cy, depth + 1);
        cy += it.h + GAP.row;
      }
      cx += col.w + s.gapCol;
    }
  };

  // root: tier columns, no frame
  const rootItems = kids.get("__root") || [];
  const cols = columnsByTier(rootItems).map((items) => {
    const sz = items.map(size);
    return { items: sz, w: Math.max(...sz.map((x) => x.w)), h: sz.reduce((a, x) => a + x.h, 0) + GAP.row * (sz.length - 1) };
  });
  const totalH = Math.max(...cols.map((c) => c.h));
  let x = 24;
  for (const col of cols) {
    const lopsided = col.items.every((it) => it.item.kind === "node") && cols.some((c) => c.items.some((it) => it.item.kind === "group"));
    let y = 24 + (totalH - col.h) / 2 + (lopsided ? (PAD.top - PAD.bottom) / 2 : 0);
    for (const it of col.items) {
      place(it, x + (col.w - it.w) / 2, y, 0);
      y += it.h + GAP.row;
    }
    x += col.w + GAP.col;
  }

  groups.sort((a, b) => a.depth - b.depth); // outer groups first so they draw underneath
  const edges = routeEdges(spec, nodes, groups);
  const right = [...groups.map((g) => g.x + g.w), ...nodes.map((n) => Math.max(n.x + n.w, n.labelBox.x + n.labelBox.w))];
  const bottom = [...groups.map((g) => g.y + g.h), ...nodes.map((n) => n.labelBox.y + n.labelBox.h)];
  return { groups, nodes, edges, width: Math.max(...right) + 24, height: Math.max(...bottom) + 24 };
}

// ---------- step 2: orthogonal routing ----------
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N
const BEND = 7, OVERLAP = 6, CROSS = 2, BORDER = 3;

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(f, v) {
    const a = this.a;
    a.push([f, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
}

export function routeEdges(spec, nodes, groups) {
  const margin = GRID * 6;
  const x0 = Math.floor((Math.min(...nodes.map((n) => n.x), ...groups.map((g) => g.x)) - margin) / GRID) * GRID;
  const y0 = Math.floor((Math.min(...nodes.map((n) => n.y), ...groups.map((g) => g.y)) - margin) / GRID) * GRID;
  const x1 = Math.max(...nodes.map((n) => n.x + n.w), ...groups.map((g) => g.x + g.w)) + margin;
  const y1 = Math.max(...nodes.map((n) => n.labelBox.y + n.labelBox.h), ...groups.map((g) => g.y + g.h)) + margin;
  const W = Math.ceil((x1 - x0) / GRID) + 1, H = Math.ceil((y1 - y0) / GRID) + 1;
  const cx = (i) => x0 + i * GRID, cy = (j) => y0 + j * GRID;
  const ci = (x) => Math.round((x - x0) / GRID), cj = (y) => Math.round((y - y0) / GRID);

  // blocked cells: icon + label of every node (slightly inflated); border cells get a small penalty
  const blocked = new Uint8Array(W * H);
  const border = new Uint8Array(W * H);
  const block = (bx0, by0, bx1, by1) => {
    for (let j = cj(by0); j <= cj(by1); j++) for (let i = ci(bx0); i <= ci(bx1); i++) if (i >= 0 && j >= 0 && i < W && j < H) blocked[j * W + i] = 1;
  };
  for (const n of nodes) {
    block(n.x - 4, n.y - 4, n.x + n.w + 4, n.y + n.h + 4); // the icon
    block(n.labelBox.x - 2, n.labelBox.y - 2, n.labelBox.x + n.labelBox.w + 2, n.labelBox.y + n.labelBox.h + 2); // its label
  }
  for (const g of groups) {
    const gi0 = ci(g.x), gi1 = ci(g.x + g.w), gj0 = cj(g.y), gj1 = cj(g.y + g.h);
    for (let i = gi0; i <= gi1; i++) for (const j of [gj0, gj1]) if (i >= 0 && j >= 0 && i < W && j < H) border[j * W + i] = 1;
    for (let j = gj0; j <= gj1; j++) for (const i of [gi0, gi1]) if (i >= 0 && j >= 0 && i < W && j < H) border[j * W + i] = 1;
  }
  const used = new Uint8Array(W * H * 2); // bit per axis: horizontal = 1, vertical = 2 (stored per cell)

  const byId = new Map(nodes.map((n) => [n.id, n]));
  return spec.edges.map((e) => {
    const a = byId.get(e.from), b = byId.get(e.to);
    // flow normally leaves an icon's east side and enters the next one's west side; vertical neighbours connect
    // bottom (below the label) to top instead, so the arrow does not hook around
    const vertical = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < ICON && Math.abs(a.y - b.y) > ICON + 24;
    let p0, p1, sd, td, sI, sJ, tI, tJ;
    if (!vertical) {
      p0 = [a.x + a.w, a.y + a.h / 2]; p1 = [b.x, b.y + b.h / 2]; sd = 0; td = 0;
      [sI, sJ, tI, tJ] = [ci(p0[0]) + 1, cj(p0[1]), ci(p1[0]) - 1, cj(p1[1])];
    } else if (b.y > a.y) {
      p0 = [a.x + a.w / 2, a.labelBox.y + a.labelBox.h + 2]; p1 = [b.x + b.w / 2, b.y]; sd = 1; td = 1;
      [sI, sJ, tI, tJ] = [ci(p0[0]), cj(p0[1]) + 1, ci(p1[0]), cj(p1[1]) - 1];
    } else {
      p0 = [a.x + a.w / 2, a.y]; p1 = [b.x + b.w / 2, b.labelBox.y + b.labelBox.h + 2]; sd = 3; td = 3;
      [sI, sJ, tI, tJ] = [ci(p0[0]), cj(p0[1]) - 1, ci(p1[0]), cj(p1[1]) + 1];
    }
    const path = astar(sI, sJ, sd, tI, tJ, td);
    let points;
    if (path) {
      points = [p0, ...path.map(([i, j]) => [cx(i), cy(j)]), p1];
    } else {
      // fallback: plain three-segment connector
      if (!vertical) {
        const mx = snap((p0[0] + p1[0]) / 2);
        points = [p0, [mx, p0[1]], [mx, p1[1]], p1];
      } else {
        const my = snap((p0[1] + p1[1]) / 2);
        points = [p0, [p0[0], my], [p1[0], my], p1];
      }
    }
    points = simplify(points);
    mark(points);
    return { ...e, points };
  });

  function astar(sI, sJ, sd, tI, tJ, td) {
    if (sI < 0 || tI < 0 || sJ < 0 || tJ < 0 || sI >= W || tI >= W || sJ >= H || tJ >= H) return null;
    const N = W * H * 4;
    const g = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const idx = (i, j, d) => (j * W + i) * 4 + d;
    const heap = new Heap();
    const start = idx(sI, sJ, sd);
    g[start] = 0;
    heap.push(Math.abs(tI - sI) + Math.abs(tJ - sJ), start);
    const wasBlocked = [blocked[sJ * W + sI], blocked[tJ * W + tI]];
    blocked[sJ * W + sI] = 0; // the cells right outside the two ports are always open
    blocked[tJ * W + tI] = 0;
    let found = -1, steps = 0;
    while (heap.size && steps++ < 400_000) {
      const s = heap.pop();
      const d = s % 4, cell = (s - d) / 4, i = cell % W, j = (cell - i) / W;
      if (i === tI && j === tJ && d === td) { found = s; break; }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue;
        const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H || blocked[nj * W + ni]) continue;
        const c = nj * W + ni, axis = nd % 2 === 0 ? 1 : 2;
        let cost = 1 + (nd !== d ? BEND : 0) + (border[c] ? BORDER : 0);
        const u = used[c];
        if (u & axis) cost += OVERLAP;
        else if (u) cost += CROSS;
        const ns = idx(ni, nj, nd), ng = g[s] + cost;
        if (ng < g[ns]) {
          g[ns] = ng;
          prev[ns] = s;
          heap.push(ng + Math.abs(tI - ni) + Math.abs(tJ - nj), ns);
        }
      }
    }
    blocked[sJ * W + sI] = wasBlocked[0];
    blocked[tJ * W + tI] = wasBlocked[1];
    if (found < 0) return null;
    const out = [];
    for (let s = found; s >= 0; s = prev[s]) {
      const d = s % 4, cell = (s - d) / 4;
      out.push([cell % W, Math.floor(cell / W)]);
    }
    return out.reverse();
  }

  function mark(points) {
    for (let k = 0; k + 1 < points.length; k++) {
      const [ax, ay] = points[k], [bx, by] = points[k + 1];
      const horiz = ay === by, axis = horiz ? 1 : 2;
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / GRID;
      for (let t = 0; t <= n; t++) {
        const i = ci(ax + ((bx - ax) * t) / (n || 1)), j = cj(ay + ((by - ay) * t) / (n || 1));
        if (i >= 0 && j >= 0 && i < W && j < H) used[j * W + i] |= axis;
      }
    }
  }
}

// drop collinear and duplicate points
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(-2, 1);
      else break;
    }
  }
  return out;
}
