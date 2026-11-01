import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import MarkdownIt from "markdown-it";
import YAML from "yaml";
import {
  awsToMarkdown, cell, fenceFor, frontmatter, guardLinks, notesText, notesToMarkdown, portableAwsSpec, relatedTitles, sceneToMarkdown, tagify, yamlStr,
} from "../src/lib/export/markdown.js";
import { buildScene, isShortId, parseExcalidrawMd, shortenTextIds, toExcalidrawMd } from "../src/lib/export/obsidian.js";
import { coerceAwsSpec, createExporter, svgIsSafeToWrite } from "../server/export.js";
import { pickExportTarget } from "../src/lib/export/target.js";
import { migrateArtifacts } from "../src/lib/scene.js";
import { renderNotes } from "../src/lib/notes/render.js";
import { tagNotes } from "../src/lib/notes/note.js";
import { layoutAws } from "../src/lib/aws/layout.js";
import { renderAws } from "../src/lib/aws/render.js";
import { tagSpec } from "../src/lib/aws/diagram.js";

const md = new MarkdownIt();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ec-export-"));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

const spec = () => ({
  title: "Trading: post-mortem", subtitle: "Why the trade failed. See [[Stack]].",
  sections: [
    { type: "chain", title: "Picture", kind: "linked", nodes: ["10", "20"], pointers: [{ label: "head", at: 0 }], end: "None", caption: "head is first." },
    { type: "points", title: "Key ideas", bullets: ["Nested [[1, 2], [3]] list", "Cost is O(1)"] },
    { type: "code", title: "Code", language: "python", code: "x = 1\nprint(f'''{x}''')\n# ``` inside" },
    { type: "table", title: "Costs", columns: ["Op", "Cost"], rows: [["a|b", "O(1)"], ["insert", "O(n)"]] },
    { type: "callout", kind: "warning", title: "Gotchas", text: "Line one.\nLine two." },
    { type: "steps", title: "Steps", steps: ["First", "Second"] },
    { type: "qa", title: "Practice", items: [{ q: "Why?", a: "Because." }, { q: "How?", a: "Like this." }] },
  ],
});
const awsSpec = () => ({
  title: "Three tier",
  groups: [{ id: "cloud", kind: "aws-cloud", label: "AWS Cloud" }, { id: "vpc", kind: "vpc", label: "VPC", parent: "cloud" }],
  nodes: [
    { id: "user", service: "user", label: "Users", file: "resources/user.svg", color: "#fff" },
    { id: "alb", service: "application-load-balancer", label: "ALB", parent: "vpc", file: "x.svg" },
    { id: "box", service: "generic", label: "Legacy box", parent: "vpc", file: null },
  ],
  edges: [{ from: "alb", to: "box", label: "HTTP" }, { from: "user", to: "alb", label: "HTTPS", step: 1 }, { from: "box", to: "user", bidirectional: true }],
});

// ---------------- small helpers ----------------
test("guardLinks, cell, yamlStr, tagify, fenceFor", () => {
  assert.ok(!guardLinks("a [[b]] c").includes("[["));
  assert.equal(guardLinks("a [[b]] c").replace(/​/g, ""), "a [[b]] c");
  assert.equal(cell("a|b\nc"), "a\\|b c");
  assert.equal(YAML.parse(`t: ${yamlStr('He said "hi": # not a comment')}`).t, 'He said "hi": # not a comment');
  assert.equal(tagify("Data Structures"), "data-structures");
  assert.equal(tagify("2026"), "");
  assert.equal(tagify("日本語"), "日本語");
  assert.equal(tagify("a/b c"), "a/b-c");
  assert.equal(tagify("!!!"), "");
  assert.equal(fenceFor("plain"), "```");
  assert.equal(fenceFor("has ``` inside"), "````");
  assert.equal(fenceFor("has ```` inside"), "`````");
});

