// Scene names become file names (and, in an Obsidian vault, note names), so they follow the file-name rules
// Obsidian and the major operating systems share, not a narrow ASCII whitelist.
export const NAME_MAX = 100;
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/;

export function validSceneName(name) {
  return (
    typeof name === "string" && name.length >= 1 && name.length <= NAME_MAX && name === name.trim() &&
    !ILLEGAL.test(name) && !name.startsWith(".") && !name.includes("..") && !/[. ]$/.test(name)
  );
}

// any title -> a name validSceneName accepts ("Trading: post-mortem?" -> "Trading post-mortem")
export function safeSceneName(title) {
  const n = String(title ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\.{2,}/g, " ") // ".." is never part of a name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, NAME_MAX)
    .trim();
  return n && validSceneName(n) ? n : "Untitled";
}
