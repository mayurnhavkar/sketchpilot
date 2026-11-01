import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON, GROUP_STYLE, layoutAws, nodeTiers, simplify, wrapLabel } from "../src/lib/aws/layout.js";

const node = (id, service = "ec2", parent, label = id) => ({ id, service, label, parent, file: null });
const group = (id, kind, parent) => ({ id, kind, label: id, parent });

// the classic three-tier, two-AZ layout
const spec = () => ({
  groups: [
    group("cloud", "aws-cloud"), group("region", "region", "cloud"), group("vpc", "vpc", "region"),
    group("az-a", "az", "vpc"), group("az-b", "az", "vpc"),
    group("pub-a", "public-subnet", "az-a"), group("app-a", "private-subnet", "az-a"), group("db-a", "private-subnet", "az-a"),
    group("pub-b", "public-subnet", "az-b"), group("app-b", "private-subnet", "az-b"), group("db-b", "private-subnet", "az-b"),
  ],
  nodes: [
    node("user", "user"), node("cdn", "cloudfront", "cloud"), node("s3", "s3", "region"),
    node("alb-a", "alb", "pub-a"), node("alb-b", "alb", "pub-b"), node("ec2-a", "ec2", "app-a"), node("ec2-b", "ec2", "app-b"),
    node("rds-p", "rds", "db-a"), node("rds-s", "rds", "db-b"),
  ],
  edges: [
    { from: "user", to: "cdn", step: 1 }, { from: "cdn", to: "s3" }, { from: "cdn", to: "alb-a" }, { from: "cdn", to: "alb-b" },
    { from: "alb-a", to: "ec2-a" }, { from: "alb-b", to: "ec2-b" }, { from: "ec2-a", to: "rds-p" }, { from: "ec2-b", to: "rds-p" },
    { from: "rds-p", to: "rds-s" },
  ],
});

const inside = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("nodeTiers: longest path from a source, cycles ignored", () => {
  const t = nodeTiers(spec());
  assert.deepEqual([t.get("user"), t.get("cdn"), t.get("alb-a"), t.get("ec2-a"), t.get("rds-p")], [0, 1, 2, 3, 4]);
  const cyc = nodeTiers({ nodes: [node("a"), node("b")], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] });
  assert.deepEqual([cyc.get("a"), cyc.get("b")], [0, 1]);
});

test("wrapLabel keeps labels to three short lines", () => {
  assert.deepEqual(wrapLabel("Orders handler"), ["Orders handler"]);
  assert.deepEqual(wrapLabel("Primary orders database cluster"), ["Primary orders", "database cluster"]);
  assert.equal(wrapLabel("a b c d e f g h i j k l m n o p q r s t u v w x y z").length, 3);
  assert.deepEqual(wrapLabel(""), [""]);
});

test("every node sits inside its parent group, and every group inside its parent", () => {
  const s = spec();
  const l = layoutAws(s);
  const g = Object.fromEntries(l.groups.map((x) => [x.id, x]));
  for (const n of l.nodes) if (n.parent) assert.ok(inside(n, g[n.parent]), `${n.id} in ${n.parent}`);
  for (const x of l.groups) if (x.parent) assert.ok(inside(x, g[x.parent]), `${x.id} in ${x.parent}`);
  assert.equal(l.nodes.length, s.nodes.length);
  assert.equal(l.groups.length, s.groups.length);
});

test("nothing overlaps: sibling groups are disjoint and icons (with labels) never collide", () => {
  const l = layoutAws(spec());
  for (let i = 0; i < l.nodes.length; i++) {
    for (let j = i + 1; j < l.nodes.length; j++) {
      const a = l.nodes[i], b = l.nodes[j];
      const box = (n) => ({ x: Math.min(n.x, n.labelBox.x), y: n.y, w: Math.max(n.w, n.labelBox.w), h: n.labelBox.y + n.labelBox.h - n.y });
      assert.ok(!overlap(box(a), box(b)), `${a.id} / ${b.id}`);
    }
  }
  const sibs = l.groups.filter((g) => g.parent === "vpc");
  assert.ok(!overlap(sibs[0], sibs[1]));
});

test("the two zones are mirror images: same tiers share the same x, same size", () => {
  const l = layoutAws(spec());
  const n = Object.fromEntries(l.nodes.map((x) => [x.id, x]));
  assert.equal(n["alb-a"].x, n["alb-b"].x);
  assert.equal(n["ec2-a"].x, n["ec2-b"].x);
  const g = Object.fromEntries(l.groups.map((x) => [x.id, x]));
  assert.equal(g["az-a"].w, g["az-b"].w);
  assert.equal(g["az-a"].h, g["az-b"].h);
  assert.ok(g["az-b"].y > g["az-a"].y, "zones stack");
  // tiers read left to right
  assert.ok(n.user.x < n.cdn.x && n.cdn.x < n["alb-a"].x && n["alb-a"].x < n["ec2-a"].x && n["ec2-a"].x < n["rds-p"].x);
});

test("icons are on the 8px grid, so port points line up with routing cells", () => {
  for (const n of layoutAws(spec()).nodes) assert.deepEqual([n.x % 8, n.y % 8], [0, 0], n.id);
});

