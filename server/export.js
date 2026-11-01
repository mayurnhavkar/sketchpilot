import fs from "node:fs";
import path from "node:path";
import { safeSceneName } from "../src/lib/names.js";
import { awsText, awsToMarkdown, notesText, notesToMarkdown, relatedTitles, sceneToMarkdown } from "../src/lib/export/markdown.js";
import { buildScene, toExcalidrawMd } from "../src/lib/export/obsidian.js";
import { sanitizeNotes } from "./notes.js";

const MAX_SVG = 25_000_000;
const BACKUPS_KEPT = 10;
const FORMATS = ["markdown", "svg", "drawing"];

// The SVG comes from our own page, but it is written into the user's vault, so check it anyway: nothing active,
// nothing that loads from the network (embedded data: images are fine, they are how icons travel).
export function svgIsSafeToWrite(svg) {
  return (
    typeof svg === "string" && svg.length > 0 && svg.length <= MAX_SVG && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg) &&
    !/<script|<foreignObject|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|file:)/i.test(svg)
  );
}

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

// shape-check an AWS spec that came back from the browser (it was validated when created; this is defence in depth)
export function coerceAwsSpec(spec) {
  if (!spec || typeof spec !== "object") return null;
  const groups = (Array.isArray(spec.groups) ? spec.groups : []).slice(0, 60).filter((g) => g && typeof g.id === "string").map((g) => ({ id: str(g.id, 40), kind: str(g.kind, 30) || "generic", label: str(g.label, 80), parent: g.parent ? str(g.parent, 40) : undefined }));
  const nodes = (Array.isArray(spec.nodes) ? spec.nodes : []).slice(0, 150).filter((n) => n && typeof n.id === "string").map((n) => ({ id: str(n.id, 40), service: str(n.service, 60) || "generic", label: str(n.label, 80) || str(n.id, 40), parent: n.parent ? str(n.parent, 40) : undefined }));
  const edges = (Array.isArray(spec.edges) ? spec.edges : []).slice(0, 300).filter((e) => e && typeof e.from === "string" && typeof e.to === "string").map((e) => ({ from: str(e.from, 40), to: str(e.to, 40), label: e.label ? str(e.label, 60) : undefined, step: Number.isInteger(e.step) ? e.step : undefined, bidirectional: e.bidirectional === true || undefined }));
  return nodes.length ? { title: str(spec.title, 100) || undefined, groups, nodes, edges } : null;
}

// Writes notes, images and drawings into one folder (an Obsidian vault, if the user points it there).
export function createExporter(dir, { now = () => new Date() } = {}) {
  const histDir = (name) => path.join(dir, ".export-history", name);
  const stamp = () => now().toISOString().slice(0, 10);

  // names of notes already in the folder: candidates for [[links]]
  function existingTitles() {
    if (!fs.existsSync(dir)) return [];
    return [
      ...new Set(
        fs.readdirSync(dir)
          .filter((f) => f.endsWith(".md") && !f.startsWith("."))
          .map((f) => f.replace(/\.excalidraw\.md$/, "").replace(/\.md$/, "")),
      ),
    ].sort();
  }

  // keep the `created` date of a note that is being exported again
  function createdOf(name) {
    for (const ext of [".md", ".excalidraw.md"]) {
      const f = path.join(dir, name + ext);
      if (!fs.existsSync(f)) continue;
      const m = fs.readFileSync(f, "utf8").match(/^---\n[\s\S]*?\ncreated:\s*(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    }
    return stamp();
  }

  // write a file; if it already exists and differs, keep the old version (the user may have edited it in Obsidian)
  function writeSafely(name, ext, content) {
    const target = path.join(dir, name + ext);
    let backup = null;
    if (fs.existsSync(target)) {
      const prev = fs.readFileSync(target);
      if (!prev.equals(Buffer.from(content))) {
        const h = histDir(name);
        fs.mkdirSync(h, { recursive: true });
        backup = `${Date.now()}${ext}`;
        fs.writeFileSync(path.join(h, backup), prev);
        for (const old of fs.readdirSync(h).filter((x) => x.endsWith(ext)).sort().slice(0, -BACKUPS_KEPT)) fs.rmSync(path.join(h, old), { force: true });
      } else return { name: name + ext, bytes: prev.length, unchanged: true };
    }
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
    return { name: name + ext, bytes: Buffer.byteLength(content), backup };
  }

  // req: { name?, kind: notes|aws|scene, spec?, texts?, svg?, scene?: { elements, files, background }, formats }
  function exportItem(req) {
    const formats = Object.fromEntries(FORMATS.map((f) => [f, !!req.formats?.[f]]));
    if (!FORMATS.some((f) => formats[f])) throw new Error("nothing to export: choose at least one format");
    if (!["notes", "aws", "scene"].includes(req.kind)) throw new Error("unknown export kind");

    let spec = null, title = str(req.name, 100);
    if (req.kind === "notes") {
      spec = sanitizeNotes(req.spec);
      if (!spec) throw new Error("these notes are empty or malformed");
      title = spec.title;
    } else if (req.kind === "aws") {
      spec = coerceAwsSpec(req.spec);
      if (!spec) throw new Error("this AWS diagram spec is empty or malformed");
      title = spec.title || title || "AWS architecture";
    }
    const name = safeSceneName(title || "Untitled");

    if (formats.svg && !svgIsSafeToWrite(req.svg)) throw new Error("the image was missing, too large, or contained something unsafe");
    if (formats.drawing && !(Array.isArray(req.scene?.elements) && req.scene.elements.length && req.scene.elements.length <= 6000)) throw new Error("the drawing has no elements to save");

    fs.mkdirSync(dir, { recursive: true });
    const created = createdOf(name);
    const text = req.kind === "notes" ? notesText(spec) : req.kind === "aws" ? awsText(spec) : (req.texts || []).join("\n");
    const related = relatedTitles(existingTitles(), name, text);
    const md = (imageName, withFrontmatter = true) =>
      req.kind === "notes" ? notesToMarkdown(spec, { imageName, created, related, withFrontmatter })
      : req.kind === "aws" ? awsToMarkdown(spec, { imageName, created, related, withFrontmatter })
      : sceneToMarkdown({ title: name, texts: (Array.isArray(req.texts) ? req.texts : []).slice(0, 200).map((t) => str(t, 300)), imageName, created, related, withFrontmatter });

    const written = [];
    if (formats.svg) written.push(writeSafely(name, ".svg", req.svg));
    if (formats.markdown) written.push(writeSafely(name, ".md", md(formats.svg ? `${name}.svg` : null)));
    if (formats.drawing) {
      const scene = buildScene(req.scene.elements, req.scene.files || {}, str(req.scene.background, 20) || "#ffffff");
      written.push(writeSafely(name, ".excalidraw.md", toExcalidrawMd(md(null), scene)));
    }
    return { dir, name, files: written, related };
  }

  return { dir, existingTitles, exportItem };
}
