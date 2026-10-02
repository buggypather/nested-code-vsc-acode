import assert from "node:assert/strict";
import test from "node:test";
import { findEmbeddedRegions, tokenizeJson, tokenizeJsonc, tokenizeMarkup } from "./index.js";

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


test("tokenizes HTML tags, attributes, values, and text", () => {
  const source = '<div class="card" data-id=42>Hello <b>world</b></div>';
  const tokens = tokenizeMarkup(source);

  assert.deepEqual(
    tokens.filter((t) => t.kind === "tag").map((t) => source.slice(t.start, t.end)),
    ["div", "b", "b", "div"]
  );
  assert.deepEqual(
    tokens.filter((t) => t.kind === "attribute").map((t) => source.slice(t.start, t.end)),
    ["class", "data-id"]
  );
  assert.deepEqual(
    tokens.filter((t) => t.kind === "attributeValue").map((t) => source.slice(t.start, t.end)),
    ['"card"', "42"]
  );
});

test("tokenizes XML namespaces and self-closing elements", () => {
  const source = '<?xml version="1.0"?><svg:svg><svg:path d="M0 0"/></svg:svg>';
  const tokens = tokenizeMarkup(source);

  assert.equal(tokens[0].kind, "processingInstruction");
  assert.ok(tokens.some((t) => t.kind === "tag" && source.slice(t.start, t.end) === "svg:path"));
  assert.ok(tokens.some((t) => t.kind === "attribute" && source.slice(t.start, t.end) === "d"));
  assert.ok(tokens.some((t) => t.kind === "punctuation" && source.slice(t.start, t.end) === "/>"));
});

test("recognizes markup comments, CDATA, and doctypes", () => {
  const source = '<!DOCTYPE html><root><!-- note --><![CDATA[<not-a-tag>]]></root>';
  const tokens = tokenizeMarkup(source);

  assert.ok(tokens.some((t) => t.kind === "doctype"));
  assert.ok(tokens.some((t) => t.kind === "comment"));
  assert.ok(tokens.some((t) => t.kind === "cdata"));
  assert.equal(tokens.filter((t) => t.kind === "tag").length, 2);
});

test("markup token depth follows nested elements", () => {
  const source = "<a><b><c>x</c></b></a>";
  const tokens = tokenizeMarkup(source);
  const opens = tokens.filter((t) => t.kind === "tag").slice(0, 3);

  assert.deepEqual(opens.map((t) => t.depth), [0, 1, 2]);
});

test("tokenizes only markup slices around TypeScript interpolation", () => {
  const source = 'const page = `<section class="x"><h1>${user.name}</h1></section>`;';
  const regions = findEmbeddedRegions(source, "typescript");
  const markup = regions
    .filter((r) => r.kind === "markup")
    .flatMap((r) => tokenizeMarkup(source, r.start, r.end));

  assert.equal(regions.filter((r) => r.kind === "interpolation").length, 1);
  assert.ok(markup.some((t) => t.kind === "tag" && source.slice(t.start, t.end) === "section"));
  assert.equal(markup.some((t) => source.slice(t.start, t.end).includes("user.name")), false);
});

test("incomplete markup stays tokenizable while typing", () => {
  const source = '<div class="unfinished';
  const tokens = tokenizeMarkup(source);

  assert.ok(tokens.some((t) => t.kind === "tag"));
  assert.ok(tokens.some((t) => t.kind === "attribute"));
  assert.ok(tokens.some((t) => t.kind === "attributeValue"));
});
