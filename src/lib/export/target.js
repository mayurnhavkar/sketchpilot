// What "Export" means right now: the selected note or AWS diagram, else the only one on the canvas, else the
// whole scene. Pure, so it is easy to test.
import { findNote, listNotes } from "../notes/note.js";
import { findAwsDiagram, listAwsDiagrams } from "../aws/diagram.js";

const live = (els) => els.filter((e) => !e.isDeleted);
const textOf = (e) => (e.type === "text" ? e.text : "");

// the time part of an artifact prefix (`aws<t>_` / `nt<t>_`), so the newer of a note and a diagram can be told apart
const stamp = (prefix) => prefix.replace(/^(aws|nt)/, "");

// -> { kind: "notes"|"aws"|"scene", name, spec?, elements, texts, label }
export function pickExportTarget(allElements, selectedIds, sceneName, { lastNote = null, lastAws = null } = {}) {
  const els = live(allElements);
  const byId = new Set(els.map((e) => e.id));
  const pick = (ids) => els.filter((e) => ids.has(e.id));

  const n = findNote(els, selectedIds, lastNote);
  const a = findAwsDiagram(els, selectedIds, lastAws);
  const hasNote = listNotes(els).length > 0, hasAws = listAwsDiagrams(els).length > 0;

  let choice = null;
  if (n.selected) choice = "notes";
  else if (a.selected) choice = "aws";
  else if (hasNote && !hasAws) choice = "notes";
  else if (hasAws && !hasNote) choice = "aws";
  else if (hasNote && hasAws) choice = stamp(n.note.prefix) >= stamp(a.diagram.prefix) ? "notes" : "aws";

  if (choice === "notes") {
    const ids = new Set(n.note.ids.filter((id) => byId.has(id)));
    return { kind: "notes", name: n.note.spec.title, spec: n.note.spec, elements: pick(ids), texts: [], label: `Notes “${n.note.spec.title}” · ${n.note.spec.sections.length} sections` };
  }
  if (choice === "aws") {
    const d = a.diagram;
    const ids = new Set(d.ids.filter((id) => byId.has(id)));
    const title = d.spec.title || "AWS architecture";
    return { kind: "aws", name: title, spec: d.spec, elements: pick(ids), texts: [], label: `AWS diagram “${title}” · ${d.spec.nodes.length} services` };
  }
  const texts = els.map(textOf).filter(Boolean);
  return { kind: "scene", name: sceneName || "Untitled", elements: els, texts, label: `Scene “${sceneName || "Untitled"}” · ${els.length} elements` };
}
