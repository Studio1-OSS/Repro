// Code that runs inside the inspected page (MAIN world). Plain JavaScript and fully self-contained:
// each function is injected on its own (chrome.scripting, CDP or Playwright), so it may not use imports
// or anything outside its own body. The extension and the bench inject this exact code.

/**
 * Starts capturing console output, errors, fetch/XHR traffic, clicks, inputs and navigations.
 * Every event is handed to `window.__reproSink` when present (Playwright), otherwise posted to the
 * extension's bridge with window.postMessage. Events carry epoch-ms timestamps; the recorder converts them.
 */
export function installCapture() {
  if (window.__reproCaptureInstalled) return;
  window.__reproCaptureInstalled = true;
  var BODY_MAX = 10000;
  var TEXT_MAX = 2000;

  function emit(kind, data) {
    var event = { kind: kind, ts: Date.now(), data: data };
    try {
      if (typeof window.__reproSink === "function") window.__reproSink(event);
      else window.postMessage({ source: "repro-page", event: event }, "*");
    } catch (e) {
      // Never break the page.
    }
  }
  function cut(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 12) + "…[truncated]" : s;
  }
  function show(v) {
    if (v instanceof Error) return v.name + ": " + v.message;
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, function (_k, x) {
        return typeof x === "bigint" ? String(x) : x instanceof Element ? "<" + x.tagName.toLowerCase() + ">" : x;
      });
    } catch (e) {
      return String(v);
    }
  }
  function describe(el) {
    if (!el || el.nodeType !== 1) return undefined;
    var target = el.closest("a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox]") || el;
    var tag = target.getAttribute("role") || target.tagName.toLowerCase();
    if (tag === "input") tag = "input[" + (target.type || "text") + "]";
    var label =
      target.getAttribute("aria-label") ||
      (target.labels && target.labels[0] && target.labels[0].innerText) ||
      target.getAttribute("placeholder") ||
      target.getAttribute("title") ||
      (target.innerText || target.value || "").trim() ||
      target.getAttribute("name") ||
      target.id ||
      "";
    // Many controls share a label ("Add to cart" ×6): an id or test id tells them apart.
    var key = target.id || target.getAttribute("data-test") || target.getAttribute("data-testid") || target.getAttribute("name") || "";
    return tag + (key && key.length <= 60 ? "#" + key : "") + ' "' + cut(label.replace(/\s+/g, " ").trim(), 80) + '"';
  }
  function headersOf(h) {
    var out = {};
    try {
      if (!h) return out;
      if (typeof h.forEach === "function" && !Array.isArray(h)) h.forEach(function (v, k) { out[k] = String(v); });
      else if (Array.isArray(h)) h.forEach(function (p) { out[p[0]] = String(p[1]); });
      else Object.keys(h).forEach(function (k) { out[k] = String(h[k]); });
    } catch (e) {}
    return out;
  }
  function textBody(b) {
    if (b == null) return undefined;
    if (typeof b === "string") return cut(b, BODY_MAX);
    if (b instanceof URLSearchParams) return cut(b.toString(), BODY_MAX);
    if (b instanceof FormData) {
      var parts = [];
      b.forEach(function (v, k) { parts.push(k + "=" + (typeof v === "string" ? v : "[file]")); });
      return cut(parts.join("&"), BODY_MAX);
    }
    return "[binary body]";
  }
  function isTextType(ct) {
    return !ct || /json|text|xml|javascript|x-www-form-urlencoded|graphql/i.test(ct);
  }

  // Console and errors
  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      var err = args.find(function (a) { return a instanceof Error; });
      emit("console", { level: level, text: cut(args.map(show).join(" "), TEXT_MAX), stack: err && err.stack ? cut(err.stack, TEXT_MAX) : undefined });
      return original.apply(console, arguments);
    };
  });
  window.addEventListener("error", function (e) {
    if (e.target && e.target !== window && e.target.tagName) {
      emit("console", { level: "error", text: "Failed to load " + e.target.tagName.toLowerCase() + ": " + (e.target.src || e.target.href || "") });
      return;
    }
    emit("console", {
      level: "error",
      text: cut("Uncaught " + (e.error ? show(e.error) : e.message), TEXT_MAX),
      stack: e.error && e.error.stack ? cut(e.error.stack, TEXT_MAX) : e.filename ? e.filename + ":" + e.lineno + ":" + e.colno : undefined,
    });
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    emit("console", { level: "error", text: cut("Unhandled rejection: " + show(e.reason), TEXT_MAX), stack: e.reason && e.reason.stack ? cut(e.reason.stack, TEXT_MAX) : undefined });
  });

  // fetch
  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (input, init) {
      var start = performance.now();
      var req = input instanceof Request ? input : null;
      var method = ((init && init.method) || (req && req.method) || "GET").toUpperCase();
      var url = new URL(req ? req.url : String(input), location.href).href;
      var requestHeaders = Object.assign(headersOf(req && req.headers), headersOf(init && init.headers));
      var requestBody = textBody(init && init.body);
      return originalFetch.apply(this, arguments).then(
        function (res) {
          var base = { kind: "fetch", method: method, url: url, status: res.status, durationMs: performance.now() - start, requestHeaders: requestHeaders, responseHeaders: headersOf(res.headers), requestBody: requestBody };
          var ct = res.headers.get("content-type");
          if (!isTextType(ct)) {
            emit("network", base);
            return res;
          }
          res.clone().text().then(
            function (body) { base.responseBody = cut(body, BODY_MAX); emit("network", base); },
            function () { emit("network", base); },
          );
          return res;
        },
        function (err) {
          emit("network", { kind: "fetch", method: method, url: url, status: 0, durationMs: performance.now() - start, requestHeaders: requestHeaders, responseHeaders: {}, requestBody: requestBody, error: cut(show(err), TEXT_MAX) });
          throw err;
        },
      );
    };
  }

  // XMLHttpRequest
  var open = XMLHttpRequest.prototype.open;
  var send = XMLHttpRequest.prototype.send;
  var setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__repro = { method: String(method).toUpperCase(), url: new URL(String(url), location.href).href, headers: {} };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__repro) this.__repro.headers[k] = String(v);
    return setHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    var info = xhr.__repro;
    if (info) {
      var start = performance.now();
      var requestBody = textBody(body);
      xhr.addEventListener("loadend", function () {
        var responseHeaders = {};
        (xhr.getAllResponseHeaders() || "").trim().split(/\r?\n/).forEach(function (line) {
          var i = line.indexOf(":");
          if (i > 0) responseHeaders[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        });
        var responseBody;
        try {
          if (xhr.responseType === "" || xhr.responseType === "text") responseBody = cut(xhr.responseText, BODY_MAX);
          else if (xhr.responseType === "json") responseBody = cut(JSON.stringify(xhr.response), BODY_MAX);
        } catch (e) {}
        emit("network", {
          kind: "xhr", method: info.method, url: info.url, status: xhr.status, durationMs: performance.now() - start,
          requestHeaders: info.headers, responseHeaders: responseHeaders, requestBody: requestBody, responseBody: responseBody,
          error: xhr.status === 0 ? "Network error" : undefined,
        });
      });
    }
    return send.apply(this, arguments);
  };

  // User actions. Password values are never captured.
  document.addEventListener("click", function (e) { emit("action", { type: "click", target: describe(e.target) }); }, true);
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (!el || !("value" in el)) return;
    var secret = el.type === "password" || /password|card|cvc|cvv|iban/i.test(el.name || el.id || el.autocomplete || "");
    var shown = function () {
      if (el.type === "checkbox" || el.type === "radio") return String(el.checked);
      if (secret) return "••••";
      if (el.tagName === "SELECT" && el.selectedOptions && el.selectedOptions[0]) return cut(el.selectedOptions[0].text.trim(), 500);
      return cut(el.value, 500);
    };
    var chosen = shown();
    var target = describe(el);
    // Record what the control shows once the page has handled the change: apps sometimes put the old value back.
    setTimeout(function () {
      var now = shown();
      emit("action", { type: "input", target: target, value: now === chosen ? chosen : chosen + " (the page changed it back to " + now + ")" });
    }, 0);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === "Escape" || e.key === "Tab") emit("action", { type: "key", target: describe(e.target), value: e.key });
  }, true);
  function nav() { emit("action", { type: "navigate", url: location.href }); }
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var r = original.apply(this, arguments);
      nav();
      return r;
    };
  });
  window.addEventListener("popstate", nav);
  nav();

  // Web vitals and long tasks, read later by collectPageState().
  var perf = (window.__reproPerf = { lcp: null, cls: 0, inp: null, longTasks: [] });
  function observe(type, fn) {
    try {
      new PerformanceObserver(function (list) { list.getEntries().forEach(fn); }).observe({ type: type, buffered: true });
    } catch (e) {}
  }
  observe("largest-contentful-paint", function (e) { perf.lcp = Math.round(e.startTime); });
  observe("layout-shift", function (e) { if (!e.hadRecentInput) perf.cls = Math.round((perf.cls + e.value) * 1000) / 1000; });
  observe("event", function (e) { if (e.interactionId && (perf.inp === null || e.duration > perf.inp)) perf.inp = Math.round(e.duration); });
  observe("longtask", function (e) {
    perf.longTasks.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) });
    if (perf.longTasks.length > 50) perf.longTasks.shift();
  });
}

