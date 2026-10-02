import * as vscode from "vscode";
import { tokenizeJson } from "@nested-code/core";

const tokenTypes = ["property", "string", "number", "boolean", "null", "punctuation"];
const legend = new vscode.SemanticTokensLegend(tokenTypes);

class NestedJsonProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(legend);
    const text = document.getText();

    for (const token of tokenizeJson(text)) {
      const start = document.positionAt(token.start);
      const end = document.positionAt(token.end);
      if (start.line !== end.line) continue;
      builder.push(start.line, start.character, end.character - start.character, tokenTypes.indexOf(token.kind), 0);
    }

    return builder.build();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [{ language: "json" }, { language: "jsonc" }];
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(selector, new NestedJsonProvider(), legend)
  );
}

export function deactivate(): void {}
