// Finding, tagging and recognising notes already on the canvas. Every element of one note carries the note's key
// (`nt<time>_`) in customData (see artifactKey), and the spec rides along on one element, like AWS diagrams.
import { artifactKey, withArtifactKey } from "../scene.js";

export const NOTES_HINT = /\b(notes?|cheat ?sheets?|study guide|flash ?cards?|revision|lecture|summari[sz]e|summary of|write[- ]?up)\b/i;

const live = (els) => els.filter((e) => !e.isDeleted);
const NOTE_KEY = /^nt[0-9a-z]{9}_$/;
export const notePrefixOf = (id) => (typeof id === "string" && /^nt[0-9a-z]{9}_/.test(id) ? id.slice(0, id.indexOf("_") + 1) : null);
const noteKey = (e, byId) => {
  const k = artifactKey(e, byId);
  return k && NOTE_KEY.test(k) ? k : null;
};

// -> [{ prefix, spec, origin: {x, y}, ids }] (oldest first)
export function listNotes(elements) {
  const els = live(elements);
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  const out = [];
  for (const e of els) {
    if (!e.customData?.notesSpec) continue;
    const prefix = noteKey(e, byId);
    if (!prefix) continue;
    let spec;
    try { spec = JSON.parse(e.customData.notesSpec); } catch { continue; }
    const mine = els.filter((x) => noteKey(x, byId) === prefix);
    out.push({
      prefix, spec, ids: mine.map((x) => x.id),
      origin: { x: Math.min(...mine.map((x) => x.x)), y: Math.min(...mine.map((x) => x.y)) },
    });
  }
  return out.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

// The note being edited: the one containing the selection, else `lastPrefix`, else the newest.
export function findNote(elements, selectedIds = new Set(), lastPrefix = null) {
  const all = listNotes(elements);
  if (!all.length) return { note: null, selected: false };
  const els = live(elements);
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  for (const id of selectedIds) {
    const p = byId[id] && noteKey(byId[id], byId);
    const hit = p && all.find((d) => d.prefix === p);
    if (hit) return { note: hit, selected: true };
  }
  const last = lastPrefix && all.find((d) => d.prefix === lastPrefix);
  return { note: last || all[all.length - 1], selected: false };
}

// Tag every element with the note's key, and keep the spec on one non-text element (text ids may be rewritten).
export function tagNotes(created, prefix, spec) {
  const tagged = withArtifactKey(created, prefix);
  const json = JSON.stringify(spec);
  let i = tagged.findIndex((e) => e.type !== "text" && e.id.startsWith(prefix));
  if (i < 0) i = tagged.findIndex((e) => e.id.startsWith(prefix));
  return i < 0 ? tagged : tagged.map((e, j) => (j === i ? { ...e, customData: { ...e.customData, notesSpec: json } } : e));
}