test("direct neighbours are joined by one straight line", () => {
  const l = layoutAws(spec());
  const e = l.edges.find((x) => x.from === "alb-a" && x.to === "ec2-a");
  assert.equal(e.points.length, 2);
  assert.equal(e.points[0][1], e.points[1][1]);
  const e2 = l.edges.find((x) => x.from === "user" && x.to === "cdn");
  assert.equal(e2.points.length, 2, "root-level node lines up with the framed content");
});

test("every route is orthogonal, starts at the source icon's east edge and ends at the target's west edge", () => {
  const l = layoutAws(spec());
  const n = Object.fromEntries(l.nodes.map((x) => [x.id, x]));
  for (const e of l.edges) {
    for (let i = 0; i + 1 < e.points.length; i++) {
      const [a, b] = [e.points[i], e.points[i + 1]];
      assert.ok(a[0] === b[0] || a[1] === b[1], `${e.from}>${e.to} segment ${i} is diagonal`);
    }
    if (e.from === "rds-p" && e.to === "rds-s") continue; // vertical neighbours use bottom/top ports
    assert.deepEqual(e.points[0], [n[e.from].x + ICON, n[e.from].y + ICON / 2]);
    assert.deepEqual(e.points.at(-1), [n[e.to].x, n[e.to].y + ICON / 2]);
  }
});

test("vertical neighbours connect bottom to top instead of hooking around", () => {
  const l = layoutAws(spec());
  const n = Object.fromEntries(l.nodes.map((x) => [x.id, x]));
  const e = l.edges.find((x) => x.from === "rds-p" && x.to === "rds-s");
  assert.equal(e.points.length, 2);
  assert.equal(e.points[0][0], e.points[1][0]);
  assert.ok(e.points[0][1] >= n["rds-p"].labelBox.y + n["rds-p"].labelBox.h, "leaves below the label");
  assert.equal(e.points[1][1], n["rds-s"].y);
});

test("routes never cut through an icon that is not their own endpoint", () => {
  const l = layoutAws(spec());
  for (const e of l.edges) {
    for (let i = 0; i + 1 < e.points.length; i++) {
      const [a, b] = [e.points[i], e.points[i + 1]];
      const seg = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) || 0.1, h: Math.abs(a[1] - b[1]) || 0.1 };
      for (const n of l.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        assert.ok(!overlap(seg, { x: n.x, y: n.y, w: n.w, h: n.h }), `${e.from}>${e.to} crosses icon ${n.id}`);
      }
    }
  }
});

test("a back edge (target left of source) is routed around, not through", () => {
  const s = { groups: [], nodes: [node("a"), node("b"), node("c")], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }] };
  const l = layoutAws(s);
  const back = l.edges.find((e) => e.from === "c" && e.to === "a");
  assert.ok(back.points.length >= 4);
  for (let i = 0; i + 1 < back.points.length; i++) assert.ok(back.points[i][0] === back.points[i + 1][0] || back.points[i][1] === back.points[i + 1][1]);
});

test("same-tier siblings stack; empty groups get a default size; a diagram with no groups works", () => {
  const l = layoutAws({ groups: [group("g", "generic")], nodes: [node("a"), node("b"), node("c", "ec2", "g")], edges: [] });
  assert.ok(l.groups[0].w >= 220 || l.groups[0].h >= 120);
  const flat = layoutAws({ groups: [], nodes: [node("a"), node("b")], edges: [{ from: "a", to: "b" }] });
  assert.equal(flat.nodes.length, 2);
  assert.ok(flat.width > 0 && flat.height > 0);
});

test("layout is deterministic and fast", () => {
  const t = performance.now();
  const a = JSON.stringify(layoutAws(spec()));
  const dt = performance.now() - t;
  assert.equal(a, JSON.stringify(layoutAws(spec())));
  assert.ok(dt < 1500, `took ${dt}ms`);
});

test("a large diagram (60 services) stays fast and every edge gets a route", () => {
  const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`, "ec2", i % 3 === 0 ? "g1" : i % 3 === 1 ? "g2" : undefined));
  const edges = nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id }));
  const t = performance.now();
  const l = layoutAws({ groups: [group("g1", "vpc"), group("g2", "vpc")], nodes, edges });
  assert.ok(performance.now() - t < 8000);
  assert.ok(l.edges.every((e) => e.points.length >= 2));
});

test("simplify drops duplicate and collinear points", () => {
  assert.deepEqual(simplify([[0, 0], [0, 0], [5, 0], [10, 0], [10, 5]]), [[0, 0], [10, 0], [10, 5]]);
});

test("every group kind the model may use has an official style", () => {
  for (const k of ["aws-cloud", "account", "region", "vpc", "az", "public-subnet", "private-subnet", "security-group", "auto-scaling-group", "corporate-data-center", "server-contents", "ec2-instance-contents", "generic"]) {
    assert.ok(GROUP_STYLE[k]?.color, k);
  }
  // colours taken from AWS's own group icons
  assert.equal(GROUP_STYLE.vpc.color, "#8C4FFF");
  assert.equal(GROUP_STYLE["public-subnet"].color, "#7AA116");
  assert.equal(GROUP_STYLE["aws-cloud"].color, "#242F3E");
});
