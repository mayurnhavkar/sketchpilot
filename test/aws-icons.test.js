import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { buildIndex, discoverUrl, FALLBACK_URL, installIcons, kebab, parsePackage, readIndex, svgIsSafe } from "../server/aws-icons.js";

const svg = (body = "", fill = "#ED7100") =>
  `<svg viewBox="0 0 80 80"><g id="Icon-Architecture-BG/64/Compute" fill="${fill}"><rect/></g>${body}</svg>`;
const pkg = (extra = {}) =>
  zipSync({
    "Architecture-Service-Icons_07312026/Arch_Compute/64/Arch_AWS-Lambda_64.svg": strToU8(svg()),
    "Architecture-Service-Icons_07312026/Arch_Databases/64/Arch_Amazon-DynamoDB_64.svg": strToU8(svg("", "#C925D1")),
    "Architecture-Service-Icons_07312026/Arch_Networking-Content-Delivery/64/Arch_Amazon-CloudFront_64.svg": strToU8(svg()),
    "Architecture-Service-Icons_07312026/Arch_General-Icons/64/Arch_AWS-Marketplace_Light_64.svg": strToU8(svg()),
    "Architecture-Service-Icons_07312026/Arch_General-Icons/64/Arch_AWS-Marketplace_Dark_64.svg": strToU8(svg()),
    "Architecture-Service-Icons_07312026/Arch_Compute/32/Arch_AWS-Lambda_32.svg": strToU8(svg()), // wrong size: ignored
    "Architecture-Group-Icons_07312026/Virtual-private-cloud-VPC_32.svg": strToU8(svg()),
    "Architecture-Group-Icons_07312026/AWS-Cloud_32.svg": strToU8(svg()),
    "Resource-Icons_07312026/Res_Networking-Content-Delivery/Res_Amazon-VPC_NAT-Gateway_48.svg": strToU8(svg()),
    "Resource-Icons_07312026/Res_Compute/Res_Amazon-EC2_Instance_48.svg": strToU8(svg()),
    "Resource-Icons_07312026/Res_Databases/Res_Amazon-RDS_Instance_48.svg": strToU8(svg()),
    "Resource-Icons_07312026/Res_General-Icons/Res_48_Light/Res_User_48_Light.svg": strToU8(svg()),
    "Resource-Icons_07312026/Res_General-Icons/Res_48_Dark/Res_User_48_Dark.svg": strToU8(svg()),
    "__MACOSX/Architecture-Service-Icons_07312026/Arch_Compute/64/Arch_Junk_64.svg": strToU8(svg()),
    ...extra,
  });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ec-aws-"));

test("kebab keeps CamelCase names whole: DynamoDB, CloudFront", () => {
  assert.equal(kebab("Amazon-DynamoDB"), "amazon-dynamodb");
  assert.equal(kebab("Virtual private cloud (VPC)"), "virtual-private-cloud-vpc");
});

test("svgIsSafe refuses anything active", () => {
  assert.ok(svgIsSafe(svg()));
  assert.ok(svgIsSafe('<svg><use href="#local"/></svg>'));
  for (const bad of ["<svg><script>alert(1)</script></svg>", '<svg onload="x()"/>', '<svg><foreignObject/></svg>', '<svg><a href="https://evil.example"/></svg>', '<svg><image xlink:href="http://x"/></svg>', "<!DOCTYPE svg [<!ENTITY x 'y'>]><svg/>"]) {
    assert.ok(!svgIsSafe(bad), bad);
  }
});

test("parsePackage picks service@64, groups@32 and resources, skipping Dark variants, __MACOSX and other sizes", () => {
  const files = Object.fromEntries(Object.entries(unzipAll(pkg())));
  const p = parsePackage(files);
  const kinds = (k) => p.filter((x) => x.kind === k).map((x) => x.raw).sort();
  assert.deepEqual(kinds("service"), ["AWS-Lambda", "AWS-Marketplace", "Amazon-CloudFront", "Amazon-DynamoDB"]);
  assert.deepEqual(kinds("group"), ["AWS-Cloud", "Virtual-private-cloud-VPC"]);
  assert.deepEqual(kinds("resource"), ["Amazon-EC2_Instance", "Amazon-RDS_Instance", "Amazon-VPC_NAT-Gateway", "User"]);
  assert.equal(p.find((x) => x.raw === "Amazon-DynamoDB").color, "#C925D1");
});