test("frontmatter is valid YAML, de-duplicates and cleans tags, quotes awkward titles", () => {
  const fm = frontmatter({ title: "Trading: post-mortem", tags: ["Notes", "notes", "Data Structures", "2026", ""], created: "2026-11-01", extra: { aliases: ["A", "B: c"] } });
  const y = YAML.parse(fm.replace(/^---\n|\n---\n$/g, ""));
  assert.equal(y.title, "Trading: post-mortem");
  assert.deepEqual(y.tags, ["notes", "data-structures"]);
  assert.equal(String(y.created).slice(0, 10), "2026-11-01");
  assert.deepEqual(y.aliases, ["A", "B: c"]);
  assert.equal(y.source, "excalidraw-claude");
});

test("relatedTitles: whole words, case-insensitive, no self, min length, no regex injection, capped", () => {
  const text = "A stack and a Queue; also C++ and linked lists. Stacks are not stack.";
  assert.deepEqual(relatedTitles(["Stack", "Queue", "Linked lists", "Tree", "C++", "Me", "Linked"], "Me", text).sort(), ["C++", "Linked", "Linked lists", "Queue", "Stack"].sort());
  assert.deepEqual(relatedTitles(["Stack"], "Stack", "stack"), []);
  assert.deepEqual(relatedTitles(["St"], "x", "st"), []);
  assert.deepEqual(relatedTitles(["SQL"], "x", "joins in sql"), ["SQL"]);
  assert.deepEqual(relatedTitles(["a.b*"], "x", "totally different"), []);
  assert.equal(relatedTitles(Array.from({ length: 30 }, (_, i) => `Note${i}`), "x", Array.from({ length: 30 }, (_, i) => `Note${i}`).join(" ")).length, 12);
});

