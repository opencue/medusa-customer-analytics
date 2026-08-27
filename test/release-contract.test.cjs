"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "release.yml"),
  "utf8",
);

test("package metadata matches the canonical customer analytics repository", () => {
  assert.equal(pkg.version, "0.3.0");
  assert.equal(
    pkg.repository.url,
    "git+https://github.com/opencue/medusa-customer-analytics.git",
  );
});

test("release workflow uses tokenless npm trusted publishing", () => {
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /environment:\s*npm/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /package-manager-cache:\s*false/);
  assert.match(workflow, /npm publish --access public/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
});
