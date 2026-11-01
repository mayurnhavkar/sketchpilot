import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutAws, GROUP_STYLE } from "../src/lib/aws/layout.js";
import { bindArrows, iconFileId, newDiagramPrefix, recenterLabels, renderAws, svgToDataUrl } from "../src/lib/aws/render.js";
import { findAwsDiagram, listAwsDiagrams, neededIcons, prefixOf, tagSpec, AWS_HINT, EDIT_VERB } from "../src/lib/aws/diagram.js";
import { describeScene } from "../src/lib/scene.js";

const spec = () => ({
  title: "Demo",
  groups: [{ id: "cloud", kind: "aws-cloud", label: "AWS Cloud" }, { id: "vpc", kind: "vpc", label: "VPC", parent: "cloud" }],
  nodes: [
    { id: "user", service: "user", label: "Users", file: "resources/user.svg" },
    { id: "fn", service: "lambda", label: "Handler", parent: "vpc", file: "services/lambda.svg" },
    { id: "box", service: "generic", label: "Mystery", parent: "vpc", file: null },
  ],
  edges: [{ from: "user", to: "fn", label: "HTTPS", step: 1 }, { from: "fn", to: "box", bidirectional: true }],
});
const icons = () => new Map([["resources/user.svg", "<svg>u</svg>"], ["services/lambda.svg", "<svg>l</svg>"], ["groups/aws-cloud.svg", "<svg>c</svg>"], ["groups/vpc.svg", "<svg>v</svg>"]]);
const build = () => {
  const s = spec();
  const layout = layoutAws(s);
  return { s, layout, r: renderAws(layout, { spec: s, prefix: "awsabc_", origin: { x: 100, y: 200 }, icons: icons() }) };
};

test("renderAws: every id carries the diagram prefix; one image per icon, one arrow per edge", () => {
  const { r } = build();
  for (const e of r.skeleton) assert.ok(e.id.startsWith("awsabc_"), e.id);
  assert.equal(new Set(r.skeleton.map((e) => e.id)).size, r.skeleton.length, "ids unique");
  assert.equal(r.skeleton.filter((e) => e.type === "arrow").length, 2);
  assert.equal(r.skeleton.filter((e) => e.type === "image").length, 4); // user, lambda, cloud + vpc corner icons
  assert.equal(r.skeleton.find((e) => e.id === "awsabc_n-box").type, "rectangle"); // generic fallback box
});

test("renderAws: official group colours, dashed region/AZ style, square corners, flat (roughness 0) look", () => {
  const { r } = build();
  const vpc = r.skeleton.find((e) => e.id === "awsabc_g-vpc");
  assert.equal(vpc.strokeColor, GROUP_STYLE.vpc.color);
  assert.equal(vpc.roughness, 0);
  assert.equal(vpc.roundness, null);
  assert.equal(r.skeleton.find((e) => e.id === "awsabc_g-cloud").strokeColor, "#242F3E");
});

test("renderAws: content starts at the requested origin (below the title)", () => {
  const { r, layout } = build();
  assert.equal(r.bbox.x, 100);
  const title = r.skeleton.find((e) => e.id === "awsabc_title");
  assert.equal(title.y, 200);
  const minY = Math.min(...r.skeleton.filter((e) => e.id.includes("_g-")).map((e) => e.y));
  assert.equal(minY, 200 + 44);
  assert.ok(layout.nodes.length === 3);
});

test("renderAws: arrows carry no bindings in the skeleton (the converter cannot bind images); links are returned instead", () => {
  const { r } = build();
  for (const a of r.skeleton.filter((e) => e.type === "arrow")) {
    assert.equal(a.start, undefined);
    assert.equal(a.end, undefined);
    assert.equal(a.endArrowhead, "triangle");
    assert.ok(a.points[0][0] === 0 && a.points[0][1] === 0);
  }
  assert.equal(r.links.length, 2);
  assert.deepEqual(r.links[0], { arrow: "awsabc_e-0", from: "awsabc_n-user", to: "awsabc_n-fn" });
  assert.equal(r.skeleton.find((e) => e.id === "awsabc_e-1").startArrowhead, "triangle"); // bidirectional
});

