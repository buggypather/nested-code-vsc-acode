import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeJson } from "./index.js";

test("tracks nested JSON properties and values", () => {
  const source = '{"user":{"settings":{"enabled":true}}}';
  const tokens = tokenizeJson(source);
  const properties = tokens.filter((t) => t.kind === "property");

  assert.equal(properties.length, 3);
  assert.deepEqual(properties.map((t) => t.depth), [1, 2, 3]);
  assert.equal(tokens.find((t) => t.kind === "boolean")?.depth, 3);
});

test("handles arrays, escaped strings, null, and numbers", () => {
  const source = '{"items":[{"text":"a\\\"b","value":12.5e2},null]}';
  const tokens = tokenizeJson(source);

  assert.ok(tokens.some((t) => t.kind === "string"));
  assert.ok(tokens.some((t) => t.kind === "number"));
  assert.ok(tokens.some((t) => t.kind === "null"));
});
