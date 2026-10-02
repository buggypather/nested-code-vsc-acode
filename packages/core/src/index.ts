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

    const nextBacktick = source.indexOf("`", i);
    const nextInterpolation = source.indexOf("${", i);
    const nextScript = source.toLowerCase().indexOf("<script", i);

    // If an embedded <script> starts before the next host-template delimiter,
    // consume that entire script block as nested content. Its JavaScript
    // backticks belong to the child language, not this template.
    const nextDelimiterCandidates = [
      nextBacktick === -1 ? source.length : nextBacktick,
      nextInterpolation === -1 ? source.length : nextInterpolation
    ];
    const nextDelimiter = Math.min(...nextDelimiterCandidates);

    if (nextScript !== -1 && nextScript < nextDelimiter) {
      const openEnd = source.indexOf(">", nextScript + 7);
      if (openEnd === -1) return source.length;

      const close = findRecursiveBlockClose(
        source,
        openEnd + 1,
        source.length,
        "script"
      );
      if (close >= source.length) return source.length;

      const closeEnd = source.indexOf(">", close + 2);
      i = closeEnd === -1 ? source.length : closeEnd + 1;
      continue;
    }

    if (nextBacktick === i) return i + 1;

    if (nextInterpolation === i) {
      i = scanInterpolation(source, i);
      continue;
    }

    i++;
  }

  return source.length;
}

function looksLikeMarkup(text: string): boolean {
  // Recognize opening and closing tag fragments. Template interpolation can
  // split one markup document so a continuation may begin with </tag>.
  // Requiring a valid name keeps comparisons such as x < 10 out.
  return /<\s*\/?\s*(?:[A-Za-z][\w:.-]*|!DOCTYPE|!--|\?xml)(?:\s|\/?>)/i.test(text);
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


export type MarkupTokenKind =
  | "tag"
  | "attribute"
  | "attributeValue"
  | "text"
  | "comment"
  | "doctype"
  | "processingInstruction"
  | "cdata"
  | "punctuation"
  | "invalid";

export interface MarkupToken {
  kind: MarkupTokenKind;
  start: number;
  end: number;
  depth: number;
}

function isMarkupNameStart(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z_:]/.test(ch);
}

function isMarkupNameChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_:.-]/.test(ch);
}

function scanMarkupName(source: string, start: number, limit: number): number {
  let i = start;
  if (!isMarkupNameStart(source[i])) return i;
  i++;
  while (i < limit && isMarkupNameChar(source[i])) i++;
  return i;
}

function skipMarkupWhitespace(source: string, start: number, limit: number): number {
  let i = start;
  while (i < limit && isWhitespace(source[i])) i++;
  return i;
}

