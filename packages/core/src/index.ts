export type TokenKind =
  | "property"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "comment"
  | "punctuation"
  | "invalid";

export interface NestedToken {
  kind: TokenKind;
  start: number;
  end: number;
  depth: number;
}

export interface JsonTokenizeOptions {
  allowComments?: boolean;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function scanString(source: string, start: number): { end: number; closed: boolean } {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      // Keep an incomplete trailing escape inside the string token.
      i = Math.min(i + 2, source.length);
      continue;
    }
    if (source[i] === '"') return { end: i + 1, closed: true };
    i++;
  }
  return { end: source.length, closed: false };
}

function scanLineComment(source: string, start: number): number {
  let i = start + 2;
  while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
  return i;
}

function scanBlockComment(source: string, start: number): number {
  const close = source.indexOf("*/", start + 2);
  return close === -1 ? source.length : close + 2;
}

function isLiteralBoundary(ch: string | undefined): boolean {
  return ch === undefined || isWhitespace(ch) || ch === "," || ch === "]" || ch === "}";
}

export function tokenizeJson(
  source: string,
  options: JsonTokenizeOptions = {}
): NestedToken[] {
  const tokens: NestedToken[] = [];
  const stack: Array<"object" | "array"> = [];
  let expectingProperty = false;
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    if (options.allowComments && ch === "/" && source[i + 1] === "/") {
      const end = scanLineComment(source, i);
      tokens.push({ kind: "comment", start: i, end, depth: stack.length });
      i = end;
      continue;
    }

    if (options.allowComments && ch === "/" && source[i + 1] === "*") {
      const end = scanBlockComment(source, i);
      tokens.push({ kind: "comment", start: i, end, depth: stack.length });
      i = end;
      continue;
    }

    if (ch === "{" || ch === "[") {
      tokens.push({ kind: "punctuation", start: i, end: i + 1, depth: stack.length });
      stack.push(ch === "{" ? "object" : "array");
      expectingProperty = ch === "{";
      i++;
      continue;
    }

    if (ch === "}" || ch === "]") {
      const expected = ch === "}" ? "object" : "array";
      const valid = stack.at(-1) === expected;
      if (valid) stack.pop();
      tokens.push({
        kind: valid ? "punctuation" : "invalid",
        start: i,
        end: i + 1,
        depth: stack.length
      });
      expectingProperty = false;
      i++;
      continue;
    }

    if (ch === "," || ch === ":") {
      tokens.push({ kind: "punctuation", start: i, end: i + 1, depth: stack.length });
      expectingProperty = ch === "," && stack.at(-1) === "object";
      i++;
      continue;
    }

    if (ch === '"') {
      const scanned = scanString(source, i);
      const kind: TokenKind =
        expectingProperty && stack.at(-1) === "object" ? "property" : "string";
      tokens.push({
        kind: scanned.closed ? kind : "invalid",
        start: i,
        end: scanned.end,
        depth: stack.length
      });
      expectingProperty = false;
      i = scanned.end;
      continue;
    }

    const literal = /^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
    if (literal && isLiteralBoundary(source[i + literal[0].length])) {
      const value = literal[0];
      const kind: TokenKind =
        value === "true" || value === "false"
          ? "boolean"
          : value === "null"
            ? "null"
            : "number";
      tokens.push({ kind, start: i, end: i + value.length, depth: stack.length });
      i += value.length;
      continue;
    }

    // Error recovery groups bad input until the next structural boundary so
    // highlighting after an incomplete edit can resume instead of collapsing.
    const start = i;
    i++;
    while (
      i < source.length &&
      !isWhitespace(source[i]) &&
      !",:{}[]".includes(source[i]) &&
      source[i] !== '"'
    ) i++;
    tokens.push({ kind: "invalid", start, end: i, depth: stack.length });
  }

  return tokens;
}

export function tokenizeJsonc(source: string): NestedToken[] {
  return tokenizeJson(source, { allowComments: true });
}