import { unzipSync, strFromU8 } from "fflate";
function unzipAll(buf) {
  return unzipSync(buf);
}

test("unsafe icons in the package are skipped, not installed", () => {
  const bad = zipSync({ "Architecture-Service-Icons_07312026/Arch_Compute/64/Arch_AWS-Evil_64.svg": strToU8("<svg onload='x()'/>"), "Architecture-Service-Icons_07312026/Arch_Compute/64/Arch_AWS-Lambda_64.svg": strToU8(svg()) });
  const p = parsePackage(unzipSync(bad));
  assert.deepEqual(p.map((x) => x.raw), ["AWS-Lambda"]);
});

test("buildIndex: short slugs, resource collisions get their service as a prefix, category colours kept", () => {
  const { index, files } = buildIndex(parsePackage(unzipAll(pkg())), "07312026");
  const slugs = (l) => l.map((x) => x.slug);
  assert.deepEqual(slugs(index.services), ["cloudfront", "dynamodb", "lambda", "marketplace"]);
  assert.deepEqual(slugs(index.groups), ["aws-cloud", "vpc"]);
  assert.ok(slugs(index.resources).includes("nat-gateway"));
  assert.ok(slugs(index.resources).includes("user"));
  // "instance" exists for both EC2 and RDS -> disambiguated
  assert.ok(slugs(index.resources).includes("ec2-instance") && slugs(index.resources).includes("rds-instance"));
  assert.equal(index.services.find((s) => s.slug === "dynamodb").color, "#C925D1");
  assert.equal(index.services.find((s) => s.slug === "lambda").category, "compute");
  assert.ok(files.has("services/lambda.svg") && files.has("groups/vpc.svg") && files.has("resources/nat-gateway.svg"));
  assert.equal(index.version, "07312026");
});

test("installIcons writes files + index atomically from a local zip, and replaces an older install", async () => {
  const dir = tmp();
  const zip = path.join(tmp(), "pkg.zip");
  fs.writeFileSync(zip, pkg());
  const out = path.join(dir, "aws-icons");
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, "stale.txt"), "old");
  const logs = [];
  const r = await installIcons({ outDir: out, zip, log: (m) => logs.push(m) });
  assert.deepEqual([r.services, r.groups, r.version], [4, 2, "07312026"]);
  assert.ok(fs.existsSync(path.join(out, "services", "lambda.svg")));
  assert.ok(!fs.existsSync(path.join(out, "stale.txt")));
  assert.equal(readIndex(out).services.length, 4);
  assert.ok(!fs.readdirSync(dir).some((f) => f.includes(".tmp-")), "no temp folder left behind");
});

test("installIcons rejects a zip that is not the AWS package, and downloads only from AWS's host over https", async () => {
  const zip = path.join(tmp(), "junk.zip");
  fs.writeFileSync(zip, zipSync({ "readme.txt": strToU8("hi") }));
  await assert.rejects(installIcons({ outDir: path.join(tmp(), "x"), zip }), /no service icons/);
  await assert.rejects(installIcons({ outDir: path.join(tmp(), "x"), url: "https://evil.example/icons.zip" }), /refusing to download/);
  await assert.rejects(installIcons({ outDir: path.join(tmp(), "x"), url: "http://d1.awsstatic.com/x.zip" }), /refusing to download/);
});

test("discoverUrl finds the current zip on AWS's page, and falls back when the page is unreachable", async () => {
  const link = "https://d1.awsstatic.com/onedam/x/Icon-package_01312027.abc123.zip";
  assert.equal(await discoverUrl(async () => ({ text: async () => `<a href="${link}">Icon package</a>` })), link);
  assert.equal(await discoverUrl(async () => ({ text: async () => "<html>no link</html>" })), FALLBACK_URL);
  assert.equal(await discoverUrl(async () => { throw new Error("offline"); }), FALLBACK_URL);
  assert.equal(readIndex(path.join(tmp(), "missing")), null);
});
