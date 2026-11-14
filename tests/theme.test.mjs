import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function load(source, dependencies = {}) {
  const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX });
  const loadedModule = { exports: {} };
  vm.runInNewContext(js, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: (id) => dependencies[id] ?? require(id),
    ...dependencies.globals,
  });
  return loadedModule.exports;
}

const { themeInitScript } = load(read("src/components/theme/theme.ts"));

test("bootstrap applies stored or system preference before hydration, including blocked storage", () => {
  for (const [stored, osDark, expected] of [
    ["dark", false, "dark"], ["light", true, "light"], ["system", true, "dark"],
    [null, false, "light"], ["invalid", true, "dark"], ["blocked", true, "dark"],
  ]) {
    const root = { dataset: {}, style: {} };
    vm.runInNewContext(themeInitScript, {
      localStorage: { getItem() { if (stored === "blocked") throw Error("blocked"); return stored; } },
      window: { matchMedia: () => ({ matches: osDark }) },
      document: { documentElement: root },
    });
    assert.equal(root.dataset.theme, expected);
    assert.equal(root.style.colorScheme, expected);
  }
  assert.match(read("src/app/layout.tsx"), /themeInitScript/);
});

function providerHarness(initialPreference, blocked = false) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let captured;
  let stored = initialPreference;
  const writes = [];
  const listeners = {};
  const mediaListeners = {};
  const media = {
    matches: false,
    addEventListener: (name, fn) => { mediaListeners[name] = fn; },
    removeEventListener() {},
  };
  const root = { dataset: { theme: initialPreference }, style: { colorScheme: initialPreference } };
  const window = {
    localStorage: {
      getItem() { if (blocked) throw Error("blocked"); return stored; },
      setItem(_key, value) { if (blocked) throw Error("blocked"); writes.push(value); stored = value; },
    },
    matchMedia: () => media,
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener() {},
  };
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useContext: () => captured,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous[i])) {
        slots[index] = deps;
        effects.push(fn);
      }
    },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  };
  const provider = load(read("src/components/theme/ThemeProvider.tsx"), {
    react,
    "react/jsx-runtime": { jsx(_type, props) { captured = props.value; return null; } },
    "./theme": { THEME_STORAGE_KEY: "theme-preference" },
    globals: { window, document: { documentElement: root }, process, console },
  });
  function render() {
    cursor = 0;
    effects = [];
    provider.ThemeProvider({ children: null });
    effects.forEach((effect) => effect());
  }
  return {
    render, root, media, listeners, mediaListeners, writes,
    get theme() { return captured; },
    setStored(value) { stored = value; },
    get stored() { return stored; },
  };
}

test("hydration never overwrites a saved preference; choices persist and reload", () => {
  const app = providerHarness("dark");
  app.render();
  assert.equal(app.stored, "dark");
  assert.equal(app.root.dataset.theme, "dark");
  assert.deepEqual(app.writes, []);
  app.render();
  assert.equal(app.theme.theme, "dark");
  app.theme.setTheme("light");
  app.render();
  assert.equal(app.root.dataset.theme, "light");
  assert.equal(app.stored, "light");
  const reloaded = providerHarness(app.stored);
  reloaded.render(); reloaded.render();
  assert.equal(reloaded.theme.theme, "light");
  assert.equal(reloaded.root.dataset.theme, "light");
  assert.deepEqual(reloaded.writes, []);
});

test("system and cross-tab changes synchronize without overwriting storage", () => {
  const app = providerHarness("system");
  app.render(); app.render();
  assert.equal(app.root.dataset.theme, "light");
  app.media.matches = true;
  app.mediaListeners.change(); app.render();
  assert.equal(app.root.dataset.theme, "dark");
  app.setStored("light");
  app.listeners.storage({ key: "theme-preference" }); app.render();
  assert.equal(app.root.dataset.theme, "light");
  app.media.matches = false;
  app.mediaListeners.change(); app.render();
  assert.equal(app.root.dataset.theme, "light");
  assert.deepEqual(app.writes, []);
});

test("storage failures do not prevent in-memory theme changes", () => {
  const app = providerHarness(null, true);
  app.render(); app.render();
  assert.equal(app.theme.theme, "system");
  assert.doesNotThrow(() => app.theme.setTheme("dark"));
  app.render();
  assert.equal(app.root.dataset.theme, "dark");
});

