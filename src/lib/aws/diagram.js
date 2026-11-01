// Finding and replacing AWS diagrams already on the canvas. A diagram's elements all share an id prefix
// (`aws<time>_`), and its spec rides along in the customData of one element.
export const AWS_HINT =
  /\b(aws|amazon web services|ec2|lambda|s3|dynamodb|cloudfront|route ?53|eks|ecs|fargate|rds|aurora|sqs|sns|api gateway|cognito|kinesis|eventbridge|cloudformation|vpc|elasticache|redshift|sagemaker|bedrock|nat gateway|alb|nlb)\b/i;
export const EDIT_VERB = /^\s*(add|remove|delete|replace|change|rename|move|also|now|put|swap|connect|insert|drop|use|make|include|place)\b/i;

import { artifactKey, withArtifactKey } from "../scene.js";

const live = (els) => els.filter((e) => !e.isDeleted);
const AWS_KEY = /^aws[0-9a-z]+_$/;
const awsKey = (e, byId) => {
  const k = artifactKey(e, byId);
  return k && AWS_KEY.test(k) ? k : null;
};
export const prefixOf = (id) => (typeof id === "string" && /^aws[0-9a-z]+_/.test(id) ? id.slice(0, id.indexOf("_") + 1) : null);

// -> [{ prefix, spec, origin: {x, y}, ids }] (oldest first)
export function listAwsDiagrams(elements) {
  const els = live(elements);
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  const out = [];
  for (const e of els) {
    if (!e.customData?.awsSpec) continue;
    const prefix = awsKey(e, byId);
    if (!prefix) continue;
    let spec;
    try { spec = JSON.parse(e.customData.awsSpec); } catch { continue; }
    const mine = els.filter((x) => awsKey(x, byId) === prefix);
    out.push({
      prefix, spec, ids: mine.map((x) => x.id),
      origin: { x: Math.min(...mine.map((x) => x.x)), y: Math.min(...mine.map((x) => x.y)) },
    });
  }
  return out.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

// The diagram being edited: the one containing the selection, else `lastPrefix`, else the only/newest one.
export function findAwsDiagram(elements, selectedIds = new Set(), lastPrefix = null) {
  const all = listAwsDiagrams(elements);
  if (!all.length) return { diagram: null, selected: false };
  const els = live(elements);
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  for (const id of selectedIds) {
    const p = byId[id] && awsKey(byId[id], byId);
    const hit = p && all.find((d) => d.prefix === p);
    if (hit) return { diagram: hit, selected: true };
  }
  const last = lastPrefix && all.find((d) => d.prefix === lastPrefix);
  return { diagram: last || all[all.length - 1], selected: false };
}

// Tag every element with the diagram's key, and keep the spec on one non-text element (text ids may be rewritten).
export function tagSpec(created, prefix, spec) {
  const tagged = withArtifactKey(created, prefix);
  const json = JSON.stringify(spec);
  let i = tagged.findIndex((e) => e.type !== "text" && e.id.startsWith(prefix));
  if (i < 0) i = tagged.findIndex((e) => e.id.startsWith(prefix));
  return i < 0 ? tagged : tagged.map((e, j) => (j === i ? { ...e, customData: { ...e.customData, awsSpec: json } } : e));
}

// the files a spec needs, relative to /aws-icons/
export function neededIcons(spec, groupIcon) {
  const files = new Set(spec.nodes.map((n) => n.file).filter(Boolean));
  for (const g of spec.groups) {
    const icon = groupIcon(g.kind);
    if (icon) files.add(`groups/${icon}.svg`);
  }
  return [...files];
}