/**
 * What a developer would check in DevTools besides the logs: performance (navigation timing, LCP, CLS,
 * INP, long tasks, JS heap), storage keys and values (redacted later), cookie names (never values),
 * and a script-free DOM snapshot of the page as it is now.
 */
export function collectPageState() {
  var nav = performance.getEntriesByType("navigation")[0];
  var p = window.__reproPerf || { lcp: null, cls: 0, inp: null, longTasks: [] };
  var mem = performance.memory;
  function dump(store) {
    var out = [];
    try {
      for (var i = 0; i < Math.min(store.length, 100); i++) {
        var k = store.key(i);
        out.push({ key: String(k).slice(0, 200), value: String(store.getItem(k) || "").slice(0, 300) });
      }
    } catch (e) {}
    return out;
  }
  var clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script,noscript,iframe,object,embed,[data-repro-ignore],#__repro_banner").forEach(function (el) { el.remove(); });
  clone.querySelectorAll("input,textarea").forEach(function (el) {
    if (el.type === "password") el.setAttribute("value", "••••");
  });
  clone.querySelectorAll("*").forEach(function (el) {
    for (var i = el.attributes.length - 1; i >= 0; i--) {
      var name = el.attributes[i].name;
      if (/^on/i.test(name)) el.removeAttribute(name);
    }
  });
  var head = clone.querySelector("head");
  if (head) {
    var base = document.createElement("base");
    base.href = location.href;
    head.insertBefore(base, head.firstChild);
  }
  var html = "<!doctype html>" + clone.outerHTML;
  return {
    perf: {
      ttfb: nav ? Math.round(nav.responseStart) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      lcp: p.lcp,
      cls: p.cls,
      inp: p.inp,
      longTasks: p.longTasks.slice(-20),
      jsHeapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      resources: performance.getEntriesByType("resource").length,
    },
    storage: {
      local: dump(window.localStorage),
      session: dump(window.sessionStorage),
      cookies: document.cookie ? document.cookie.split(";").map(function (c) { return c.split("=")[0].trim(); }).filter(Boolean).slice(0, 100) : [],
    },
    dom: html.length > 3000000 ? html.slice(0, 3000000) : html,
    domTruncated: html.length > 3000000,
  };
}

