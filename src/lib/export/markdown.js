// Pure: notes, AWS diagrams and plain scenes -> Obsidian-flavoured Markdown. No DOM, no Node APIs.
// Rules learned from testing in the real app: pipes in table cells must be escaped (an unescaped one silently
// drops the next cell), "[[" in prose is a link, and a title with a colon must be quoted in frontmatter.

const ZWSP = "​";
const CALLOUT_LABEL = { tip: "Tip", warning: "Watch out", note: "Note" };

// "[[" in ordinary text would become a link in Obsidian; a zero-width space keeps the text but breaks the link
export const guardLinks = (s) => String(s ?? "").replace(/\[\[/g, `[${ZWSP}[`).replace(/\]\]/g, `]${ZWSP}]`);
export const cell = (s) => guardLinks(s).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
export const yamlStr = (s) => JSON.stringify(String(s ?? "")); // a JSON string is a valid YAML double-quoted string

// valid Obsidian tag text: letters, digits, _ - / (not all digits)
export function tagify(s) {
  const t = String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}_\-/]+/gu, "-").replace(/^-+|-+$/g, "");
  return t && /\D/.test(t) ? t : "";
}

// a code fence longer than any backtick run inside the code
export function fenceFor(code) {
  const runs = String(code).match(/`+/g) || [];
  return "`".repeat(Math.max(2, ...runs.map((r) => r.length)) + 1);
}

export function frontmatter({ title, tags = [], created, extra = {} }) {
  const lines = ["---", `title: ${yamlStr(title)}`];
  const clean = [...new Set(tags.map(tagify).filter(Boolean))];
  if (clean.length) lines.push(`tags: [${clean.join(", ")}]`);
  if (created) lines.push(`created: ${created}`);
  lines.push("source: excalidraw-claude");
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}: ${Array.isArray(v) ? `[${v.map(yamlStr).join(", ")}]` : yamlStr(v)}`);
  lines.push("---");
  return lines.join("\n") + "\n";
}

const tidy = (s) => s.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
const slugName = (slug) => String(slug || "").replace(/-/g, " ");

// ---------- notes ----------
function chainText(s) {
  const n = s.nodes;
  const ptr = s.pointers.map((p) => `${p.label} → node ${p.at + 1}`).join(", ");
  let pic;
  if (s.kind === "linked") pic = [...n.map((x) => `[${x} | •]`), s.end || "None"].join(" → ");
  else if (s.kind === "doubly") pic = [...n.map((x) => `[• | ${x} | •]`), s.end || "None"].join(" ⇄ ");
  else if (s.kind === "array") pic = `${n.map((x) => `[${x}]`).join("")}\n${n.map((x, i) => ` ${String(i).padEnd(String(x).length + 1)}`).join("")}`;
  else pic = n.join(" → ");
  const f = fenceFor(pic);
  return `${f}text\n${pic}\n${f}${ptr ? `\n\nPointers: ${ptr}` : ""}${s.caption ? `\n\n${guardLinks(s.caption)}` : ""}`;
}

export function notesText(spec) {
  const out = [spec.title, spec.subtitle];
  for (const s of spec.sections) {
    out.push(s.title, s.caption, s.text);
    for (const k of ["bullets", "steps", "nodes"]) if (s[k]) out.push(...s[k]);
    if (s.rows) out.push(...s.columns, ...s.rows.flat());
    if (s.items) out.push(...s.items.flatMap((x) => [x.q, x.a]));
    if (s.code) out.push(s.code);
  }
  return out.filter(Boolean).join("\n");
}

// titles of other notes (file names) mentioned in this note's text: candidates for [[links]]
export function relatedTitles(others, own, text) {
  const hay = String(text || "").toLowerCase();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return others
    .filter((t) => t && t !== own && t.length >= 3)
    .filter((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(t.toLowerCase())}([^\\p{L}\\p{N}]|$)`, "u").test(hay))
    .slice(0, 12);
}
const relatedBlock = (links) => (links.length ? `## Related\n\n${links.map((l) => `- [[${l}]]`).join("\n")}\n` : "");

export function notesToMarkdown(spec, { imageName, created, related = [], withFrontmatter = true } = {}) {
  const langs = spec.sections.filter((s) => s.type === "code" && s.language && s.language !== "text").map((s) => s.language);
  const out = [];
  if (withFrontmatter) out.push(frontmatter({ title: spec.title, tags: ["notes", ...langs], created }));
  out.push(`# ${guardLinks(spec.title)}`, "");
  if (spec.subtitle) out.push(`> ${guardLinks(spec.subtitle)}`, "");
  if (imageName) out.push(`![[${imageName}]]`, "");
  for (const s of spec.sections) {
    if (s.title && s.type !== "callout") out.push(`## ${guardLinks(s.title)}`, "");
    if (s.type === "points") out.push(...s.bullets.map((b) => `- ${guardLinks(b)}`), "");
    else if (s.type === "code") {
      const f = fenceFor(s.code);
      out.push(f + (s.language === "text" ? "" : s.language), s.code, f, "");
    } else if (s.type === "table") {
      out.push(`| ${s.columns.map(cell).join(" | ")} |`, `| ${s.columns.map(() => "---").join(" | ")} |`, ...s.rows.map((r) => `| ${r.map(cell).join(" | ")} |`), "");
    } else if (s.type === "callout") {
      const kind = ["tip", "warning", "note"].includes(s.kind) ? s.kind : "note";
      out.push(`> [!${kind}] ${guardLinks(s.title || CALLOUT_LABEL[kind])}`, ...guardLinks(s.text).split("\n").map((l) => `> ${l}`), "");
    } else if (s.type === "steps") out.push(...s.steps.map((t, i) => `${i + 1}. ${guardLinks(t)}`), "");
    else if (s.type === "qa") out.push(...s.items.flatMap((x) => [`> [!question]- ${guardLinks(x.q)}`, `> ${guardLinks(x.a)}`, ""]));
    else if (s.type === "chain") out.push(chainText(s), "");
  }
  out.push(relatedBlock(related));
  return tidy(out.join("\n"));
}

