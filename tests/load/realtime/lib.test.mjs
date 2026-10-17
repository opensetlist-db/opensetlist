// node --test tests/load/realtime/lib.test.mjs
//
// Pins the two HTTP-target allow-lists the load tools share. The dev
// alias is the only target the probes and the observer accept; the
// browsers harness additionally accepts a deployment-specific preview
// URL behind --deployment-url (run.mjs), and that shape must never leak
// into the default allow-list because production deployments use it too.
import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedBaseUrl, isDeploymentBaseUrl } from "./lib.mjs";

test("isAllowedBaseUrl: localhost and the dev alias only", () => {
  assert.equal(isAllowedBaseUrl("http://localhost:3000"), true);
  assert.equal(isAllowedBaseUrl("https://opensetlist-git-dev-opensetlist-projects.vercel.app"), true);
  assert.equal(isAllowedBaseUrl("https://opensetlist-6xes4uqg9-opensetlist-projects.vercel.app"), false);
  assert.equal(isAllowedBaseUrl("https://opensetlist.com"), false);
  assert.equal(isAllowedBaseUrl("http://opensetlist-git-dev-opensetlist-projects.vercel.app"), false);
});

test("isDeploymentBaseUrl: one-off preview deployments of this project, https only", () => {
  assert.equal(isDeploymentBaseUrl("https://opensetlist-6xes4uqg9-opensetlist-projects.vercel.app"), true);
  assert.equal(isDeploymentBaseUrl("https://opensetlist-6xes4uqg9-opensetlist-projects.vercel.app/"), true);
  assert.equal(isDeploymentBaseUrl("http://opensetlist-6xes4uqg9-opensetlist-projects.vercel.app"), false);
  assert.equal(isDeploymentBaseUrl("https://opensetlist-git-dev-opensetlist-projects.vercel.app"), false);
  assert.equal(isDeploymentBaseUrl("https://opensetlist.com"), false);
  assert.equal(isDeploymentBaseUrl("https://other-6xes4uqg9-opensetlist-projects.vercel.app"), false);
  assert.equal(isDeploymentBaseUrl("https://opensetlist-6xes4uqg9-someone-else.vercel.app"), false);
  assert.equal(isDeploymentBaseUrl("not a url"), false);
});