/**
 * Numbers the page's visible interactive elements (data-repro-id) and returns what the agent sees:
 * one line per element, the visible text and the title. Reaches into open shadow roots and same-origin
 * iframes. Hidden and off-screen elements are skipped.
 */
export function snapshotPage() {
  var selector = "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],[role=combobox],[contenteditable=true],[onclick],[tabindex]:not([tabindex='-1'])";
  var lines = [];
  var id = 0;
  var vh = window.innerHeight;
  var vw = window.innerWidth;
  var seen = new Set();
  function walk(root, ox, oy) {
    root.querySelectorAll("[data-repro-id]").forEach(function (el) { el.removeAttribute("data-repro-id"); });
    root.querySelectorAll(selector).forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      var r = el.getBoundingClientRect();
      var style = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return;
      var top = r.top + oy, left = r.left + ox;
      if (top + r.height < 0 || top > vh || left + r.width < 0 || left > vw) return;
      var tag = el.getAttribute("role") || el.tagName.toLowerCase();
      var type = el.tagName === "INPUT" ? el.type || "text" : "";
      var label =
        el.getAttribute("aria-label") ||
        (el.labels && el.labels[0] && el.labels[0].innerText) ||
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? el.getAttribute("placeholder") || el.getAttribute("name") || "" : (el.innerText || "").trim()) ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        el.getAttribute("name") ||
        "";
      var extra = [];
      if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && type !== "password" && el.value) extra.push('value="' + String(el.value).slice(0, 60) + '"');
      if (el.tagName === "SELECT") {
        if (el.selectedOptions && el.selectedOptions[0]) extra.push('selected="' + el.selectedOptions[0].text.slice(0, 40) + '"');
        extra.push("options=[" + Array.prototype.slice.call(el.options, 0, 12).map(function (o) { return o.text.trim().slice(0, 30); }).join(" | ") + (el.options.length > 12 ? " | …" : "") + "]");
      }
      if (type === "checkbox" || type === "radio") extra.push(el.checked ? "checked" : "unchecked");
      if (el.getAttribute("aria-expanded")) extra.push("expanded=" + el.getAttribute("aria-expanded"));
      if (el.getAttribute("aria-selected") === "true") extra.push("selected");
      if (el.disabled || el.getAttribute("aria-disabled") === "true") extra.push("disabled");
      if (el.tagName === "A") extra.push("href=" + (el.getAttribute("href") || "").slice(0, 80));
      var key = el.id || el.getAttribute("data-test") || el.getAttribute("data-testid") || "";
      if (key && key.length <= 60) extra.push("#" + key);
      if (root !== document) extra.push(root instanceof ShadowRoot ? "in-shadow-dom" : "in-iframe");
      el.setAttribute("data-repro-id", String(id));
      lines.push("[" + id + "] " + tag + (type ? "[" + type + "]" : "") + ' "' + label.replace(/\s+/g, " ").trim().slice(0, 80) + '"' + (extra.length ? " " + extra.join(" ") : ""));
      id++;
    });
    root.querySelectorAll("*").forEach(function (el) {
      if (el.shadowRoot) walk(el.shadowRoot, ox, oy);
      if (el.tagName === "IFRAME") {
        try {
          var doc = el.contentDocument;
          var fr = el.getBoundingClientRect();
          if (doc) walk(doc, ox + fr.left, oy + fr.top);
        } catch (e) {}
      }
    });
  }
  walk(document, 0, 0);
  return {
    url: location.href,
    title: document.title,
    elements: lines.join("\n"),
    text: (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim().slice(0, 3500),
    viewport: { width: vw, height: vh, pixelRatio: window.devicePixelRatio || 1 },
  };
}