// ---------- AWS diagrams ----------
export function awsText(spec) {
  return [spec.title, ...spec.groups.map((g) => g.label), ...spec.nodes.flatMap((n) => [n.label, slugName(n.service)]), ...spec.edges.map((e) => e.label)].filter(Boolean).join("\n");
}

// the spec without render-only fields (icon file, colour): portable "diagram as code"
export function portableAwsSpec(spec) {
  return {
    ...(spec.title ? { title: spec.title } : {}),
    groups: spec.groups.map(({ id, kind, label, parent }) => ({ id, kind, ...(label ? { label } : {}), ...(parent ? { parent } : {}) })),
    nodes: spec.nodes.map(({ id, service, label, parent }) => ({ id, service, label, ...(parent ? { parent } : {}) })),
    edges: spec.edges.map(({ from, to, label, step, bidirectional }) => ({ from, to, ...(label ? { label } : {}), ...(step ? { step } : {}), ...(bidirectional ? { bidirectional } : {}) })),
  };
}

export function awsToMarkdown(spec, { imageName, created, related = [], withFrontmatter = true } = {}) {
  const title = spec.title || "AWS architecture";
  const out = [];
  if (withFrontmatter) out.push(frontmatter({ title, tags: ["aws", "architecture", "diagram"], created }));
  out.push(`# ${guardLinks(title)}`, "");
  if (imageName) out.push(`![[${imageName}]]`, "");

  out.push("## Components", "");
  // two services can share a label (an ALB in each zone): tell them apart by their group
  const counts = {};
  for (const n of spec.nodes) counts[n.label] = (counts[n.label] || 0) + 1;
  const groupLabel = new Map(spec.groups.map((g) => [g.id, g.label || g.id]));
  const label = new Map([
    ...spec.groups.map((g) => [g.id, g.label || g.id]),
    ...spec.nodes.map((n) => [n.id, counts[n.label] > 1 && n.parent ? `${n.label} (${groupLabel.get(n.parent) || n.parent})` : n.label]),
  ]);
  const byParent = new Map();
  for (const x of [...spec.groups.map((g) => ({ ...g, isGroup: true })), ...spec.nodes]) {
    const k = x.parent || "";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(x);
  }
  const walk = (parent, depth) => {
    for (const x of byParent.get(parent) || []) {
      const pad = "  ".repeat(depth);
      if (x.isGroup) {
        out.push(`${pad}- **${guardLinks(x.label || x.kind)}** (${slugName(x.kind)})`);
        walk(x.id, depth + 1);
      } else {
        out.push(`${pad}- ${guardLinks(x.label)}: ${x.service === "generic" ? "no matching icon" : slugName(x.service)}`);
      }
    }
  };
  walk("", 0);
  out.push("");

  const edgeText = (e) => `${guardLinks(label.get(e.from))} ${e.bidirectional ? "↔" : "→"} ${guardLinks(label.get(e.to))}${e.label ? ` (${guardLinks(e.label)})` : ""}`;
  const stepped = spec.edges.filter((e) => e.step).sort((a, b) => a.step - b.step);
  const other = spec.edges.filter((e) => !e.step);
  if (stepped.length) out.push("## Flow", "", ...stepped.map((e) => `- **Step ${e.step}**: ${edgeText(e)}`), "");
  if (other.length) out.push("## Connections", "", ...other.map((e) => `- ${edgeText(e)}`), "");

  const json = JSON.stringify(portableAwsSpec(spec), null, 2);
  const f = fenceFor(json);
  out.push("## Spec", "", "The diagram as data; paste it back into the app to regenerate it.", "", `${f}json`, json, f, "");
  out.push(relatedBlock(related));
  return tidy(out.join("\n"));
}

// ---------- any other scene ----------
export function sceneToMarkdown({ title, texts = [], imageName, created, related = [], withFrontmatter = true }) {
  const out = [];
  if (withFrontmatter) out.push(frontmatter({ title, tags: ["diagram"], created }));
  out.push(`# ${guardLinks(title)}`, "");
  if (imageName) out.push(`![[${imageName}]]`, "");
  const seen = [...new Set(texts.map((t) => String(t).replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 60);
  if (seen.length) out.push("## Text in this drawing", "", ...seen.map((t) => `- ${guardLinks(t.slice(0, 120))}`), "");
  out.push(relatedBlock(related));
  return tidy(out.join("\n"));
}
