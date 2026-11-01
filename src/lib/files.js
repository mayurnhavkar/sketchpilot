// Reading user-attached context in the browser. Nothing here touches the server's filesystem:
// the user picks the files, the page reads them, and only their text is sent along with a request.
const TEXT_EXT = /\.(md|mdx|txt|rst|json|jsonc|ya?ml|toml|csv|tsv|py|ipynb|js|jsx|mjs|ts|tsx|go|rs|java|kt|swift|c|h|cpp|hpp|cs|rb|php|sh|sql|html|css|ini|cfg|conf|mmd|puml|tf|proto|graphql)$/i;
const SKIP_PATH = /(^|\/)(node_modules|\.git|dist|build|\.venv|venv|__pycache__|\.next|target|\.idea|\.obsidian|\.trash)(\/|$)/;
const SKIP_NAME = /(^|\/)(\.env[^/]*|id_rsa[^/]*|[^/]*\.(pem|key|p12|pfx)|[^/]*secret[^/]*|[^/]*credential[^/]*)$/i;

export const LIMITS = { perFile: 200_000, total: 150_000 };

// An Obsidian Excalidraw drawing (*.excalidraw.md) is notes plus a big compressed blob. Keep the notes and the
// text found inside the drawing; drop the blob, which is useless to a model and eats the context budget.
export function stripDrawingData(name, text) {
  if (!/\.excalidraw\.md$/i.test(name)) return text;
  const at = text.search(/(^|\n)(%%\n+)?##? Drawing\n/);
  return at < 0 ? text : text.slice(0, at).trimEnd() + "\n";
}

// -> { files: [{name,text}], skipped: n, chars }
export async function readTextFiles(fileList) {
  const files = [];
  let skipped = 0, chars = 0;
  for (const f of Array.from(fileList)) {
    const path = f.webkitRelativePath || f.name;
    if (SKIP_PATH.test(path) || SKIP_NAME.test(path) || !TEXT_EXT.test(f.name) || f.size > LIMITS.perFile) {
      skipped++;
      continue;
    }
    const text = stripDrawingData(f.name, await f.text());
    if (text.includes("\u0000") || chars + text.length > LIMITS.total) {
      skipped++;
      continue;
    }
    chars += text.length;
    files.push({ name: path, text });
  }
  return { files, skipped, chars };
}

// Downscale to at most 1568px on the long side (what vision models use anyway) and re-encode as JPEG.
export async function readImage(file, max = 1568) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; // flatten transparency
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const preview = c.toDataURL("image/jpeg", 0.85);
  return { name: file.name || "pasted image", mime: "image/jpeg", data: preview.split(",")[1], preview };
}
