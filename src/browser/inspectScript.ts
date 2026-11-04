// J-BROWSER-inspect: the page-side inspector, injected through the provider's evaluate when
// inspect mode turns on (architecture decision 6: inspect happens in the page, not in the
// canvas — the streamed frames show the outlines because they show the real page). While
// inspecting, a click selects rather than activates: the capture-phase listener stops the
// event, records structured element context, and draws a selection outline. Everything the
// page returns is DATA; the capability layer never treats it as instructions.

/** The whole inspector as one IIFE source string: idempotent, no dependencies. */
export const INSPECT_SCRIPT_SOURCE = `(function () {
  var NAMESPACE = "__cognateInspect";
  var existing = window[NAMESPACE];
  if (existing && existing.teardown) existing.teardown();
  var state = { enabled: false, selection: null, outline: null, hover: null, handlers: null };

  function bounded(value, max) {
    var text = String(value == null ? "" : value).trim();
    return text.length > max ? text.slice(0, max) : text;
  }

  function implicitRole(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "button" || (tag === "input" && (el.type === "button" || el.type === "submit"))) return "button";
    if (tag === "a" && el.getAttribute("href") != null) return "link";
    if (tag === "input" && (el.type === "text" || el.type === "email" || el.type === "search" || el.type === "tel" || el.type === "url")) return "textbox";
    if (tag === "input" && el.type === "checkbox") return "checkbox";
    if (tag === "textarea") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "select") return "combobox";
    if (tag === "img") return "img";
    return el.getAttribute("role") || tag;
  }

  function accessibleName(el) {
    return bounded(el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || el.textContent, 120);
  }

  function cssPath(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 8) {
      var part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + "#" + node.id); break; }
      var parent = node.parentNode;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (siblings.length > 1) part += ":nth-of-type(" + (Array.prototype.indexOf.call(siblings, node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  function contextOf(el) {
    var rect = el.getBoundingClientRect();
    var ancestors = [];
    var node = el.parentElement;
    var depth = 0;
    while (node && node !== document.body && depth < 5) {
      ancestors.push({ tag: node.tagName.toLowerCase(), id: node.id || undefined, class: bounded(node.classList[0], 60) });
      node = node.parentElement;
      depth++;
    }
    var styles = getComputedStyle(el);
    var id = el.id || undefined;
    var testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || undefined;
    var role = implicitRole(el);
    var name = accessibleName(el);
    var candidates = [];
    if (id) candidates.push({ kind: "id", value: "#" + id });
    if (testId) candidates.push({ kind: "testid", value: "[data-testid=" + JSON.stringify(testId) + "]" });
    if (name) candidates.push({ kind: "role+name", value: role + " " + JSON.stringify(name.slice(0, 60)) });
    candidates.push({ kind: "css", value: cssPath(el) });
    return {
      tag: el.tagName.toLowerCase(),
      role: role,
      name: name,
      text: bounded(el.textContent, 200),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) },
      candidates: candidates,
      ancestry: ancestors,
      styles: { color: styles.color, backgroundColor: styles.backgroundColor, fontSize: styles.fontSize, fontFamily: bounded(styles.fontFamily, 80), display: styles.display },
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
    };
  }

  function outlineFor(rect, color) {
    var div = document.createElement("div");
    div.setAttribute("data-cognate-inspect", "");
    div.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;margin:0;" +
      "left:" + (rect.x - 2) + "px;top:" + (rect.y - 2) + "px;width:" + (rect.width + 4) + "px;height:" + (rect.height + 4) + "px;" +
      "outline:2px solid " + color + ";background:" + color + "22;";
    document.documentElement.appendChild(div);
    return div;
  }

  function removeOutline(which) {
    if (state[which]) { state[which].remove(); state[which] = null; }
  }

  function install() {
    if (state.handlers) return;
    var handlers = {
      move: function (event) {
        var target = event.target;
        if (!(target instanceof Element) || target.closest("[data-cognate-inspect]")) return;
        removeOutline("hover");
        state.hover = outlineFor(target.getBoundingClientRect(), "#8b5cf6");
      },
      leave: function () { removeOutline("hover"); },
      down: function (event) {
        var target = event.target;
        if (!(target instanceof Element) || target.closest("[data-cognate-inspect]")) return;
        event.preventDefault();
        event.stopPropagation();
        removeOutline("hover");
        removeOutline("outline");
        state.selection = contextOf(target);
        state.outline = outlineFor(target.getBoundingClientRect(), "#f59e0b");
      },
      // preventDefault on mousedown does not stop activation: the button fires on the derived
      // click event. Kill that too (same capture-phase guard), or selecting a link or button
      // would navigate or submit while "selecting".
      click: function (event) {
        var target = event.target;
        if (!(target instanceof Element) || target.closest("[data-cognate-inspect]")) return;
        event.preventDefault();
        event.stopPropagation();
      },
    };
    document.addEventListener("mousemove", handlers.move, true);
    document.addEventListener("mouseout", handlers.leave, true);
    document.addEventListener("mousedown", handlers.down, true);
    document.addEventListener("click", handlers.click, true);
    state.handlers = handlers;
  }

  window[NAMESPACE] = {
    version: 1,
    get enabled() { return state.enabled; },
    get selection() { return state.selection; },
    enable: function () { state.enabled = true; install(); return true; },
    disable: function () {
      state.enabled = false;
      if (state.handlers) {
        document.removeEventListener("mousemove", state.handlers.move, true);
        document.removeEventListener("mouseout", state.handlers.leave, true);
        document.removeEventListener("mousedown", state.handlers.down, true);
        document.removeEventListener("click", state.handlers.click, true);
        state.handlers = null;
      }
      removeOutline("hover");
      removeOutline("outline");
      state.selection = null;
      return true;
    },
    take: function () {
      var selection = state.selection;
      state.selection = null;
      removeOutline("outline");
      return selection;
    },
    verify: function (candidates) {
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        try {
          var el = null;
          if (candidate.kind === "id" || candidate.kind === "testid" || candidate.kind === "css") {
            el = document.querySelector(candidate.value);
          } else if (candidate.kind === "role+name") {
            var spaceAt = candidate.value.indexOf(" ");
            var role = candidate.value.slice(0, spaceAt);
            var name = JSON.parse(candidate.value.slice(spaceAt + 1));
            var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            var node = walker.currentNode;
            while ((node = walker.nextNode())) {
              if (implicitRole(node) === role && accessibleName(node).indexOf(name) !== -1) { el = node; break; }
            }
          }
          if (el) return { resolved: true, matched: candidate.kind, tag: el.tagName.toLowerCase(), text: bounded(el.textContent, 120) };
        } catch (error) { /* a stale selector that no longer parses: keep trying */ }
      }
      return { resolved: false, matched: null };
    },
    teardown: function () { this.disable(); },
  };
  return { installed: true, version: 1 };
})()`;

/** Enable inspect mode in a page where the script is (or is not yet) installed. */
export const INSPECT_ENABLE_EXPRESSION = `(() => { ${INSPECT_SCRIPT_SOURCE}; return window.__cognateInspect.enable(); })()`;

/** Disable inspect mode; the script itself stays installed (idempotent, inert). */
export const INSPECT_DISABLE_EXPRESSION = `window.__cognateInspect ? window.__cognateInspect.disable() : false`;

/** Read and clear the current selection (a capture). */
export const INSPECT_TAKE_EXPRESSION = `(window.__cognateInspect && window.__cognateInspect.take()) || null`;

/** Re-resolve selector candidates against the page's current DOM. A document without the
 *  inspector (e.g. after a navigation) has nothing to resolve: honestly unresolved. */
export const inspectVerifyExpression = (candidates: readonly { readonly kind: string; readonly value: string }[]): string =>
  `(window.__cognateInspect && window.__cognateInspect.verify(${JSON.stringify(candidates)})) || { resolved: false, matched: null }`;
