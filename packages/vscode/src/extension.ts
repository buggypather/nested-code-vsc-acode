import * as vscode from "vscode";
import { tokenizeJson, tokenizeJsonc, type TokenKind } from "@nested-code/core";

const tokenTypes: TokenKind[] = [
  "property",
  "string",
  "number",
  "boolean",
  "null",
  "comment",
  "punctuation",
  "invalid"
];
const legend = new vscode.SemanticTokensLegend(tokenTypes);

class NestedJsonProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(legend);
    const text = document.getText();
    const tokens = document.languageId === "jsonc" ? tokenizeJsonc(text) : tokenizeJson(text);

    for (const token of tokens) {
      const start = document.positionAt(token.start);
      const end = document.positionAt(token.end);

      // Semantic tokens cannot span lines. Comments/invalid ranges may, so emit
      // each visible line segment independently.
      for (let line = start.line; line <= end.line; line++) {
        const lineText = document.lineAt(line).text;
        const from = line === start.line ? start.character : 0;
        const to = line === end.line ? end.character : lineText.length;
        if (to <= from) continue;
        builder.push(line, from, to - from, tokenTypes.indexOf(token.kind), 0);
      }
    }

    return builder.build();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [{ language: "json" }, { language: "jsonc" }];
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      new NestedJsonProvider(),
      legend
    )
  );
}

export function deactivate(): void {}
