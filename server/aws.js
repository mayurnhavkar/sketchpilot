// AWS architecture mode: the model describes services, nesting and connections; it never positions anything.
// The browser lays the spec out (ELK) and draws it with the official AWS Architecture Icons.

export const GROUP_KINDS = [
  "aws-cloud", "account", "region", "vpc", "az", "public-subnet", "private-subnet", "security-group",
  "auto-scaling-group", "corporate-data-center", "server-contents", "ec2-instance-contents", "generic",
];

// Names people actually type -> canonical slugs in the icon index
export const ALIASES = {
  s3: "simple-storage-service", sqs: "simple-queue-service", sns: "simple-notification-service",
  ses: "simple-email-service", ecs: "elastic-container-service", eks: "elastic-kubernetes-service",
  ecr: "elastic-container-registry", elb: "elastic-load-balancing", alb: "application-load-balancer",
  nlb: "network-load-balancer", gwlb: "gateway-load-balancer", iam: "identity-and-access-management",
  kms: "key-management-service", vpc: "virtual-private-cloud", igw: "internet-gateway", nat: "nat-gateway",
  natgw: "nat-gateway", efs: "efs", ebs: "elastic-block-store", dynamo: "dynamodb", sagemaker: "sagemaker-ai",
  opensearch: "opensearch-service", elasticsearch: "opensearch-service", msk: "managed-streaming-for-apache-kafka",
  kafka: "managed-streaming-for-apache-kafka", kinesis: "kinesis-data-streams", stepfunctions: "step-functions",
  secrets: "secrets-manager", browser: "client", web: "client", mobile: "mobile-client", onprem: "server",
  "on-premises": "server", "load-balancer": "application-load-balancer", cdn: "cloudfront", dns: "route-53",
  "lambda-function": "lambda", container: "elastic-container-service", cache: "elasticache", queue: "simple-queue-service",
  bucket: "simple-storage-service", database: "database",
};

const POPULAR_RESOURCES =
  /^(internet-gateway|nat-gateway|application-load-balancer|network-load-balancer|gateway-load-balancer|vpn-gateway|customer-gateway|router|route-table|network-access-control-list|endpoints|peering-connection|elastic-ip-address|user|users|authenticated-user|client|mobile-client|internet|server|servers|database|firewall|globe|office-building|generic-application|source-code|logs|metrics|documents|shield|ssl-padlock|data-stream|disk|gear|toolkit|sdk|saml-token|credentials|ec2-instance|ec2-instances|ebs-volume|volume|snapshot|bucket|object)$/;

export function makeCatalog(index) {
  const bySlug = new Map();
  for (const e of index.services) bySlug.set(e.slug, { ...e, kind: "service" });
  for (const e of index.resources) if (!bySlug.has(e.slug)) bySlug.set(e.slug, { ...e, kind: "resource" });
  const flat = (s) => s.replace(/[^a-z0-9]/g, "");
  const flatMap = new Map();
  for (const e of bySlug.values()) {
    for (const k of [flat(e.slug), flat(e.slug.replace(/^(amazon|aws)-/, ""))]) if (!flatMap.has(k)) flatMap.set(k, e);
  }
  return { bySlug, flatMap, flat };
}

// "S3", "api gateway", "AWS Lambda" -> index entry, or null
export function resolveService(input, cat) {
  if (typeof input !== "string") return null;
  const s = input.toLowerCase().trim().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
  if (!s) return null;
  const tries = [s, ALIASES[s], s.replace(/^(amazon|aws)-/, ""), ALIASES[s.replace(/^(amazon|aws)-/, "")]];
  for (const t of tries) if (t && cat.bySlug.has(t)) return cat.bySlug.get(t);
  const f = cat.flatMap.get(cat.flat(s)) || cat.flatMap.get(cat.flat(s.replace(/^(amazon|aws)-/, "")));
  if (f) return f;
  const starts = [...cat.bySlug.values()].filter((e) => e.slug.startsWith(s) && s.length >= 4);
  return starts.length === 1 ? starts[0] : null;
}

export function catalogText(index) {
  const byCat = {};
  for (const e of index.services) (byCat[e.category] ||= []).push(e.slug);
  const lines = Object.entries(byCat).map(([c, l]) => `${c}: ${l.join(", ")}`);
  const res = index.resources.filter((r) => POPULAR_RESOURCES.test(r.slug)).map((r) => r.slug);
  lines.push(`resources and generic (users, internet, gateways, ...): ${res.join(", ")}`);
  return lines.join("\n");
}