function luminance(hex) {
  const values = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function renderedComponent(path, name, extra = "") {
  const source = read(path);
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = file.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  );
  assert.ok(declaration, `${name} exists in ${path}`);
  return load(`${extra}\n${declaration.getText(file)}\nexport { ${name} };`)[name];
}

test("study welcome copy and image caption use readable semantic colors", () => {
  const header = renderToStaticMarkup(createElement(renderedComponent(
    "src/app/page.tsx", "StudiesHeader", "function RainbowClouds() { return null; }"
  )));
  const caption = renderToStaticMarkup(createElement(
    renderedComponent("src/components/CaptionVoteFlow.tsx", "CaptionPrompt"),
    { content: "Caption contrast fixture" }
  ));
  assert.match(header, /bg-\[var\(--card-surface\)\]/);
  assert.match(header, /text-\[var\(--muted\)\]/);
  assert.match(header, /text-\[var\(--foreground\)\][^"]*">Engineering for Humanity/);
  assert.doesNotMatch(header, /text-\[#|style="[^"]*color/);
  assert.match(caption, /id="caption-card-caption"[\s\S]*text-\[var\(--foreground\)\]/);
  assert.doesNotMatch(caption, /text-stone-|style="[^"]*color/);

  const css = read("src/app/globals.css");
  const palette = (selector) => {
    const block = css.match(selector)[1];
    return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)]
      .map((match) => [match[1], match[2]]));
  };
  const light = palette(/:root\s*\{([\s\S]*?)\n\}/);
  const dark = palette(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  for (const [name, values, surfaces] of [
    ["light", light, ["#fffefa", "#fdfbf7", "#f9faf5", "#fffaf8"]],
    ["dark", dark, ["#26352b", "#1f2e24", "#17241c", "#1b2a21", "#2a2025"]],
  ]) {
    for (const surface of surfaces) {
      for (const token of ["foreground", "muted"]) {
        assert.ok(contrast(values[token], surface) >= 4.5, `${name} ${token} on ${surface}`);
      }
    }
  }
});

test("foregrounds and accent button hover meet text contrast in both themes", () => {
  const css = read("src/app/globals.css");
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
  const dark = css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1];
  const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [match[1], match[2]]));
  for (const [name, palette] of [["light", tokens(root)], ["dark", tokens(dark)]]) {
    for (const [text, background] of [["foreground", "background"], ["muted", "background"], ["soft", "background"], ["accent-contrast", "accent"], ["accent-hover-contrast", "accent-strong"]]) {
      assert.ok(contrast(palette[text], palette[background]) >= 4.5, `${name}: ${text} on ${background}`);
    }
  }
  assert.ok(contrast(tokens(root)["accent-strong"], tokens(root)["card-surface"]) >= 4.5, "light: accent text on card");
  assert.ok(contrast(tokens(root)["progress-fill"], tokens(root)["progress-track"]) >= 3, "light: progress fill on track");
  assert.match(css, /\.hover\\:bg-\\\[var\\\(--accent-strong\\\)\\\]:hover\s*\{\s*color:\s*var\(--accent-hover-contrast\)/);
  assert.match(css, /@custom-variant dark[^;]*data-theme="dark"/);
});

test("shared fallback reserves space and yields to existing account or theme controls", () => {
  const provider = read("src/components/Providers.tsx");
  const css = read("src/app/globals.css");
  const menu = read("src/components/theme/ThemeMenu.tsx");
  assert.match(provider, /global-theme-content/);
  assert.match(provider, /id="global-theme-fallback"/);
  assert.match(provider, /<ThemeMenu fallback\s*\/>/);
  assert.match(menu, /id=\{fallback \? "fallback-theme-menu-root" : "theme-menu-root"\}/);
  assert.match(css, /body:has\(\.global-theme-content #account-menu-root, \.global-theme-content #theme-menu-root\) #global-theme-fallback\s*\{\s*display:\s*none/);
  assert.match(css, /height:\s*calc\(100svh - 5rem\)/);
  assert.match(css, /global-theme-content > :first-child\s*\{\s*min-height:\s*0;\s*max-height:\s*100%/);
});