// ---------------- notes -> Markdown ----------------
test("notesToMarkdown: valid frontmatter, one heading per section, language fences, escaped tables, callouts", () => {
  const out = notesToMarkdown(spec(), { imageName: "Trading post-mortem.svg", created: "2026-11-01" });
  const y = YAML.parse(out.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.equal(y.title, "Trading: post-mortem");
  assert.deepEqual(y.tags, ["notes", "python"]);
  const body = out.replace(/^---[\s\S]*?---\n/, "");
  const tokens = md.parse(body, {});
  assert.equal(tokens.filter((t) => t.type === "heading_open" && t.tag === "h2").length, 6); // all but the callout (its title is in the callout)
  const fences = tokens.filter((t) => t.type === "fence");
  assert.ok(fences.some((f) => f.info === "python" && f.content.includes("# ``` inside")), "code with backticks survives");
  const cells = []; tokens.forEach((t, i) => { if (t.type === "td_open") cells.push(tokens[i + 1].content); });
  assert.deepEqual(cells, ["a|b", "O(1)", "insert", "O(n)"]);
  assert.match(out, /!\[\[Trading post-mortem\.svg\]\]/);
  assert.match(out, /> \[!warning\] Gotchas\n> Line one\.\n> Line two\./);
  assert.equal((out.match(/> \[!question\]- /g) || []).length, 2);
  assert.match(out, /1\. First\n2\. Second/);
});

test("notesToMarkdown: nothing from the spec is lost, and [[ in prose cannot become a link", () => {
  const s = spec();
  const out = notesToMarkdown(s);
  const plain = out.replace(/​/g, "");
  for (const needle of ["Why the trade failed", "Cost is O(1)", "a\\|b", "O(n)", "Because.", "Like this.", "Save", "10", "head → node 1", "head is first."]) {
    if (needle === "Save") continue;
    assert.ok(plain.includes(needle), needle);
  }
  for (const line of out.split("\n").filter((l) => !l.startsWith("```") && !/^\s*(x = 1|print|#)/.test(l))) assert.ok(!line.includes("[["), line);
});

test("notesToMarkdown: every chain kind draws a text picture; Related links are added only when given", () => {
  const pic = (kind) => notesToMarkdown({ title: "T", sections: [{ type: "chain", kind, nodes: ["1", "2", "3"], pointers: [], end: "None" }] }, { withFrontmatter: false });
  assert.match(pic("linked"), /\[1 \| •\] → \[2 \| •\] → \[3 \| •\] → None/);
  assert.match(pic("doubly"), /\[• \| 1 \| •\] ⇄/);
  assert.match(pic("array"), /\[1\]\[2\]\[3\]\n/);
  assert.match(pic("boxes"), /1 → 2 → 3/);
  assert.ok(!notesToMarkdown(spec()).includes("## Related"));
  assert.match(notesToMarkdown(spec(), { related: ["Stack", "Queue"] }), /## Related\n\n- \[\[Stack\]\]\n- \[\[Queue\]\]/);
  assert.ok(!notesToMarkdown(spec(), { withFrontmatter: false }).startsWith("---"));
});

test("notesText gathers the searchable text used for link matching", () => {
  const t = notesText(spec());
  for (const x of ["post-mortem", "Cost is O(1)", "Because.", "insert", "x = 1"]) assert.ok(t.includes(x), x);
});

// ---------------- AWS -> Markdown ----------------
test("awsToMarkdown: nested components, ordered flow, other connections, and a portable spec block", () => {
  const out = awsToMarkdown(awsSpec(), { imageName: "Three tier.svg", created: "2026-11-01" });
  assert.deepEqual(YAML.parse(out.match(/^---\n([\s\S]*?)\n---/)[1]).tags, ["aws", "architecture", "diagram"]);
  assert.match(out, /- \*\*AWS Cloud\*\* \(aws cloud\)\n {2}- \*\*VPC\*\* \(vpc\)\n {4}- ALB: application load balancer\n {4}- Legacy box: no matching icon/);
  assert.match(out, /- Users: user/);
  assert.match(out, /## Flow\n\n- \*\*Step 1\*\*: Users → ALB \(HTTPS\)/);
  assert.match(out, /## Connections\n\n- ALB → Legacy box \(HTTP\)\n- Legacy box ↔ Users/);
  const json = JSON.parse(out.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.deepEqual(json, portableAwsSpec(awsSpec()));
  assert.ok(!JSON.stringify(json).includes("file") && !JSON.stringify(json).includes("color"));
  assert.match(out, /!\[\[Three tier\.svg\]\]/);
});

test("sceneToMarkdown lists unique texts (capped) and guards links", () => {
  const out = sceneToMarkdown({ title: "Sketch", texts: ["A", "A", " B  ", "[[x]]", ...Array.from({ length: 100 }, (_, i) => `t${i}`)] });
  assert.equal((out.match(/^- /gm) || []).length, 60);
  assert.ok(!out.includes("[[x]]"));
  assert.deepEqual(YAML.parse(out.match(/^---\n([\s\S]*?)\n---/)[1]).tags, ["diagram"]);
  assert.ok(!sceneToMarkdown({ title: "Empty", texts: [] }).includes("Text in this drawing"));
});

// ---------------- the Excalidraw plugin's file format ----------------
const scene = () => ({ type: "excalidraw", version: 2, elements: [{ id: "a", type: "text", text: "hi", isDeleted: false }, { id: "b", type: "image", fileId: "f1", isDeleted: false }, { id: "c", type: "rectangle", isDeleted: true }], files: { f1: { id: "f1" }, f2: { id: "f2" } } });

test("buildScene drops deleted elements and files no image uses", () => {
  const s = buildScene(scene().elements, scene().files, "#fafafa");
  assert.equal(s.elements.length, 2);
  assert.equal(s.elements[1].id, "b");
  assert.ok(isShortId(s.elements[0].id), "text ids become 8 characters");
  assert.deepEqual(Object.keys(s.files), ["f1"]);
  assert.equal(s.appState.viewBackgroundColor, "#fafafa");
});

test("toExcalidrawMd matches the plugin's own parsing rules and round-trips losslessly", () => {
  const notes = notesToMarkdown(spec(), { created: "2026-11-01" });
  const s = buildScene(scene().elements, scene().files);
  const file = toExcalidrawMd(notes, s);
  // regexes copied from the plugin's src/shared/excalidrawMarkdownParsing.ts
  assert.ok(/^(%%\n+)?# Excalidraw Data(?:\n|$)/m.test(file));
  assert.ok(/^(%%\n+)?##? Text Elements(?:\n|$)/m.test(file));
  assert.ok(/^(%%\n+)?##? Drawing\n/m.test(file));
  assert.ok(/(\n##? Drawing\n[^`]*(?:```compressed-json\n))([\s\S]*?)(```\n)/m.test(file));
  assert.equal((file.match(/excalidraw-plugin: parsed/g) || []).length, 1);
  const y = YAML.parse(file.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.equal(y["excalidraw-plugin"], "parsed");
  assert.equal(y.title, "Trading: post-mortem");
  const back = parseExcalidrawMd(file);
  assert.deepEqual(back.scene, s);
  assert.ok(back.markdown.includes("## Key ideas") && !back.markdown.includes("Excalidraw Data"));
  const block = file.match(/```compressed-json\n([\s\S]*?)```/)[1];
  assert.ok(block.split("\n").every((l) => l.length <= 256));
});

test("toExcalidrawMd handles missing/duplicate frontmatter; parseExcalidrawMd reads uncompressed and rejects junk", () => {
  const s = buildScene(scene().elements);
  assert.equal(YAML.parse(toExcalidrawMd("# Plain\n", s).match(/^---\n([\s\S]*?)\n---/)[1])["excalidraw-plugin"], "parsed");
  assert.equal((toExcalidrawMd("---\nexcalidraw-plugin: parsed\ntitle: x\n---\n# T\n", s).match(/excalidraw-plugin/g) || []).length, 1);
  const plain = `---\nexcalidraw-plugin: parsed\n---\n\n# Excalidraw Data\n\n## Text Elements\n\n%%\n## Drawing\n\`\`\`json\n${JSON.stringify(s)}\n\`\`\`\n%%\n`;
  assert.deepEqual(parseExcalidrawMd(plain).scene, s);
  assert.equal(parseExcalidrawMd("# just notes"), null);
  assert.equal(parseExcalidrawMd("\n## Drawing\n```compressed-json\n!!!notbase64\n```\n"), null);
});

// ---------------- the exporter ----------------
const fixed = (d) => ({ now: () => new Date(`${d}T12:00:00Z`) });
const req = (extra = {}) => ({ kind: "notes", spec: spec(), svg: SVG, formats: { markdown: true, svg: true }, ...extra });
const scn = () => ({ elements: scene().elements, files: scene().files, background: "#ffffff" });

test("exportItem writes image, note and editable drawing with safe names", () => {
  const dir = tmp();
  const r = createExporter(dir, fixed("2026-11-01")).exportItem(req({ formats: { markdown: true, svg: true, drawing: true }, scene: scn() }));
  assert.equal(r.name, "Trading post-mortem"); // the colon is not allowed in a file name
  assert.deepEqual(fs.readdirSync(dir).sort(), ["Trading post-mortem.excalidraw.md", "Trading post-mortem.md", "Trading post-mortem.svg"]);
  const note = fs.readFileSync(path.join(dir, "Trading post-mortem.md"), "utf8");
  assert.match(note, /created: 2026-11-01/);
  assert.match(note, /!\[\[Trading post-mortem\.svg\]\]/);
  const d = fs.readFileSync(path.join(dir, "Trading post-mortem.excalidraw.md"), "utf8");
  assert.ok(!d.includes("![["), "the drawing file does not embed its own image");
  assert.equal(parseExcalidrawMd(d).scene.elements.length, 2);
});

test("Markdown without an image has no embed; a scene export lists the drawing's text", () => {
  const dir = tmp();
  const ex = createExporter(dir);
  ex.exportItem(req({ formats: { markdown: true } }));
  assert.ok(!fs.readFileSync(path.join(dir, "Trading post-mortem.md"), "utf8").includes("![["));
  ex.exportItem({ kind: "scene", name: "My sketch", texts: ["Hello", "World"], svg: SVG, formats: { markdown: true, svg: true } });
  assert.match(fs.readFileSync(path.join(dir, "My sketch.md"), "utf8"), /- Hello\n- World/);
});

test("exportItem rejects bad requests, unsafe images and oversized drawings", () => {
  const ex = createExporter(tmp());
  assert.throws(() => ex.exportItem(req({ formats: {} })), /choose at least one format/);
  assert.throws(() => ex.exportItem(req({ kind: "pdf" })), /unknown export kind/);
  assert.throws(() => ex.exportItem(req({ spec: { sections: [] } })), /empty or malformed/);
  assert.throws(() => ex.exportItem(req({ kind: "aws", spec: { nodes: [] } })), /empty or malformed/);
  for (const bad of [null, "", "not svg", "<svg><script>alert(1)</script></svg>", '<svg onload="x()"/>', '<svg><image href="https://evil.example/x.png"/></svg>', '<svg><foreignObject/></svg>', "<svg>" + "x".repeat(26_000_000)]) {
    assert.throws(() => ex.exportItem(req({ svg: bad })), /unsafe/, String(bad).slice(0, 30));
  }
  assert.throws(() => ex.exportItem(req({ formats: { drawing: true }, scene: { elements: [] } })), /no elements/);
  assert.ok(svgIsSafeToWrite('<svg><image href="data:image/svg+xml;base64,AAA"/></svg>'), "embedded data: images are allowed");
  assert.ok(svgIsSafeToWrite('<?xml version="1.0"?>\n<svg xmlns="x"></svg>'));
});

test("file names cannot escape the folder", () => {
  const dir = tmp();
  const ex = createExporter(dir);
  ex.exportItem({ kind: "scene", name: "../../etc/passwd", texts: [], svg: SVG, formats: { svg: true } });
  assert.deepEqual(fs.readdirSync(dir), ["etc passwd.svg"]);
  ex.exportItem({ kind: "scene", name: "..", texts: [], svg: SVG, formats: { svg: true } });
  assert.ok(fs.existsSync(path.join(dir, "Untitled.svg")));
});

test("re-exporting: unchanged files are left alone, edits are backed up, the created date is kept", () => {
  const dir = tmp();
  const a = createExporter(dir, fixed("2026-11-01")).exportItem(req());
  assert.ok(a.files.every((f) => !f.backup && !f.unchanged));
  const again = createExporter(dir, fixed("2026-11-01")).exportItem(req());
  assert.ok(again.files.every((f) => f.unchanged), "identical content is not rewritten");
  assert.ok(!fs.existsSync(path.join(dir, ".export-history")));

  const file = path.join(dir, "Trading post-mortem.md");
  fs.appendFileSync(file, "\nMY OWN NOTES WRITTEN IN OBSIDIAN\n");
  const changed = spec();
  changed.sections[1].bullets.push("A new bullet");
  const r = createExporter(dir, fixed("2027-05-05")).exportItem(req({ spec: changed }));
  const md = r.files.find((f) => f.name.endsWith(".md"));
  assert.ok(md.backup, "the user's version was backed up");
  const saved = fs.readFileSync(path.join(dir, ".export-history", "Trading post-mortem", md.backup), "utf8");
  assert.ok(saved.includes("MY OWN NOTES WRITTEN IN OBSIDIAN"), "the backup holds the user's edit");
  const now = fs.readFileSync(file, "utf8");
  assert.ok(now.includes("A new bullet") && !now.includes("MY OWN NOTES"));
  assert.match(now, /created: 2026-11-01/, "created is preserved, not reset to the new date");
});

test("old backups are pruned to the last ten per file", async () => {
  const dir = tmp();
  const ex = createExporter(dir);
  for (let i = 0; i < 14; i++) {
    const s = spec();
    s.subtitle = `version ${i}`;
    ex.exportItem(req({ spec: s, formats: { markdown: true } }));
    await new Promise((r) => setTimeout(r, 3));
  }
  assert.equal(fs.readdirSync(path.join(dir, ".export-history", "Trading post-mortem")).length, 10);
});

test("related notes already in the folder become [[links]]; the note never links to itself", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "Stack.md"), "# Stack");
  fs.writeFileSync(path.join(dir, "Unrelated topic.md"), "# x");
  fs.writeFileSync(path.join(dir, "Queue.excalidraw.md"), "# Queue");
  fs.writeFileSync(path.join(dir, "picture.svg"), SVG);
  const ex = createExporter(dir);
  assert.deepEqual(ex.existingTitles(), ["Queue", "Stack", "Unrelated topic"]);
  const s = spec();
  s.sections[1].bullets.push("Compare with a queue");
  const r = ex.exportItem(req({ spec: s, formats: { markdown: true } }));
  assert.deepEqual(r.related.sort(), ["Queue", "Stack"]);
  const out = fs.readFileSync(path.join(dir, "Trading post-mortem.md"), "utf8");
  assert.match(out, /## Related\n\n- \[\[Queue\]\]\n- \[\[Stack\]\]/);
  assert.ok(!out.includes("[[Trading post-mortem]]"));
  assert.ok(!createExporter(dir).existingTitles().includes(".export-history"));
});

test("a missing folder is created; dot-folders are ignored when listing titles", () => {
  const dir = path.join(tmp(), "vault", "Notes");
  const ex = createExporter(dir);
  assert.deepEqual(ex.existingTitles(), []);
  ex.exportItem(req({ formats: { svg: true } }));
  assert.ok(fs.existsSync(path.join(dir, "Trading post-mortem.svg")));
});

test("AWS export: validated spec, Markdown with flow and spec block", () => {
  const dir = tmp();
  const r = createExporter(dir).exportItem({ kind: "aws", spec: awsSpec(), svg: SVG, formats: { markdown: true, svg: true } });
  assert.equal(r.name, "Three tier");
  const out = fs.readFileSync(path.join(dir, "Three tier.md"), "utf8");
  assert.match(out, /## Flow/);
  assert.match(out, /!\[\[Three tier\.svg\]\]/);
  const c = coerceAwsSpec({ title: "x".repeat(500), groups: [{ id: "g", kind: 5 }, null, { id: 7 }], nodes: Array.from({ length: 400 }, (_, i) => ({ id: `n${i}` })), edges: [{ from: "a", to: "b", step: 1.5 }, { from: 1 }] });
  assert.equal(c.title.length, 100);
  assert.equal(c.nodes.length, 150);
  assert.equal(c.groups.length, 1);
  assert.equal(c.groups[0].kind, "generic");
  assert.equal(c.edges[0].step, undefined);
  assert.equal(coerceAwsSpec({ nodes: [] }), null);
  assert.equal(coerceAwsSpec(null), null);
});

// ---------------- what to export ----------------
const noteEls = (prefix, s = spec()) => tagNotes(renderNotes(s, { prefix }).skeleton.map((e) => ({ ...e, isDeleted: false, width: e.width ?? 10, height: e.height ?? 10 })), prefix, s);
const awsEls = (prefix) => {
  const s = awsSpec();
  const r = renderAws(layoutAws(s), { spec: s, prefix, icons: new Map() });
  return tagSpec(r.skeleton.map((e) => ({ ...e, isDeleted: false, width: e.width ?? 10, height: e.height ?? 10 })), prefix, s);
};
const loose = [{ id: "z1", type: "text", text: "Unrelated text", x: 0, y: 0, width: 5, height: 5, isDeleted: false }, { id: "z2", type: "rectangle", x: 0, y: 0, width: 5, height: 5, isDeleted: false }];

test("pickExportTarget: selection wins, then the only artifact, then the newer one, then the whole scene", () => {
  const n = noteEls("nt000000001_"), a = awsEls("aws000000002_");
  const both = [...n, ...a, ...loose];
  const sel = (id) => new Set([id]);
  assert.equal(pickExportTarget(both, sel(n[3].id), "S").kind, "notes");
  assert.equal(pickExportTarget(both, sel(a[3].id), "S").kind, "aws");
  assert.equal(pickExportTarget([...n, ...loose], new Set(), "S").kind, "notes");
  assert.equal(pickExportTarget([...a, ...loose], new Set(), "S").kind, "aws");
  assert.equal(pickExportTarget(both, new Set(), "S").kind, "aws"); // the diagram was made later
  assert.equal(pickExportTarget([...noteEls("nt000000009_"), ...awsEls("aws000000002_")], new Set(), "S").kind, "notes");
  const scn2 = pickExportTarget(loose, new Set(), "My scene");
  assert.equal(scn2.kind, "scene");
  assert.deepEqual(scn2.texts, ["Unrelated text"]);
  assert.match(scn2.label, /Scene “My scene” · 2 elements/);
});

test("pickExportTarget: the image covers just the note or diagram, not unrelated elements; deleted ones are ignored", () => {
  const n = noteEls("nt000000001_");
  const t = pickExportTarget([...n, ...loose, { ...loose[0], id: "gone", isDeleted: true }], new Set(), "S");
  assert.equal(t.elements.length, n.length);
  assert.ok(!t.elements.some((e) => e.id.startsWith("z")));
  assert.match(t.label, /Notes “Trading: post-mortem” · 7 sections/);
  assert.equal(t.name, "Trading: post-mortem");
  assert.equal(pickExportTarget([...loose, { ...loose[0], isDeleted: true, id: "q" }], new Set(), "S").elements.length, 2);
  const aws = pickExportTarget(awsEls("aws000000002_"), new Set(), "S");
  assert.match(aws.label, /AWS diagram “Three tier” · 3 services/);
  assert.equal(pickExportTarget([], new Set(), "").name, "Untitled");
});

// ---------------- stable text ids (the plugin duplicates labels if long ids come back after it shortened them) ----------------
const labelled = () => [
  { id: "ntabc_k0", type: "rectangle", boundElements: [{ id: "ntabc_label-long-id", type: "text" }, { id: "arrow1", type: "arrow" }] },
  { id: "ntabc_label-long-id", type: "text", containerId: "ntabc_k0", text: "A" },
  { id: "ntabc_free-text", type: "text", containerId: null, text: "B" },
  { id: "arrow1", type: "arrow", boundElements: [{ id: "ntabc_arrow-label", type: "text" }] },
  { id: "ntabc_arrow-label", type: "text", containerId: "arrow1", text: "C" },
  { id: "AbCd1234", type: "text", text: "already short" },
];

test("shortenTextIds: text ids become 8 characters, every reference follows, non-text ids are untouched", () => {
  const out = shortenTextIds(labelled());
  const byText = Object.fromEntries(out.filter((e) => e.type === "text").map((e) => [e.text, e]));
  assert.ok(["A", "B", "C"].every((t) => isShortId(byText[t].id)));
  assert.equal(byText["already short"].id, "AbCd1234");
  const rect = out.find((e) => e.type === "rectangle");
  assert.equal(rect.id, "ntabc_k0");
  assert.equal(byText.A.containerId, rect.id);
  assert.deepEqual(rect.boundElements, [{ id: byText.A.id, type: "text" }, { id: "arrow1", type: "arrow" }]);
  assert.equal(byText.C.containerId, "arrow1");
  assert.equal(out.find((e) => e.type === "arrow").boundElements[0].id, byText.C.id);
  assert.equal(byText.B.containerId, null);
  assert.equal(new Set(out.map((e) => e.id)).size, out.length);
});

test("shortenTextIds is deterministic and idempotent, so a re-export carries the same ids", () => {
  const a = shortenTextIds(labelled()), b = shortenTextIds(labelled());
  assert.deepEqual(a, b);
  assert.deepEqual(shortenTextIds(a), a, "already-short ids are left alone");
  assert.equal(shortenTextIds([{ id: "x", type: "rectangle" }])[0].id, "x");
});

test("shortenTextIds avoids collisions with existing ids, including ones it generated", () => {
  const first = shortenTextIds([{ id: "same", type: "text", text: "x" }])[0].id;
  const out = shortenTextIds([{ id: first, type: "rectangle" }, { id: "same", type: "text", text: "x" }, { id: "same2", type: "text", text: "y" }]);
  assert.equal(new Set(out.map((e) => e.id)).size, 3);
  assert.equal(out[0].id, first);
  assert.notEqual(out[1].id, first);
  const many = shortenTextIds(Array.from({ length: 2000 }, (_, i) => ({ id: `ntabc_text-${i}`, type: "text", text: String(i) })));
  assert.equal(new Set(many.map((e) => e.id)).size, 2000);
  assert.ok(many.every((e) => isShortId(e.id)));
});

test("exporting the same scene twice gives identical drawing files", () => {
  const dir = tmp();
  const ex = createExporter(dir, fixed("2026-11-01"));
  const els = labelled().map((e) => ({ ...e, isDeleted: false }));
  const r1 = ex.exportItem({ kind: "scene", name: "Same", texts: [], formats: { drawing: true }, scene: { elements: els, files: {} } });
  const r2 = ex.exportItem({ kind: "scene", name: "Same", texts: [], formats: { drawing: true }, scene: { elements: els, files: {} } });
  assert.ok(r1.files[0].bytes > 0);
  assert.ok(r2.files[0].unchanged, "same ids, same content: nothing is rewritten");
});

test("awsToMarkdown tells apart services that share a label by their group", () => {
  const spec2 = {
    title: "HA",
    groups: [{ id: "a", kind: "public-subnet", label: "Subnet A" }, { id: "b", kind: "public-subnet", label: "Subnet B" }],
    nodes: [{ id: "alb-a", service: "alb", label: "ALB", parent: "a" }, { id: "alb-b", service: "alb", label: "ALB", parent: "b" }, { id: "db", service: "rds", label: "RDS" }],
    edges: [{ from: "alb-a", to: "db", step: 1 }, { from: "alb-b", to: "db", step: 1 }],
  };
  const out = awsToMarkdown(spec2);
  assert.match(out, /- \*\*Step 1\*\*: ALB \(Subnet A\) → RDS\n- \*\*Step 1\*\*: ALB \(Subnet B\) → RDS/);
  assert.match(out, /- ALB: alb/, "the nested Components list keeps the plain label");
});

test("migrateArtifacts tags old scenes from their id prefix, once, and leaves other elements alone", () => {
  const els = [{ id: "ntabcdefghi_0", type: "rectangle" }, { id: "awsk3f_n-fn", type: "image", customData: { x: 1 } }, { id: "plain", type: "rectangle" }, { id: "ntabcdefghi_1", type: "text", customData: { artifact: "ntabcdefghi_" } }];
  const out = migrateArtifacts(els);
  assert.equal(out[0].customData.artifact, "ntabcdefghi_");
  assert.deepEqual(out[1].customData, { x: 1, artifact: "awsk3f_" });
  assert.equal(out[2], els[2]);
  assert.equal(out[3], els[3]);
  assert.equal(migrateArtifacts(out), out, "nothing to do the second time");
  const clean = [{ id: "a", type: "rectangle" }];
  assert.equal(migrateArtifacts(clean), clean);
});
