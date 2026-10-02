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


export type HostLanguage = "javascript" | "typescript";

export type EmbeddedRegionKind = "string" | "markup" | "interpolation";

export interface EmbeddedRegion {
  kind: EmbeddedRegionKind;
  start: number;
  end: number;
  hostLanguage: HostLanguage;
}

function skipQuotedHostString(source: string, start: number, quote: "'" | '"'): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i = Math.min(i + 2, source.length);
      continue;
    }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return source.length;
}

function skipHostComment(source: string, start: number): number {
  if (source[start + 1] === "/") return scanLineComment(source, start);
  return scanBlockComment(source, start);
}

function scanInterpolation(source: string, start: number): number {
  let depth = 1;
  let i = start + 2;

  while (i < source.length && depth > 0) {
    const ch = source[i];

    if (ch === "'" || ch === '"') {
      i = skipQuotedHostString(source, i, ch);
      continue;
    }

    if (ch === "`") {
      i = scanTemplateLiteralEnd(source, i);
      continue;
    }

    if (ch === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
      i = skipHostComment(source, i);
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }

  return i;
}

function scanTemplateLiteralEnd(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i = Math.min(i + 2, source.length);
      continue;
    }
    if (source[i] === "`") return i + 1;
    if (source[i] === "$" && source[i + 1] === "{") {
      i = scanInterpolation(source, i);
      continue;
    }
    i++;
  }
  return source.length;
}

function looksLikeMarkup(text: string): boolean {
  // Conservative on purpose: require a tag-like opener rather than treating
  // comparison operators or generic angle brackets as markup.
  return /<\s*(?:[A-Za-z][\w:.-]*|!DOCTYPE|!--|\?xml)(?:\s|\/?>)/i.test(text);
}

function addTemplateContentRegions(
  source: string,
  start: number,
  end: number,
  language: HostLanguage,
  output: EmbeddedRegion[]
): void {
  let segmentStart = start + 1;
  let i = segmentStart;

  while (i < end) {
    if (source[i] === "\\") {
      i = Math.min(i + 2, end);
      continue;
    }

    if (source[i] === "$" && source[i + 1] === "{") {
      if (i > segmentStart) {
        const text = source.slice(segmentStart, i);
        output.push({
          kind: looksLikeMarkup(text) ? "markup" : "string",
          start: segmentStart,
          end: i,
          hostLanguage: language
        });
      }
      const interpolationEnd = scanInterpolation(source, i);
      output.push({
        kind: "interpolation",
        start: i,
        end: Math.min(interpolationEnd, end),
        hostLanguage: language
      });
      segmentStart = Math.min(interpolationEnd, end);
      i = segmentStart;
      continue;
    }

    if (source[i] === "`") break;
    i++;
  }

  if (i > segmentStart) {
    const text = source.slice(segmentStart, i);
    output.push({
      kind: looksLikeMarkup(text) ? "markup" : "string",
      start: segmentStart,
      end: i,
      hostLanguage: language
    });
  }
}

export function findEmbeddedRegions(
  source: string,
  language: HostLanguage
): EmbeddedRegion[] {
  const regions: EmbeddedRegion[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
      i = skipHostComment(source, i);
      continue;
    }

    if (ch === "'" || ch === '"') {
      const end = skipQuotedHostString(source, i, ch);
      const contentEnd = end <= source.length && source[end - 1] === ch ? end - 1 : end;
      const text = source.slice(i + 1, contentEnd);
      regions.push({
        kind: looksLikeMarkup(text) ? "markup" : "string",
        start: i + 1,
        end: contentEnd,
        hostLanguage: language
      });
      i = end;
      continue;
    }

    if (ch === "`") {
      const end = scanTemplateLiteralEnd(source, i);
      addTemplateContentRegions(source, i, end, language, regions);
      i = end;
      continue;
    }

    i++;
  }

  return regions;
}
