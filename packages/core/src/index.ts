export type TokenKind =
  | "property"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation";

export interface NestedToken {
  kind: TokenKind;
  start: number;
  end: number;
  depth: number;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function scanString(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === '"') return i + 1;
    i++;
  }
  return source.length;
}

export function tokenizeJson(source: string): NestedToken[] {
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

    if (ch === "{" || ch === "[") {
      tokens.push({ kind: "punctuation", start: i, end: i + 1, depth: stack.length });
      stack.push(ch === "{" ? "object" : "array");
      expectingProperty = ch === "{";
      i++;
      continue;
    }

    if (ch === "}" || ch === "]") {
      stack.pop();
      tokens.push({ kind: "punctuation", start: i, end: i + 1, depth: stack.length });
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
      const end = scanString(source, i);
      const kind: TokenKind =
        expectingProperty && stack.at(-1) === "object" ? "property" : "string";
      tokens.push({ kind, start: i, end, depth: stack.length });
      expectingProperty = false;
      i = end;
      continue;
    }

    const literal = /^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
    if (literal) {
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

    // Error recovery: skip an unknown character and continue tokenizing.
    i++;
  }

  return tokens;
}
