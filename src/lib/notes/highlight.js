// Syntax colouring for Excalidraw, which has no rich text. Code is monospace, so every colour is its own text
// layer: the same lines, with every character that belongs to another colour replaced by a space. Stacked at the
// same position, the layers line up exactly and read as one coloured block (3-5 elements per code card).

export const CODE_COLORS = {
  base: "#24292f", keyword: "#cf222e", string: "#0a3069", comment: "#6e7781", number: "#0550ae", func: "#8250df", builtin: "#953800",
};

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
const LANGS = {
  python: {
    comment: "#", defs: words("def class"),
    keywords: words("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield"),
    builtins: words("self cls print len range int str float list dict set tuple bool type isinstance enumerate zip map filter sorted sum min max abs open super"),
  },
  javascript: {
    comment: "//", defs: words("function class"),
    keywords: words("const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false"),
    builtins: words("console Math JSON Object Array Promise Map Set String Number"),
  },
  java: {
    comment: "//", defs: words("class interface"),
    keywords: words("public private protected static final void int long double float boolean char byte short class interface extends implements new return if else for while do switch case break continue try catch finally throw throws import package null true false this super"),
    builtins: words("String System Integer List Map Set ArrayList HashMap Object"),
  },
  c: {
    comment: "//", defs: words("struct"),
    keywords: words("int long double float char void unsigned signed short const static struct enum typedef return if else for while do switch case break continue sizeof NULL true false class public private new delete namespace using template typename include"),
    builtins: words("printf malloc free std string vector cout cin endl"),
  },
  go: {
    comment: "//", defs: words("func type"),
    keywords: words("func type struct interface map chan package import return if else for range switch case break continue go defer var const nil true false select default"),
    builtins: words("fmt string int bool error make len append new"),
  },
  rust: {
    comment: "//", defs: words("fn struct enum impl trait"),
    keywords: words("fn let mut struct enum impl trait pub use mod return if else for while loop match break continue self Self const static true false Some None Ok Err"),
    builtins: words("String Vec Option Result Box println"),
  },
  sql: {
    comment: "--", defs: words(""),
    keywords: words("SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX DROP ALTER AND OR NOT NULL AS DISTINCT LIMIT UNION select from where join left right inner outer on group by order having insert into values update set delete create table index drop alter and or not null as distinct limit union"),
    builtins: words("COUNT SUM AVG MIN MAX count sum avg min max"),
  },
  bash: {
    comment: "#", defs: words("function"),
    keywords: words("if then else elif fi for while do done case esac function return in export local echo cd"),
    builtins: words("git npm node python pip ls cat grep sed awk curl"),
  },
  json: { comment: null, defs: words(""), keywords: words("true false null"), builtins: words("") },
  text: { comment: null, defs: words(""), keywords: words(""), builtins: words("") },
};
const ALIAS = {
  py: "python", python3: "python", js: "javascript", jsx: "javascript", ts: "javascript", tsx: "javascript", typescript: "javascript", node: "javascript",
  "c++": "c", cpp: "c", cc: "c", "c#": "java", csharp: "java", kotlin: "java", golang: "go", rs: "rust", sh: "bash", shell: "bash", zsh: "bash", yaml: "text", yml: "text", toml: "text",
};

export const langOf = (name) => {
  const n = String(name || "").toLowerCase();
  return LANGS[ALIAS[n] || n] ? ALIAS[n] || n : "text";
};

const STRING = `"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\``;

// -> [{ kind, color, text }] base layer first; layers with no visible characters are dropped.
export function highlight(code, language) {
  const lang = LANGS[langOf(language)];
  const lines = code.replace(/\t/g, "    ").split("\n");
  const kinds = lines.map((l) => new Array(l.length).fill("base"));
  const mark = (row, from, to, kind) => { for (let i = from; i < to; i++) kinds[row][i] = kind; };

  const c = lang.comment ? `(${lang.comment === "#" ? "#" : lang.comment === "//" ? "//" : "--"}.*$)` : "(?!x)x";
  const re = new RegExp(`${c}|(${STRING})|\\b(\\d[\\d_]*(?:\\.\\d+)?)\\b|\\b([A-Za-z_$][\\w$]*)\\b`, "g");
  let inTriple = false;

  lines.forEach((line, row) => {
    // python docstrings / multi-line strings
    if (langOf(language) === "python") {
      const n = (line.match(/"""|'''/g) || []).length;
      if (inTriple) {
        mark(row, 0, n ? line.search(/"""|'''/) + 3 : line.length, "string");
        if (n % 2 === 1) inTriple = false;
        if (n) { /* remainder of the line after the closing quotes is highlighted below */ } else return;
        if (n % 2 === 0) return;
      } else if (n % 2 === 1) {
        mark(row, line.search(/"""|'''/), line.length, "string");
        inTriple = true;
        line = line.slice(0, line.search(/"""|'''/));
      }
    }
    let prev = "";
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const [all, comment, str, num, id] = m;
      const from = m.index, to = from + all.length;
      if (comment) mark(row, from, to, "comment");
      else if (str) mark(row, from, to, "string");
      else if (num) mark(row, from, to, "number");
      else if (id) {
        const next = line.slice(to).match(/^\s*(.)/)?.[1];
        if (lang.keywords.has(id)) mark(row, from, to, "keyword");
        else if (lang.defs.has(prev)) mark(row, from, to, "func");
        else if (lang.builtins.has(id)) mark(row, from, to, "builtin");
        else if (next === "(") mark(row, from, to, "func");
        prev = id;
      }
      if (all === "") re.lastIndex++;
    }
  });

  const layers = [];
  for (const kind of ["base", "keyword", "func", "builtin", "string", "number", "comment"]) {
    const text = lines.map((line, row) => [...line].map((ch, i) => (kinds[row][i] === kind ? ch : " ")).join("").replace(/\s+$/, "")).join("\n");
    if (text.trim()) layers.push({ kind, color: CODE_COLORS[kind], text });
  }
  return layers.length ? layers : [{ kind: "base", color: CODE_COLORS.base, text: "" }];
}

// Break one over-long code line at a sensible spot, indenting the continuation.
export function wrapCodeLine(line, max) {
  if (line.length <= max) return [line];
  const indent = line.match(/^\s*/)[0];
  const out = [];
  let rest = line;
  let first = true;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    let at = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf(" "), slice.lastIndexOf("("));
    if (at < indent.length + 8) at = max - 1;
    out.push(rest.slice(0, at + 1).replace(/\s+$/, ""));
    rest = (first ? indent + "    " : indent + "    ") + rest.slice(at + 1).trimStart();
    first = false;
  }
  out.push(rest);
  return out;
}