/** Scrolls element [id] into view and returns its centre in top-level CSS pixels (for real mouse events), or null. */
export function elementCenter(id) {
  function find(root, ox, oy) {
    var el = root.querySelector('[data-repro-id="' + id + '"]');
    if (el) return { el: el, ox: ox, oy: oy };
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var hit = null;
      if (all[i].shadowRoot) hit = find(all[i].shadowRoot, ox, oy);
      if (!hit && all[i].tagName === "IFRAME") {
        try {
          var fr = all[i].getBoundingClientRect();
          if (all[i].contentDocument) hit = find(all[i].contentDocument, ox + fr.left, oy + fr.top);
        } catch (e) {}
      }
      if (hit) return hit;
    }
    return null;
  }
  var found = find(document, 0, 0);
  if (!found) return null;
  found.el.scrollIntoView({ block: "center", inline: "center" });
  var again = find(document, 0, 0) || found;
  var r = again.el.getBoundingClientRect();
  return { x: again.ox + r.left + r.width / 2, y: again.oy + r.top + r.height / 2 };
}

/** Focuses element [id] and clears its value, so typed text replaces it. "missing" if it's gone; "password" for password fields, which the agent never fills. */
export function focusAndClear(id) {
  function find(root) {
    var el = root.querySelector('[data-repro-id="' + id + '"]');
    if (el) return el;
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var hit = null;
      if (all[i].shadowRoot) hit = find(all[i].shadowRoot);
      if (!hit && all[i].tagName === "IFRAME") {
        try {
          if (all[i].contentDocument) hit = find(all[i].contentDocument);
        } catch (e) {}
      }
      if (hit) return hit;
    }
    return null;
  }
  var el = find(document);
  if (!el) return "missing";
  if (el.type === "password") return "password";
  el.scrollIntoView({ block: "center" });
  el.focus();
  if ("value" in el) {
    var setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    if (setter && setter.set) setter.set.call(el, "");
    else el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (el.isContentEditable) {
    el.textContent = "";
  }
  return "ok";
}

