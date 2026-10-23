"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
test("the authorization-link release manifest and dependency lock agree on version 0.2.1", () => {
  const manifest = require("../package.json");
  const lock = require("../package-lock.json");
  assert.equal(manifest.version, "0.2.1");
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[""].version, manifest.version);
});
