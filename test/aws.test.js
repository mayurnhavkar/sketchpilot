import { test } from "node:test";
import assert from "node:assert/strict";
import { ALIASES, GROUP_KINDS, awsAddendum, catalogText, makeCatalog, resolveService, sanitizeAws } from "../server/aws.js";
import { buildSystem, buildUser, sanitizeReply } from "../server/prompt.js";

const index = {
  version: "t",
  services: [
    { slug: "lambda", name: "AWS Lambda", category: "compute", color: "#ED7100", file: "services/lambda.svg" },
    { slug: "ec2", name: "Amazon EC2", category: "compute", color: "#ED7100", file: "services/ec2.svg" },
    { slug: "dynamodb", name: "Amazon DynamoDB", category: "databases", color: "#C925D1", file: "services/dynamodb.svg" },
    { slug: "api-gateway", name: "Amazon API Gateway", category: "networking", color: "#8C4FFF", file: "services/api-gateway.svg" },
    { slug: "simple-storage-service", name: "Amazon Simple Storage Service", category: "storage", color: "#7AA116", file: "services/simple-storage-service.svg" },
    { slug: "key-management-service", name: "AWS Key Management Service", category: "security", color: "#DD344C", file: "services/key-management-service.svg" },
    { slug: "elastic-load-balancing", name: "Elastic Load Balancing", category: "networking", color: "#8C4FFF", file: "services/elastic-load-balancing.svg" },
  ],
  resources: [
    { slug: "user", name: "User", file: "resources/user.svg" },
    { slug: "application-load-balancer", name: "Application Load Balancer", file: "resources/application-load-balancer.svg" },
  ],
  groups: [],
};
const cat = makeCatalog(index);

test("resolveService: exact, alias, prefix, flattened and unique-prefix matches; unknown is null", () => {
  assert.equal(resolveService("lambda", cat).slug, "lambda");
  assert.equal(resolveService("AWS Lambda", cat).slug, "lambda");
  assert.equal(resolveService("amazon-ec2", cat).slug, "ec2");
  assert.equal(resolveService("S3", cat).slug, "simple-storage-service");
  assert.equal(resolveService("kms", cat).slug, "key-management-service");
  assert.equal(resolveService("alb", cat).slug, "application-load-balancer"); // a resource icon
  assert.equal(resolveService("apigateway", cat).slug, "api-gateway");
  assert.equal(resolveService("dynamo", cat).slug, "dynamodb");
  assert.equal(resolveService("simple-storage", cat).slug, "simple-storage-service"); // unique prefix
  assert.equal(resolveService("quantum-toaster", cat), null);
  assert.equal(resolveService(42, cat), null);
  assert.equal(resolveService("", cat), null);
});

test("every alias points at something real in the shipped vocabulary (spot check against test index)", () => {
  for (const k of ["s3", "kms", "alb", "dynamo"]) assert.ok(resolveService(k, cat), k);
  assert.ok(Object.keys(ALIASES).length > 30);
});

const raw = () => ({
  title: "  Demo  ",
  groups: [
    { id: "Cloud", kind: "aws-cloud", label: "AWS Cloud" },
    { id: "vpc", kind: "vpc", label: "VPC", parent: "cloud" },
    { id: "pub", kind: "public-subnet", parent: "vpc" },
    { id: "weird", kind: "spaceship", parent: "nope" },
  ],
  nodes: [
    { id: "user", service: "user", label: "Users" },
    { id: "api", service: "API Gateway", parent: "cloud" },
    { id: "fn", service: "lambda", label: "Orders handler", parent: "pub" },
    { id: "thing", service: "made-up-service", label: "Custom box", parent: "vpc" },
  ],
  edges: [
    { from: "user", to: "api", label: "HTTPS", step: 1 },
    { from: "api", to: "fn", step: 2.5 },
    { from: "fn", to: "ghost" },
    { from: "fn", to: "fn" },
    { from: "fn", to: "thing", bidirectional: true },
  ],
});