test("renderAws: numbered edges get a step badge; labels become arrow labels", () => {
  const { r } = build();
  const badge = r.skeleton.find((e) => e.id === "awsabc_s-0");
  assert.equal(badge.type, "ellipse");
  assert.equal(badge.label.text, "1");
  assert.ok(!r.skeleton.some((e) => e.id === "awsabc_s-1"));
  assert.equal(r.skeleton.find((e) => e.id === "awsabc_e-0").label.text, "HTTPS");
});

test("renderAws: each icon file is embedded once, as an SVG data URL", () => {
  const { r } = build();
  assert.deepEqual(Object.keys(r.files).sort(), ["aws-groups-aws-cloud", "aws-groups-vpc", "aws-resources-user", "aws-services-lambda"]);
  assert.ok(r.files["aws-services-lambda"].dataURL.startsWith("data:image/svg+xml;base64,"));
  assert.equal(Buffer.from(r.files["aws-services-lambda"].dataURL.split(",")[1], "base64").toString(), "<svg>l</svg>");
  assert.equal(iconFileId("services/ec2.svg"), "aws-services-ec2");
  assert.ok(svgToDataUrl("<svg>é</svg>").startsWith("data:image/svg+xml;base64,"));
});

test("an icon that failed to load degrades to the generic box instead of breaking the diagram", () => {
  const s = spec();
  const r = renderAws(layoutAws(s), { spec: s, prefix: "awsx_", origin: { x: 0, y: 0 }, icons: new Map() });
  assert.equal(r.skeleton.filter((e) => e.type === "image").length, 0);
  assert.equal(r.skeleton.find((e) => e.id === "awsx_n-fn").type, "rectangle");
});

test("recenterLabels centres measured text under its icon; bindArrows wires arrows to icons", () => {
  const { r } = build();
  const made = r.skeleton.map((e) => ({ ...e, width: e.width ?? 40, boundElements: [], version: 1 }));
  const c = r.centers[0];
  const out = recenterLabels(made, r.centers);
  const t = out.find((e) => e.id === c.id);
  assert.equal(t.x, c.cx - t.width / 2);

  const bound = bindArrows(made, r.links);
  const arrow = bound.find((e) => e.id === "awsabc_e-0");
  assert.equal(arrow.startBinding.elementId, "awsabc_n-user");
  assert.equal(arrow.endBinding.elementId, "awsabc_n-fn");
  assert.ok(bound.find((e) => e.id === "awsabc_n-fn").boundElements.some((b) => b.id === "awsabc_e-0"));
  assert.ok(bound.find((e) => e.id === "awsabc_n-fn").boundElements.some((b) => b.id === "awsabc_e-1"), "both arrows attach to fn");
});

test("diagram prefixes are sortable by time and recognised from any element id", () => {
  assert.ok(newDiagramPrefix(1000) < newDiagramPrefix(2000));
  assert.equal(prefixOf("awsk3f_n-fn"), "awsk3f_");
  assert.equal(prefixOf("n1ab_m4"), null);
  assert.equal(prefixOf(undefined), null);
});

const canvas = () => {
  const { s, r } = build();
  const made = r.skeleton.map((e) => ({ ...e, isDeleted: false, width: e.width ?? 10, height: e.height ?? 10 }));
  return { s, els: tagSpec(made, "awsabc_", s), made };
};

test("tagSpec stores the spec once; listAwsDiagrams / findAwsDiagram find it again by id prefix", () => {
  const { s, els } = canvas();
  assert.equal(els.filter((e) => e.customData?.awsSpec).length, 1);
  const [d] = listAwsDiagrams(els);
  assert.equal(d.prefix, "awsabc_");
  assert.deepEqual(d.spec.nodes.map((n) => n.id), s.nodes.map((n) => n.id));
  assert.equal(d.origin.x, Math.min(...els.map((e) => e.x)));
  assert.equal(findAwsDiagram(els, new Set(["awsabc_n-fn"])).selected, true);
  assert.equal(findAwsDiagram(els, new Set(["unrelated"]), "awsabc_").selected, false);
  assert.equal(findAwsDiagram(els, new Set()).diagram.prefix, "awsabc_");
  assert.equal(findAwsDiagram([], new Set()).diagram, null);
  assert.equal(listAwsDiagrams(els.map((e) => ({ ...e, isDeleted: true }))).length, 0);
});

