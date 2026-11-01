import fs from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

// AWS publishes the Architecture Icons as one zip. The terms allow using them in architecture diagrams but say
// nothing about redistribution, so this app never commits them: it fetches them onto the user's machine.
export const ICONS_PAGE = "https://aws.amazon.com/architecture/icons/";
export const FALLBACK_URL =
  "https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip";
const ALLOWED_HOST = "d1.awsstatic.com";
const MAX_ZIP = 80_000_000;

// AWS file names already hyphenate words; internal capitals are part of a name ("DynamoDB", "CloudFront")
export const kebab = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const strip = (s) => s.replace(/^(amazon|aws)-/, "");

// Icon files come from a zip we did not write: treat them as untrusted and refuse anything active.
export function svgIsSafe(text) {
  return !/<script|<foreignObject|<!ENTITY|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["'](?!#)/i.test(text);
}

// -> [{ kind, name, category?, color?, text }] (parsed straight from file names)
export function parsePackage(files) {
  const out = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (name.includes("__MACOSX") || name.endsWith(".DS_Store")) continue;
    const text = strFromU8(bytes);
    if (!svgIsSafe(text)) continue;
    let m;
    if ((m = name.match(/Architecture-Service-Icons_[^/]*\/Arch_([^/]+)\/64\/Arch_(.+?)(?:_Light)?_64\.svg$/)) && !/_Dark_64\.svg$/.test(name)) {
      out.push({ kind: "service", category: m[1], raw: m[2], color: text.match(/Icon-Architecture-BG[^>]*fill="(#[0-9A-Fa-f]{6})"/)?.[1] || null, text });
    } else if ((m = name.match(/Architecture-Group-Icons_[^/]*\/([^/]+)_32\.svg$/))) {
      out.push({ kind: "group", raw: m[1], text });
    } else if ((m = name.match(/Resource-Icons_[^/]*\/Res_([^/]+)\/(?:Res_48_Light\/)?Res_(.+?)(?:_48_Light|_48)\.svg$/)) && !/_Dark/.test(name)) {
      out.push({ kind: "resource", category: m[1], raw: m[2], text });
    }
  }
  return out;
}

const GROUP_SLUGS = { "AWS-Cloud": "aws-cloud", "AWS-Cloud-logo": "aws-cloud-logo", Region: "region", "Virtual-private-cloud-VPC": "vpc", "AWS-Account": "account" };

// Turn parsed icons into slugs + an index. Resource names that collide get their service as a prefix.
export function buildIndex(parsed, version) {
  const services = [], groups = [], resources = [];
  const taken = new Set();
  const place = (list, entry, dir, base) => {
    let slug = base, n = 2;
    while (taken.has(`${dir}/${slug}`)) slug = `${base}-${n++}`;
    taken.add(`${dir}/${slug}`);
    list.push({ ...entry, slug, file: `${dir}/${slug}.svg` });
    return slug;
  };
  const files = new Map();
  for (const p of parsed.filter((x) => x.kind === "service")) {
    const slug = place(services, { name: p.raw.replace(/-/g, " "), category: kebab(p.category), color: p.color }, "services", strip(kebab(p.raw)));
    files.set(`services/${slug}.svg`, p.text);
  }
  for (const p of parsed.filter((x) => x.kind === "group")) {
    const slug = place(groups, { name: p.raw.replace(/-/g, " ") }, "groups", GROUP_SLUGS[p.raw] || kebab(p.raw));
    files.set(`groups/${slug}.svg`, p.text);
  }
  // resources: prefer the bare resource name ("nat-gateway"); fall back to "<service>-<resource>" on collisions
  const resBase = (p) => {
    const parts = p.raw.split("_");
    return parts.length > 1 ? { service: strip(kebab(parts[0])), res: kebab(parts.slice(1).join("-")) } : { service: "", res: strip(kebab(parts[0])) };
  };
  const counts = {};
  for (const p of parsed.filter((x) => x.kind === "resource")) counts[resBase(p).res] = (counts[resBase(p).res] || 0) + 1;
  const serviceSlugs = new Set(services.map((s) => s.slug));
  for (const p of parsed.filter((x) => x.kind === "resource")) {
    const { service, res } = resBase(p);
    const base = counts[res] > 1 || serviceSlugs.has(res) ? (service ? `${service}-${res}` : `${res}-icon`) : res;
    const slug = place(resources, { name: p.raw.replace(/_/g, " ").replace(/-/g, " "), service, category: kebab(p.category) }, "resources", base);
    files.set(`resources/${slug}.svg`, p.text);
  }
  const byName = (a, b) => a.slug.localeCompare(b.slug);
  return {
    index: { version, installedAt: new Date().toISOString(), services: services.sort(byName), groups: groups.sort(byName), resources: resources.sort(byName) },
    files,
  };
}

export function writeIcons(outDir, index, files) {
  const tmp = `${outDir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [rel, text] of files) {
    const f = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  fs.writeFileSync(path.join(tmp, "index.json"), JSON.stringify(index));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(tmp, outDir);
}

// The page lists the current zip; its name changes every quarter, so look it up and fall back to a known one.
export async function discoverUrl(fetchImpl = fetch) {
  try {
    const html = await (await fetchImpl(ICONS_PAGE, { signal: AbortSignal.timeout(15_000) })).text();
    const m = html.match(/https:\/\/d1\.awsstatic\.com\/[^"'\s]*Icon-package_[^"'\s]*\.zip/);
    if (m) return m[0];
  } catch {}
  return FALLBACK_URL;
}

async function download(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== ALLOWED_HOST) throw new Error(`refusing to download from ${u.hostname}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_ZIP) throw new Error("package is unexpectedly large");
  return buf;
}

// zip: optional local path to an already-downloaded package.
export async function installIcons({ outDir, zip, url, log = () => {} }) {
  let data;
  if (zip) {
    log(`reading ${zip}`);
    data = new Uint8Array(fs.readFileSync(zip));
  } else {
    const u = url || (await discoverUrl());
    log(`downloading ${u.split("/").pop()}`);
    data = await download(u);
  }
  log("unpacking icons");
  const files = unzipSync(data, {
    filter: (f) => f.name.endsWith(".svg") && !f.name.includes("__MACOSX") && /(_64|_32|_48|_48_Light)\.svg$/.test(f.name),
  });
  const version = Object.keys(files).map((n) => n.match(/Icons_(\d{8})/)?.[1]).find(Boolean) || "unknown";
  const { index, files: out } = buildIndex(parsePackage(files), version);
  if (!index.services.length) throw new Error("no service icons found: is this the AWS Architecture Icons package?");
  writeIcons(outDir, index, out);
  log(`installed ${index.services.length} services, ${index.resources.length} resources, ${index.groups.length} groups`);
  return { services: index.services.length, resources: index.resources.length, groups: index.groups.length, version };
}

export function readIndex(outDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(outDir, "index.json"), "utf8"));
  } catch {
    return null;
  }
}
