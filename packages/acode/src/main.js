/*
 * Acode adapter.
 *
 * The shared @nested-code/core package owns parsing and token ranges.
 * This adapter deliberately does not replace Acode's normal language mode.
 * It will translate shared token ranges into Acode/CodeMirror decorations
 * so existing theme and host-language highlighting remain intact.
 */

class NestedCodePlugin {
  async init() {
    // Adapter wiring follows after the core package is bundled for Acode.
    // Keeping this no-op initially prevents overriding Acode's active mode.
  }

  async destroy() {}
}

if (globalThis.acode) {
  acode.setPluginInit("nested.code", async () => {
    const plugin = new NestedCodePlugin();
    await plugin.init();
    globalThis.__nestedCodePlugin = plugin;
  });

  acode.setPluginUnmount("nested.code", async () => {
    await globalThis.__nestedCodePlugin?.destroy();
    delete globalThis.__nestedCodePlugin;
  });
}