/** True when the focused element (through shadow roots and same-origin iframes) is a password field. */
export function focusedIsPassword() {
  var el = document.activeElement;
  while (el) {
    if (el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    else if (el.tagName === "IFRAME") {
      try {
        el = el.contentDocument && el.contentDocument.activeElement;
      } catch (e) {
        return false;
      }
    } else break;
  }
  return Boolean(el && el.tagName === "INPUT" && el.type === "password");
}

/** Picks an option in <select> [id] by its visible text or value, the way a person would. */
export function selectOption(id, option) {
  function find(root) {
    var el = root.querySelector('[data-repro-id="' + id + '"]');
    if (el) return el;
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var hit = null;
      if (all[i].shadowRoot) hit = find(all[i].shadowRoot);
      if (!hit && all[i].tagName === "IFRAME") {
        try {
          if (all[i].contentDocument) hit = find(all[i].contentDocument);
        } catch (e) {}
      }
      if (hit) return hit;
    }
    return null;
  }
  var el = find(document);
  if (!el) return "missing";
  if (el.tagName !== "SELECT") return "not-a-select";
  var want = String(option).trim().toLowerCase();
  var match = Array.prototype.find.call(el.options, function (o) { return o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want; }) ||
    Array.prototype.find.call(el.options, function (o) { return o.text.trim().toLowerCase().indexOf(want) >= 0; });
  if (!match) return "no-option";
  el.focus();
  // The native setter, so frameworks that track the value (React) see the change.
  var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(el, match.value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  // Frameworks re-render inside the change event: if the page put the old value back, say so.
  if (el.value !== match.value) return "reverted:" + (el.selectedOptions[0] ? el.selectedOptions[0].text.trim() : el.value);
  return "ok:" + match.text.trim();
}

/**
 * Layout facts for a responsive scan at the current viewport width: horizontal overflow, elements that
 * run past the viewport, text clipped by its box, tap targets under 24px (WCAG 2.5.8) and interactive
 * elements covering each other.
 */
export function layoutAudit() {
  var vw = document.documentElement.clientWidth;
  var pageWidth = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  var issues = [];
  function name(el) {
    var t = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 40);
    var cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls + (t ? ' "' + t + '"' : "");
  }
  function visible(el, r, st) {
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) !== 0;
  }
  var els = Array.prototype.slice.call(document.querySelectorAll("body *"), 0, 4000);
  var interactive = [];
  els.forEach(function (el) {
    var r = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    if (!visible(el, r, st) || st.position === "fixed") return;
    var pr = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
    if (r.right > vw + 1 && (!pr || pr.right <= vw + 1) && issues.length < 40) {
      issues.push({ kind: "past-viewport", element: name(el), detail: "right edge at " + Math.round(r.right) + "px, viewport " + vw + "px" });
    }
    if (el.scrollWidth > el.clientWidth + 2 && (st.overflowX === "hidden" || st.overflow === "hidden") && st.textOverflow !== "ellipsis" && (el.innerText || "").trim() && issues.length < 40) {
      issues.push({ kind: "clipped-text", element: name(el), detail: "content " + el.scrollWidth + "px in a " + el.clientWidth + "px box" });
    }
    if (el.matches("a[href],button,input:not([type=hidden]),select,textarea,[role=button]")) {
      interactive.push({ el: el, r: r });
      if ((r.width < 24 || r.height < 24) && st.display !== "inline" && issues.length < 40) {
        issues.push({ kind: "small-tap-target", element: name(el), detail: Math.round(r.width) + "×" + Math.round(r.height) + "px" });
      }
    }
  });
  for (var a = 0; a < interactive.length && a < 200; a++) {
    for (var b = a + 1; b < interactive.length && b < 200; b++) {
      var A = interactive[a], B = interactive[b];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      var w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      var h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (w > 4 && h > 4 && issues.length < 40) issues.push({ kind: "overlap", element: name(A.el), detail: "overlaps " + name(B.el) + " by " + Math.round(w) + "×" + Math.round(h) + "px" });
    }
  }
  return { pageWidth: pageWidth, overflowX: Math.max(0, pageWidth - vw), issues: issues };
}
