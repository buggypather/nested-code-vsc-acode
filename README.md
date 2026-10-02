# Nested Code — VS Code + Acode

A shared language engine with separate editor adapters for highlighting nested data and embedded languages without replacing each editor's normal syntax mode.

## Initial scope

- Deeply nested JSON objects and arrays
- JSON token ranges with nesting depth
- VS Code semantic-token adapter
- Acode adapter shell designed to preserve the active editor mode

## Planned embedded-language pipeline

Host languages:

- JavaScript
- TypeScript
- Kotlin
- C++
- Swift

Embedded languages:

- HTML
- XML
- CSS
- JavaScript inside HTML `<script>` blocks
- CSS inside HTML `<style>` blocks

The parser will support transitions such as:

`TypeScript -> template string -> HTML -> ${expression} -> TypeScript -> HTML`

and:

`Swift -> multiline string -> XML/HTML -> Swift interpolation -> XML/HTML`

## Architecture

```
packages/
  core/       shared parsing, language detection, token ranges, recovery
  vscode/     VS Code-specific rendering/integration
  acode/      Acode-specific rendering/integration
```

The shared core is not installed globally and does not take control of either editor. Each extension packages and calls it internally.

## Development

```sh
npm install
npm test
npm run build
```

## Next

1. Harden JSON/JSONC parsing and malformed-document recovery.
2. Wire Acode token decorations.
3. Add host string scanners for JS/TS, Kotlin, C++, and Swift.
4. Add HTML/XML parsing and interpolation boundaries.
5. Add CSS and `<script>` / `<style>` language transitions.
