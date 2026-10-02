import * as vscode from "vscode";
import {
  findRecursiveEmbeddedRegions,
  tokenizeJson,
  tokenizeJsonc,
  tokenizeMarkup,
  type MarkupTokenKind,
  type TokenKind
} from "@nested-code/core";

const tokenTypes = [
  "property",
  "string",
  "number",
  "boolean",
  "null",
  "comment",
  "punctuation",
  "invalid",
  "nestedTag",
  "nestedAttribute",
  "nestedAttributeValue",
  "nestedComment",
  "nestedCdata",
  "nestedInvalid"
] as const;

const legend = new vscode.SemanticTokensLegend([...tokenTypes]);

function pushToken(
  builder: vscode.SemanticTokensBuilder,
  document: vscode.TextDocument,
  start: number,
  end: number,
  type: string
): void {
  const startPosition = document.positionAt(start);
  const endPosition = document.positionAt(end);
  const tokenIndex = tokenTypes.indexOf(type as (typeof tokenTypes)[number]);
  if (tokenIndex < 0) return;

  for (let line = startPosition.line; line <= endPosition.line; line++) {
    const lineText = document.lineAt(line).text;
    const from = line === startPosition.line ? startPosition.character : 0;
    const to = line === endPosition.line ? endPosition.character : lineText.length;
    if (to > from) builder.push(line, from, to - from, tokenIndex, 0);
  }
}

class NestedProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(legend);
    const text = document.getText();

    if (document.languageId === "json" || document.languageId === "jsonc") {
      const tokens = document.languageId === "jsonc" ? tokenizeJsonc(text) : tokenizeJson(text);
      for (const token of tokens) {
        pushToken(builder, document, token.start, token.end, token.kind as TokenKind);
      }
      return builder.build();
    }

    const host = document.languageId === "typescript" || document.languageId === "typescriptreact"
      ? "typescript"
      : "javascript";
    const regions = findRecursiveEmbeddedRegions(text, host);

    for (const region of regions) {
      if (region.kind !== "markup" || region.language !== "html") continue;

      for (const token of tokenizeMarkup(text, region.start, region.end)) {
        const mapped: Record<MarkupTokenKind, string | null> = {
          tag: "nestedTag",
          attribute: "nestedAttribute",
          attributeValue: "nestedAttributeValue",
          comment: "nestedComment",
          cdata: "nestedCdata",
          doctype: "nestedCdata",
          processingInstruction: "nestedCdata",
          invalid: "nestedInvalid",
          text: null,
          punctuation: null
        };
        const type = mapped[token.kind];
        if (type) pushToken(builder, document, token.start, token.end, type);
      }
    }

    return builder.build();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [
    { language: "json" },
    { language: "jsonc" },
    { language: "javascript" },
    { language: "typescript" },
    { language: "javascriptreact" },
    { language: "typescriptreact" }
  ];

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      new NestedProvider(),
      legend
    )
  );
}

export function deactivate(): void {}
