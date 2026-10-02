import {
  findRecursiveEmbeddedRegions,
  tokenizeCss,
  tokenizeJson,
  tokenizeJsonc,
  tokenizeMarkup
} from "@nested-code/core";

const MARK_CLASSES = {
  tag: "nested-code-tag",
  attribute: "nested-code-attribute",
  attributeValue: "nested-code-attribute-value",
  comment: "nested-code-comment",
  cdata: "nested-code-cdata",
  doctype: "nested-code-cdata",
  processingInstruction: "nested-code-cdata",
  invalid: "nested-code-invalid",
  selector: "nested-code-tag",
  property: "nested-code-attribute",
  value: "nested-code-attribute-value",
  number: "nested-code-number",
  string: "nested-code-string",
  atRule: "nested-code-keyword",
  punctuation: "nested-code-punctuation",
  boolean: "nested-code-boolean",
  null: "nested-code-null",
  propertyJson: "nested-code-attribute"
};

function languageId() {
  const file = globalThis.editorManager?.activeFile;
  const name = String(file?.filename ?? file?.name ?? "").toLowerCase();
  const mode = String(file?.mode ?? file?.languageId ?? "").toLowerCase();
  const value = name || mode;
  if (value.endsWith(".jsonc") || value.includes("jsonc")) return "jsonc";
  if (value.endsWith(".json") || value === "json") return "json";
  if (value.endsWith(".ts") || value.endsWith(".tsx") || value.includes("typescript")) return "typescript";
  if (value.endsWith(".js") || value.endsWith(".jsx") || value.includes("javascript")) return "javascript";
  return null;
}

function rangesFor(source, language) {
  const ranges = [];
  const add = (start, end, kind) => {
    if (end <= start) return;
    const className = MARK_CLASSES[kind] ?? null;
    if (className) ranges.push({ start, end, className });
  };

  if (language === "json" || language === "jsonc") {
    const tokens = language === "jsonc" ? tokenizeJsonc(source) : tokenizeJson(source);
    for (const token of tokens) add(token.start, token.end, token.kind === "property" ? "propertyJson" : token.kind);
    return ranges;
  }

  const host = language === "typescript" ? "typescript" : "javascript";
  for (const region of findRecursiveEmbeddedRegions(source, host)) {
    if (region.kind === "markup" && region.language === "html") {
      for (const token of tokenizeMarkup(source, region.start, region.end)) add(token.start, token.end, token.kind);
    }
    if (region.language === "css") {
      for (const token of tokenizeCss(source, region.start, region.end)) add(token.start, token.end, token.kind);
    }
  }
  return ranges;
}

class NestedDecorations {
  constructor(view, cm) {
    this.cm = cm;
    this.decorations = this.build(view);
  }

  build(view) {
    const source = view.state.doc.toString();
    const ranges = rangesFor(source, languageId());
    const marks = ranges.map(({ start, end, className }) =>
      this.cm.Decoration.mark({ class: className }).range(start, end)
    );
    return this.cm.Decoration.set(marks, true);
  }

  update(update) {
    if (update.docChanged) this.decorations = this.build(update.view);
  }
}

class NestedCodePlugin {
  constructor() {
    this.cm = null;
    this.compartment = null;
    this.extension = null;
    this.view = null;
    this.onUpdate = () => this.refresh();
    this.onSwitchFile = () => this.refresh();
  }

  async init() {
    if (!globalThis.editorManager?.isCodeMirror) return;
    this.cm = acode.require("codemirror");
    const { EditorView, ViewPlugin, Compartment } = this.cm;
    if (!EditorView || !ViewPlugin || !Compartment || !this.cm.Decoration) {
      throw new Error("Nested Code requires Acode CodeMirror 6.");
    }

    this.compartment = new Compartment();
    const Plugin = ViewPlugin.fromClass(
      class extends NestedDecorations {
        constructor(view) {
          super(view, this.cm);
        }
      },
      { decorations: value => value.decorations }
    );
    this.extension = Plugin;
    this.attach();
    globalThis.editorManager?.on?.("file-content-changed", this.onUpdate);
    globalThis.editorManager?.on?.("switch-file", this.onSwitchFile);
    globalThis.editorManager?.on?.("update", this.onUpdate);
  }

  attach() {
    const view = globalThis.editorManager?.editor;
    if (!view?.dispatch || !this.compartment || !this.extension) return;
    this.view = view;
    view.dispatch({ effects: this.compartment.reconfigure(this.extension) });
  }

  refresh() {
    if (globalThis.editorManager?.isCodeMirror === false) return;
    this.attach();
  }

  destroy() {
    globalThis.editorManager?.off?.("file-content-changed", this.onUpdate);
    globalThis.editorManager?.off?.("switch-file", this.onSwitchFile);
    if (this.view && this.compartment) {
      try { this.view.dispatch({ effects: this.compartment.reconfigure([]) }); } catch {}
    }
    this.view = null;
  }
}

if (globalThis.acode) {
  const plugin = new NestedCodePlugin();
  acode.setPluginInit("nested.code", async () => {
    await plugin.init();
    globalThis.__nestedCodePlugin = plugin;
  });
  acode.setPluginUnmount("nested.code", () => {
    plugin.destroy();
    delete globalThis.__nestedCodePlugin;
  });
}
