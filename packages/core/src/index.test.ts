import assert from "node:assert/strict";
import test from "node:test";
import { findEmbeddedRegions, tokenizeJson, tokenizeJsonc } from "./index.js";

test("tracks deeply nested JSON properties and values", () => {
  const source = '{"user":{"settings":{"editor":{"enabled":true}}}}';
  const tokens = tokenizeJson(source);
  const properties = tokens.filter((t) => t.kind === "property");

  assert.equal(properties.length, 4);
  assert.deepEqual(properties.map((t) => t.depth), [1, 2, 3, 4]);
  assert.equal(tokens.find((t) => t.kind === "boolean")?.depth, 4);
});

test("handles arrays, escaped strings, null, and JSON numbers", () => {
  const source = '{"items":[{"text":"a\\\"b","values":[0,-1,12.5e2]},null]}';
  const tokens = tokenizeJson(source);

  assert.ok(tokens.some((t) => t.kind === "string"));
  assert.equal(tokens.filter((t) => t.kind === "number").length, 3);
  assert.ok(tokens.some((t) => t.kind === "null"));
  assert.equal(tokens.filter((t) => t.kind === "invalid").length, 0);
});

test("JSONC recognizes line and block comments at their nesting depth", () => {
  const source = '{// root\n"a":{/* nested */"b":1}}';
  const comments = tokenizeJsonc(source).filter((t) => t.kind === "comment");

  assert.equal(comments.length, 2);
  assert.deepEqual(comments.map((t) => t.depth), [1, 2]);
});

test("plain JSON does not accept comments as comments", () => {
  const tokens = tokenizeJson('{"a":// nope\n1}');
  assert.equal(tokens.some((t) => t.kind === "comment"), false);
  assert.ok(tokens.some((t) => t.kind === "invalid"));
});

test("unterminated strings are marked invalid without throwing", () => {
  const source = '{"a":"unfinished';
  const tokens = tokenizeJson(source);
  const last = tokens.at(-1);

  assert.equal(last?.kind, "invalid");
  assert.equal(last?.end, source.length);
});

test("unterminated JSONC block comments remain highlightable", () => {
  const source = '{"a":1, /* still typing';
  const comments = tokenizeJsonc(source).filter((t) => t.kind === "comment");

  assert.equal(comments.length, 1);
  assert.equal(comments[0].end, source.length);
});

test("mismatched closing brackets are invalid and scanning continues", () => {
  const source = '{"a":[1},2]}';
  const tokens = tokenizeJson(source);

  assert.ok(tokens.some((t) => t.kind === "invalid"));
  assert.equal(tokens.filter((t) => t.kind === "number").length, 2);
});

test("invalid literals are grouped so later structure can recover", () => {
  const source = '{"a":truthy,"b":2}';
  const tokens = tokenizeJson(source);

  assert.ok(tokens.some((t) => t.kind === "invalid"));
  assert.ok(tokens.some((t) => t.kind === "property" && source.slice(t.start, t.end) === '"b"'));
  assert.ok(tokens.some((t) => t.kind === "number"));
});

test("very deep nesting preserves depth rather than imposing a parser limit", () => {
  const depth = 128;
  const source = "[".repeat(depth) + "0" + "]".repeat(depth);
  const number = tokenizeJson(source).find((t) => t.kind === "number");

  assert.equal(number?.depth, depth);
});


test("detects HTML inside a TypeScript template literal", () => {
  const source = 'const page = `<div class="card"><h1>Hello</h1></div>`;';
  const regions = findEmbeddedRegions(source, "typescript");

  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "markup");
  assert.equal(source.slice(regions[0].start, regions[0].end), '<div class="card"><h1>Hello</h1></div>');
});

test("template interpolation returns to host language and then markup", () => {
  const source = 'const page = `<h1>${user.name}</h1>`;';
  const regions = findEmbeddedRegions(source, "typescript");

  assert.deepEqual(regions.map((r) => r.kind), ["markup", "interpolation", "markup"]);
  assert.equal(source.slice(regions[1].start, regions[1].end), "${user.name}");
});

test("nested braces and strings inside interpolation do not terminate it early", () => {
  const source = 'const x = `<p>${format({value: "}"})}</p>`;';
  const regions = findEmbeddedRegions(source, "javascript");
  const interpolation = regions.find((r) => r.kind === "interpolation");

  assert.equal(source.slice(interpolation!.start, interpolation!.end), '${format({value: "}"})}');
});

test("ordinary strings and less-than comparisons are not classified as markup", () => {
  const source = 'const a = "hello"; const b = `value: ${x < 10}`;';
  const regions = findEmbeddedRegions(source, "javascript");

  assert.equal(regions.some((r) => r.kind === "markup"), false);
});

test("HTML in a normal quoted JavaScript string is detected", () => {
  const source = "const x = '<span>hello</span>';";
  const regions = findEmbeddedRegions(source, "javascript");

  assert.equal(regions[0].kind, "markup");
});

test("host comments containing fake markup strings are ignored", () => {
  const source = '// const x = "<fake></fake>"\nconst y = "plain";';
  const regions = findEmbeddedRegions(source, "javascript");

  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "string");
});

test("unterminated template literals remain recoverable", () => {
  const source = 'const x = `<section>still typing';
  const regions = findEmbeddedRegions(source, "typescript");

  assert.equal(regions[0].kind, "markup");
  assert.equal(regions[0].end, source.length);
});