export function tokenizeMarkup(
  source: string,
  start = 0,
  end = source.length
): MarkupToken[] {
  const tokens: MarkupToken[] = [];
  const tagStack: string[] = [];
  let i = Math.max(0, start);
  const limit = Math.min(source.length, Math.max(i, end));

  while (i < limit) {
    if (source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      const tokenEnd = close === -1 || close + 3 > limit ? limit : close + 3;
      tokens.push({ kind: "comment", start: i, end: tokenEnd, depth: tagStack.length });
      i = tokenEnd;
      continue;
    }

    if (source.startsWith("<![CDATA[", i)) {
      const close = source.indexOf("]]>", i + 9);
      const tokenEnd = close === -1 || close + 3 > limit ? limit : close + 3;
      tokens.push({ kind: "cdata", start: i, end: tokenEnd, depth: tagStack.length });
      i = tokenEnd;
      continue;
    }

    if (/^<!DOCTYPE(?:\s|>)/i.test(source.slice(i, limit))) {
      const close = source.indexOf(">", i + 2);
      const tokenEnd = close === -1 || close + 1 > limit ? limit : close + 1;
      tokens.push({ kind: "doctype", start: i, end: tokenEnd, depth: tagStack.length });
      i = tokenEnd;
      continue;
    }

    if (source.startsWith("<?", i)) {
      const close = source.indexOf("?>", i + 2);
      const tokenEnd = close === -1 || close + 2 > limit ? limit : close + 2;
      tokens.push({
        kind: "processingInstruction",
        start: i,
        end: tokenEnd,
        depth: tagStack.length
      });
      i = tokenEnd;
      continue;
    }

    if (source[i] !== "<") {
      const textStart = i;
      const next = source.indexOf("<", i);
      i = next === -1 || next > limit ? limit : next;
      if (i > textStart) {
        tokens.push({ kind: "text", start: textStart, end: i, depth: tagStack.length });
      }
      continue;
    }

    const tagStart = i;
    const closing = source[i + 1] === "/";
    tokens.push({ kind: "punctuation", start: i, end: i + (closing ? 2 : 1), depth: tagStack.length });
    i += closing ? 2 : 1;
    i = skipMarkupWhitespace(source, i, limit);

    const nameStart = i;
    const nameEnd = scanMarkupName(source, i, limit);
    if (nameEnd === nameStart) {
      tokens.push({ kind: "invalid", start: tagStart, end: Math.min(tagStart + 1, limit), depth: tagStack.length });
      i = Math.max(i, tagStart + 1);
      continue;
    }

    const tagName = source.slice(nameStart, nameEnd);
    const normalizedName = tagName.toLowerCase();
    const tagDepth = closing ? Math.max(0, tagStack.length - 1) : tagStack.length;
    tokens.push({ kind: "tag", start: nameStart, end: nameEnd, depth: tagDepth });
    i = nameEnd;

    if (closing) {
      i = skipMarkupWhitespace(source, i, limit);
      if (source[i] === ">") {
        tokens.push({ kind: "punctuation", start: i, end: i + 1, depth: tagDepth });
        i++;
      }
      if (tagStack.at(-1)?.toLowerCase() === normalizedName) {
        tagStack.pop();
      } else {
        const match = tagStack.map((name) => name.toLowerCase()).lastIndexOf(normalizedName);
        if (match !== -1) tagStack.splice(match);
      }
      continue;
    }

    let selfClosing = false;
    while (i < limit) {
      i = skipMarkupWhitespace(source, i, limit);

      if (source.startsWith("/>", i)) {
        tokens.push({ kind: "punctuation", start: i, end: i + 2, depth: tagStack.length });
        i += 2;
        selfClosing = true;
        break;
      }

      if (source[i] === ">") {
        tokens.push({ kind: "punctuation", start: i, end: i + 1, depth: tagStack.length });
        i++;
        break;
      }

      const attrStart = i;
      const attrEnd = scanMarkupName(source, i, limit);
      if (attrEnd === attrStart) {
        tokens.push({ kind: "invalid", start: i, end: Math.min(i + 1, limit), depth: tagStack.length });
        i++;
        continue;
      }

      tokens.push({ kind: "attribute", start: attrStart, end: attrEnd, depth: tagStack.length });
      i = skipMarkupWhitespace(source, attrEnd, limit);

      if (source[i] !== "=") continue;
      tokens.push({ kind: "punctuation", start: i, end: i + 1, depth: tagStack.length });
      i++;
      i = skipMarkupWhitespace(source, i, limit);

      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const valueStart = i;
        i++;
        while (i < limit && source[i] !== quote) i++;
        if (i < limit) i++;
        tokens.push({ kind: "attributeValue", start: valueStart, end: i, depth: tagStack.length });
      } else {
        const valueStart = i;
        while (
          i < limit &&
          !isWhitespace(source[i]) &&
          source[i] !== ">" &&
          !source.startsWith("/>", i)
        ) i++;
        if (i > valueStart) {
          tokens.push({ kind: "attributeValue", start: valueStart, end: i, depth: tagStack.length });
        }
      }
    }

    if (!selfClosing) tagStack.push(tagName);
  }

  return tokens;
}


export type RecursiveEmbeddedLanguage = HostLanguage | "html" | "xml" | "css";

export interface RecursiveEmbeddedRegion extends EmbeddedRegion {
  language: RecursiveEmbeddedLanguage;
  parentLanguage?: RecursiveEmbeddedLanguage;
  depth: number;
}

function tagNameAt(source: string, token: MarkupToken): string {
  return source.slice(token.start, token.end).toLowerCase();
}

function findTagContentStart(source: string, nameToken: MarkupToken, limit: number): number {
  let i = nameToken.end;
  while (i < limit && source[i] !== ">") i++;
  return i < limit ? i + 1 : limit;
}

function findRecursiveBlockClose(
  source: string,
  start: number,
  end: number,
  tagName: "script" | "style"
): number {
  let i = start;
  const backslash = String.fromCharCode(92);

  while (i < end) {
    if (tagName === "script") {
      if (source[i] === "'" || source[i] === '"') {
        const quote = source[i] as "'" | '"';
        i = skipQuotedHostString(source, i, quote);
        continue;
      }
      if (source[i] === "`") {
        i = scanTemplateLiteralEnd(source, i);
        continue;
      }
      if (source[i] === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
        i = skipHostComment(source, i);
        continue;
      }
    } else {
      if (source.startsWith("/*", i)) {
        const close = source.indexOf("*/", i + 2);
        i = close === -1 ? end : Math.min(close + 2, end);
        continue;
      }
      if (source[i] === "'" || source[i] === '"') {
        const quote = source[i];
        i++;
        while (i < end) {
          if (source[i] === backslash) {
            i = Math.min(i + 2, end);
            continue;
          }
          if (source[i] === quote) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
    }

    if (
      source[i] === "<" &&
      source[i + 1] === "/" &&
      source.slice(i + 2, i + 2 + tagName.length).toLowerCase() === tagName &&
      !/[A-Za-z0-9_:.-]/.test(source[i + 2 + tagName.length] ?? "")
    ) {
      return i;
    }

    i++;
  }

  return end;
}

export { findRecursiveBlockClose };

function findRecursiveHostRegions(
  source: string,
  start: number,
  end: number,
  language: HostLanguage,
  depth: number,
  output: RecursiveEmbeddedRegion[]
): void {
  const local = findEmbeddedRegions(source.slice(start, end), language);

  for (const region of local) {
    const absoluteStart = start + region.start;
    const absoluteEnd = start + region.end;
    const regionLanguage: RecursiveEmbeddedLanguage =
      region.kind === "markup" ? "html" : language;

    output.push({
      ...region,
      start: absoluteStart,
      end: absoluteEnd,
      language: regionLanguage,
      parentLanguage: language,
      depth
    });

    if (region.kind === "markup") {
      const tokens = tokenizeMarkup(source, absoluteStart, absoluteEnd);

      for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex];
        if (token.kind !== "tag") continue;

        const name = tagNameAt(source, token);
        const before = source.slice(Math.max(absoluteStart, token.start - 2), token.start);
        const closing = before.includes("</");

        if (closing || (name !== "script" && name !== "style")) continue;

        const childStart = findTagContentStart(source, token, absoluteEnd);
        const childEnd = findRecursiveBlockClose(source, childStart, absoluteEnd, name);

        if (childStart < childEnd) {
          output.push({
            kind: "string",
            start: childStart,
            end: childEnd,
            hostLanguage: "javascript",
            language: name === "script" ? "javascript" : "css",
            parentLanguage: "html",
            depth: depth + 1
          });

          if (name === "script") {
            findRecursiveHostRegions(source, childStart, childEnd, "javascript", depth + 2, output);
          }
        }

        // Tokens inside an embedded script/style belong to the child language.
        while (tokenIndex + 1 < tokens.length && tokens[tokenIndex + 1].start < childEnd) {
          tokenIndex++;
        }
        if (childEnd >= absoluteEnd) break;
      }
    }
  }
}