export function awsAddendum(index) {
  return `

AWS ARCHITECTURE MODE. The user wants a professional AWS architecture diagram. Put it under the single key "aws" (do NOT use "mermaid" or "elements" for it). You describe the architecture; the app lays it out and draws it with the official AWS Architecture Icons. NEVER give coordinates.

"aws": {
  "title": "optional short title",
  "groups": [ {"id":"vpc","kind":"vpc","label":"VPC 10.0.0.0/16","parent":"region"} ],
  "nodes":  [ {"id":"alb","service":"application-load-balancer","label":"ALB","parent":"pub-a"} ],
  "edges":  [ {"from":"user","to":"cdn","label":"HTTPS","step":1} ]
}

Group kinds: ${GROUP_KINDS.join(", ")}.
Rules:
- Nest like real AWS: aws-cloud > region > vpc > az > subnet > resources. Users, the internet and on-premises sit OUTSIDE aws-cloud. Global/edge services (cloudfront, route-53, waf, iam, ...) sit in aws-cloud but outside any region or vpc. Regional managed services (simple-storage-service, dynamodb, simple-queue-service, ...) sit in the region, outside the vpc. Load balancers and NAT gateways go in public subnets; compute and databases in private subnets.
- Every node's "service" must be an exact slug from the catalog below; "label" is a short human name (max 3 words) that may include the role ("Orders API").
- Edges show request/data flow. Number the main flow with "step" (1, 2, 3...). Labels 1-3 words. Show the primary flow and key dependencies, not every possible link.
- Typically 6-30 nodes. Use two availability zones only when high availability is the point or when asked.
- Every id unique, short, lowercase letters/digits/hyphens. "parent" is a group id.
Service catalog (slugs by category):
${catalogText(index)}`;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const norm = (s) => (typeof s === "string" ? s.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) : "");
const text = (s, n) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

// -> { title, groups, nodes, edges } or null. Drops anything malformed; unknown services become generic boxes.
export function sanitizeAws(raw, index) {
  if (!raw || typeof raw !== "object" || !index) return null;
  const cat = makeCatalog(index);
  const ids = new Set();
  const groups = [];
  for (const g of (Array.isArray(raw.groups) ? raw.groups : []).slice(0, 40)) {
    const id = norm(g?.id);
    if (!ID_RE.test(id) || ids.has(id)) continue;
    ids.add(id);
    groups.push({ id, kind: GROUP_KINDS.includes(g.kind) ? g.kind : "generic", label: text(g.label, 60), parent: norm(g.parent) || undefined });
  }
  const nodes = [];
  for (const n of (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 100)) {
    const id = norm(n?.id);
    if (!ID_RE.test(id) || ids.has(id)) continue;
    ids.add(id);
    const e = resolveService(n.service, cat);
    nodes.push({
      id, service: e ? e.slug : "generic", file: e ? e.file : null, color: e?.color || null,
      label: text(n.label, 60) || (e ? e.name : text(n.service, 40) || id), parent: norm(n.parent) || undefined,
    });
  }
  if (!nodes.length) return null;

  // parents must be existing groups, never the element itself, and the chain must not loop
  const groupIds = new Set(groups.map((g) => g.id));
  const parentOf = new Map(groups.map((g) => [g.id, g.parent]));
  const fix = (el) => {
    if (el.parent && (!groupIds.has(el.parent) || el.parent === el.id)) el.parent = undefined;
  };
  groups.forEach(fix);
  nodes.forEach(fix);
  for (const g of groups) {
    let cur = g.parent, hops = 0;
    while (cur && hops++ < 12) cur = parentOf.get(cur);
    if (hops > 12) g.parent = undefined;
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [];
  for (const e of (Array.isArray(raw.edges) ? raw.edges : []).slice(0, 200)) {
    const from = norm(e?.from), to = norm(e?.to);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue;
    const step = Number.isInteger(e.step) && e.step >= 1 && e.step <= 99 ? e.step : undefined;
    edges.push({ from, to, label: text(e.label, 40) || undefined, step, bidirectional: e.bidirectional === true || undefined });
  }
  return { title: text(raw.title, 80) || undefined, groups, nodes, edges };
}