test("sanitizeAws normalises ids, resolves services, falls back to generic, fixes bad parents and kinds", () => {
  const a = sanitizeAws(raw(), index);
  assert.equal(a.title, "Demo");
  assert.deepEqual(a.groups.map((g) => g.id), ["cloud", "vpc", "pub", "weird"]);
  assert.equal(a.groups.find((g) => g.id === "weird").kind, "generic");
  assert.equal(a.groups.find((g) => g.id === "weird").parent, undefined); // parent does not exist
  assert.equal(a.nodes.find((n) => n.id === "api").service, "api-gateway");
  assert.equal(a.nodes.find((n) => n.id === "api").label, "Amazon API Gateway"); // label defaults to the icon's name
  assert.equal(a.nodes.find((n) => n.id === "api").file, "services/api-gateway.svg");
  const generic = a.nodes.find((n) => n.id === "thing");
  assert.equal(generic.service, "generic");
  assert.equal(generic.file, null);
  assert.equal(generic.label, "Custom box");
});

test("sanitizeAws keeps only edges between real, different nodes; steps must be integers", () => {
  const a = sanitizeAws(raw(), index);
  assert.deepEqual(a.edges.map((e) => `${e.from}>${e.to}`), ["user>api", "api>fn", "fn>thing"]);
  assert.equal(a.edges[0].step, 1);
  assert.equal(a.edges[1].step, undefined); // 2.5 is not a step
  assert.equal(a.edges[2].bidirectional, true);
});

test("sanitizeAws breaks parent cycles, drops duplicate ids, and needs at least one node", () => {
  const cyc = sanitizeAws({ groups: [{ id: "a", kind: "vpc", parent: "b" }, { id: "b", kind: "vpc", parent: "a" }], nodes: [{ id: "n", service: "ec2", parent: "a" }, { id: "n", service: "ec2" }] }, index);
  assert.equal(cyc.nodes.length, 1);
  const parents = new Map(cyc.groups.map((g) => [g.id, g.parent]));
  assert.ok(parents.get("a") === undefined || parents.get("b") === undefined, "cycle broken");
  assert.equal(sanitizeAws({ groups: [], nodes: [] }, index), null);
  assert.equal(sanitizeAws(null, index), null);
  assert.equal(sanitizeAws(raw(), null), null);
});

test("sanitizeAws caps sizes", () => {
  const many = { nodes: Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, service: "ec2" })) };
  assert.equal(sanitizeAws(many, index).nodes.length, 100);
});

test("the prompt addendum lists every group kind and the catalog; only added when the index is given", () => {
  const add = awsAddendum(index);
  for (const k of GROUP_KINDS) assert.ok(add.includes(k), k);
  assert.match(add, /NEVER give coordinates/);
  assert.match(catalogText(index), /compute: lambda, ec2/);
  assert.match(catalogText(index), /resources and generic.*user/);
  assert.ok(!buildSystem({}).includes("AWS ARCHITECTURE MODE"));
  assert.ok(buildSystem({ awsIndex: index }).includes("AWS ARCHITECTURE MODE"));
});

test("sanitizeReply: aws only counts when an index is supplied, and satisfies the 'usable' check", () => {
  const parsed = { aws: raw() };
  assert.throws(() => sanitizeReply(parsed, []), /nothing usable/);
  const r = sanitizeReply(parsed, [], { awsIndex: index });
  assert.equal(r.aws.nodes.length, 4);
  assert.throws(() => sanitizeReply({ aws: { nodes: [] } }, [], { awsIndex: index }), /nothing usable/);
});

test("buildUser passes the current AWS spec when editing a diagram", () => {
  const u = buildUser({ prompt: "add a cache", awsSpec: '{"nodes":[]}' });
  assert.match(u, /COMPLETE updated "aws" spec/);
  assert.match(u, /\{"nodes":\[\]\}/);
  assert.ok(!buildUser({ prompt: "x" }).includes("Current AWS diagram"));
});