test("with several diagrams, the selected one wins, then the last-used, then the newest", () => {
  const one = canvas().els;
  const two = one.map((e) => ({ ...e, id: e.id.replace("awsabc_", "awsxyz_"), customData: { ...e.customData, artifact: "awsxyz_" } }));
  const els = [...one, ...two];
  assert.equal(findAwsDiagram(els, new Set(["awsabc_n-fn"])).diagram.prefix, "awsabc_");
  assert.equal(findAwsDiagram(els, new Set(), "awsabc_").diagram.prefix, "awsabc_");
  assert.equal(findAwsDiagram(els, new Set()).diagram.prefix, "awsxyz_"); // newest = highest prefix
});

test("describeScene collapses an AWS diagram into one summary line (no dozens of image/text rows)", () => {
  const { els } = canvas();
  const { text, knownIds } = describeScene(els, new Set());
  assert.match(text, /aws-diagram "Demo": 3 services \(Users, Handler, Mystery\)/);
  assert.equal(text.split("\n").length, 1);
  assert.equal(knownIds.length, 0);
});

test("neededIcons lists node icons plus the corner icon of each group kind", () => {
  const files = neededIcons(spec(), (k) => GROUP_STYLE[k]?.icon);
  assert.deepEqual(files.sort(), ["groups/aws-cloud.svg", "groups/vpc.svg", "resources/user.svg", "services/lambda.svg"]);
});

test("auto-detection: AWS words trigger AWS mode, edit verbs trigger iteration", () => {
  for (const t of ["three-tier app on AWS", "an ALB with EC2 behind it", "S3 + CloudFront static site", "lambda and dynamodb", "VPC with NAT gateway"]) assert.ok(AWS_HINT.test(t), t);
  for (const t of ["order flow: user, web app, order service", "login sequence", "draw a flowchart"]) assert.ok(!AWS_HINT.test(t), t);
  for (const t of ["add a cache", "Remove the NAT gateway", "now put WAF in front", "replace RDS with Aurora"]) assert.ok(EDIT_VERB.test(t), t);
  assert.ok(!EDIT_VERB.test("a serverless API on AWS"));
});

// Obsidian's Excalidraw plugin rewrites every text element's id to its own 8-character form when it saves.
const pluginRewritesTextIds = (els) => {
  let n = 0;
  const map = new Map(els.filter((e) => e.type === "text").map((e) => [e.id, `Xy${String(n++).padStart(6, "0")}`]));
  return els.map((e) => ({ ...e, id: map.get(e.id) || e.id, containerId: e.containerId ? map.get(e.containerId) || e.containerId : e.containerId }));
};

test("an AWS diagram is still recognised after a plugin rewrites every text id", () => {
  const { els } = canvas();
  const rewritten = pluginRewritesTextIds(els);
  assert.ok(rewritten.some((e) => e.type === "text" && !e.id.startsWith("awsabc_")), "text ids really changed");
  const [d] = listAwsDiagrams(rewritten);
  assert.equal(d.prefix, "awsabc_");
  assert.equal(d.ids.length, els.length, "every element still belongs to the diagram");
  const textId = rewritten.find((e) => e.type === "text").id;
  assert.equal(findAwsDiagram(rewritten, new Set([textId])).selected, true, "selecting a label selects the diagram");
  assert.match(describeScene(rewritten, new Set()).text, /^ {2}aws-diagram "Demo"/);
});

test("the spec is kept on a non-text element, so a rewritten text id cannot lose it", () => {
  const { els } = canvas();
  assert.notEqual(els.find((e) => e.customData?.awsSpec).type, "text");
});

test("a bound label (random id) belongs to the diagram of its container", () => {
  const { els } = canvas();
  const container = els.find((e) => e.type === "rectangle");
  const label = { id: "labelXYZ", type: "text", containerId: container.id, x: 0, y: 0, width: 5, height: 5, isDeleted: false };
  assert.equal(describeScene([...els, label], new Set()).text.split("\n").length, 1, "the label is hidden inside the diagram summary");
});