export function findRecursiveEmbeddedRegions(
  source: string,
  language: HostLanguage
): RecursiveEmbeddedRegion[] {
  const output: RecursiveEmbeddedRegion[] = [];
  findRecursiveHostRegions(source, 0, source.length, language, 0, output);
  return output.sort((a, b) => a.start - b.start || a.end - b.end);
}


export type CssTokenKind =
  | "selector"
  | "property"
  | "value"
  | "number"
  | "string"
  | "comment"
  | "atRule"
  | "punctuation"
  | "invalid";

export interface CssToken {
  kind: CssTokenKind;
  start: number;
  end: number;
  depth: number;
}

export function tokenizeCss(source: string, start = 0, end = source.length): CssToken[] {
  const tokens: CssToken[] = [];
  const limit = Math.min(source.length, Math.max(start, end));
  let i = Math.max(0, start);
  let depth = 0;
  let inBlock = false;
  let expectingProperty = false;

  while (i < limit) {
    if (isWhitespace(source[i])) {
      i++;
      continue;
    }

    if (source.startsWith("/*", i)) {
      const close = source.indexOf("*/", i + 2);
      const tokenEnd = close === -1 || close + 2 > limit ? limit : close + 2;
      tokens.push({ kind: "comment", start: i, end: tokenEnd, depth });
      i = tokenEnd;
      continue;
    }

    if (source[i] === "{" ) {
      tokens.push({ kind: "punctuation", start: i, end: i + 1, depth });
      depth++;
      inBlock = true;
      expectingProperty = true;
      i++;
      continue;
    }

    if (source[i] === "}") {
      tokens.push({ kind: "punctuation", start: i, end: i + 1, depth: Math.max(0, depth - 1) });
      depth = Math.max(0, depth - 1);
      inBlock = depth > 0;
      expectingProperty = inBlock;
      i++;
      continue;
    }

    if (source[i] === ":" || source[i] === ";" || source[i] === ",") {
      tokens.push({ kind: "punctuation", start: i, end: i + 1, depth });
      expectingProperty = source[i] === ";" && inBlock;
      i++;
      continue;
    }

    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i];
      const valueStart = i;
      i++;
      while (i < limit) {
        if (source[i] === "\\") {
          i = Math.min(i + 2, limit);
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      tokens.push({
        kind: "string",
        start: valueStart,
        end: i,
        depth
      });
      continue;
    }

    if (source[i] === "@") {
      const tokenStart = i++;
      while (i < limit && /[A-Za-z-]/.test(source[i])) i++;
      tokens.push({ kind: "atRule", start: tokenStart, end: i, depth });
      continue;
    }

    if (/[0-9]/.test(source[i]) || (source[i] === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const tokenStart = i;
      while (i < limit && /[A-Za-z0-9.%+-]/.test(source[i])) i++;
      tokens.push({ kind: "number", start: tokenStart, end: i, depth });
      continue;
    }

    const tokenStart = i;
    while (
      i < limit &&
      !isWhitespace(source[i]) &&
      !"{}:;,\"'".includes(source[i]) &&
      !source.startsWith("/*", i)
    ) i++;

    if (i === tokenStart) {
      tokens.push({ kind: "invalid", start: i, end: i + 1, depth });
      i++;
      continue;
    }

    tokens.push({
      kind: expectingProperty ? "property" : inBlock ? "value" : "selector",
      start: tokenStart,
      end: i,
      depth
    });
  }

  return tokens;
}
