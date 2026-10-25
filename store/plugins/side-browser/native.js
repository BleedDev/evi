var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// plugins/side-browser/native.ts
var exports_native = {};
__export(exports_native, {
  default: () => native_default
});
module.exports = __toCommonJS(exports_native);
var electron = __toESM(require("electron"));
var import_electron = require("electron");

// plugins/side-browser/links.ts
var DISCORD_HOSTS = [
  "discord.com",
  "discordapp.com",
  "discord.gg",
  "discord.gift",
  "discord.new",
  "discord.co",
  "discordapp.net",
  "discord.media",
  "discord.dev",
  "dis.gd"
];
var MAX_URL = 8192;
function hostMatches(host, rule) {
  host = host.toLowerCase().replace(/\.$/, "");
  rule = rule.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return !!rule && (host === rule || host.endsWith("." + rule));
}
function isDiscordHost(host) {
  return DISCORD_HOSTS.some((rule) => hostMatches(host, rule));
}
function classifyUrl(raw) {
  if (typeof raw !== "string" || !raw || raw.length > MAX_URL)
    return { kind: "refused" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "refused" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { kind: "refused" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host)
    return { kind: "refused" };
  return { kind: isDiscordHost(host) ? "discord" : "web", href: url.href, host };
}
function toViewBounds(raw, content, fallbackScale = 1) {
  if (!raw || typeof raw !== "object")
    return null;
  const b = raw;
  const nums = [b.x, b.y, b.width, b.height].map(Number);
  if (nums.some((n) => !Number.isFinite(n)))
    return null;
  const [x, y, width, height] = nums;
  const viewport = Number(b.viewportWidth);
  let scale = viewport > 0 && Number.isFinite(viewport) ? content.width / viewport : fallbackScale;
  if (!Number.isFinite(scale) || scale <= 0)
    scale = 1;
  scale = Math.min(5, Math.max(0.2, scale));
  const left = Math.max(0, Math.round(x * scale));
  const top = Math.max(0, Math.round(y * scale));
  const right = Math.min(content.width, Math.round((x + width) * scale));
  const bottom = Math.min(content.height, Math.round((y + height) * scale));
  if (right - left < 1 || bottom - top < 1)
    return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// plugins/side-browser/native.ts
var PARTITION = "evi-side-browser";
var SNAPSHOT_TIMEOUT_MS = 250;
var LABEL_KEYS = ["back", "forward", "reload", "cut", "copy", "paste", "copyLink", "openLink", "openPage", "failed"];
var ctx = null;
var holder = null;
var wanted = false;
var bounds = null;
var shown = false;
var failedUrl = null;
var labels = {
  back: "Back",
  forward: "Forward",
  reload: "Reload",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  copyLink: "Copy Link",
  openLink: "Open Link in Browser",
  openPage: "Open in Browser",
  failed: "This page couldn't be opened."
};
var preparedSession = null;
var lastExternal = 0;
var unhookWindow = null;
var events = [];
var waiting = null;
function push(event) {
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(event);
    return;
  }
  if (event.type === "state" && events[events.length - 1]?.type === "state")
    events[events.length - 1] = event;
  else
    events.push(event);
  if (events.length > 20)
    events.shift();
}
function discordWindow() {
  const id = globalThis.mainWindowId;
  const main = typeof id === "number" ? import_electron.BrowserWindow.fromId(id) : null;
  return main && !main.isDestroyed() ? main : null;
}
function currentUrl(wc) {
  if (failedUrl)
    return failedUrl;
  const url = wc.getURL();
  return classifyUrl(url).kind === "refused" ? "" : url;
}
function canGo(wc, direction) {
  const history = wc.navigationHistory;
  return !!(history?.[`canGo${direction}`]?.() ?? wc[`canGo${direction}`]?.() ?? false);
}
function stateOf(wc) {
  const url = currentUrl(wc);
  return {
    type: "state",
    url,
    title: failedUrl || !url ? "" : wc.getTitle(),
    canGoBack: canGo(wc, "Back"),
    canGoForward: canGo(wc, "Forward"),
    loading: wc.isLoading()
  };
}
function cleanUserAgent(agent) {
  return agent.replace(/\s(?:Electron|discord)\/\S+/gi, "");
}
function onDownload(event, item) {
  event.preventDefault();
  const link = classifyUrl(item.getURL());
  if (link.kind !== "web" || Date.now() - lastExternal < 1000)
    return;
  lastExternal = Date.now();
  import_electron.shell.openExternal(link.href).catch(() => {});
  push({ type: "download", url: link.href });
}
function prepareSession() {
  const ses = import_electron.session.fromPartition(PARTITION);
  if (preparedSession === ses)
    return ses;
  preparedSession = ses;
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "clipboard-sanitized-write"));
  ses.setPermissionCheckHandler((_wc, permission) => permission === "clipboard-sanitized-write");
  ses.setDevicePermissionHandler?.(() => false);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  ses.on("will-download", onDownload);
  return ses;
}
function createHolder(win, background) {
  const ses = prepareSession();
  const webPreferences = {
    session: ses,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webviewTag: false,
    safeDialogs: true,
    navigateOnDragDrop: false,
    devTools: false,
    autoplayPolicy: "document-user-activation-required"
  };
  const WebContentsView2 = electron.WebContentsView;
  if (typeof WebContentsView2 === "function" && win.contentView) {
    const view2 = new WebContentsView2({ webPreferences });
    view2.setVisible(false);
    if (background)
      view2.setBackgroundColor?.(background);
    win.contentView.addChildView(view2);
    return {
      wc: view2.webContents,
      win,
      setBounds: (rect2) => view2.setBounds(rect2),
      setVisible: (visible2) => view2.setVisible(visible2),
      destroy() {
        try {
          if (!win.isDestroyed())
            win.contentView.removeChildView(view2);
        } catch {}
        if (!view2.webContents.isDestroyed())
          view2.webContents.close();
      }
    };
  }
  const BrowserView2 = electron.BrowserView;
  const view = new BrowserView2({ webPreferences });
  if (background)
    view.setBackgroundColor?.(background);
  win.addBrowserView(view);
  let visible = false;
  let rect = { x: 0, y: 0, width: 0, height: 0 };
  const apply = () => view.setBounds(visible ? rect : { x: 0, y: 0, width: 0, height: 0 });
  apply();
  return {
    wc: view.webContents,
    win,
    setBounds: (next) => void (rect = next, apply()),
    setVisible: (next) => void (visible = next, apply()),
    destroy() {
      try {
        if (!win.isDestroyed())
          win.removeBrowserView(view);
      } catch {}
      if (!view.webContents.isDestroyed())
        view.webContents.close?.();
    }
  };
}
function apply() {
  if (!holder)
    return;
  const { win, wc } = holder;
  const next = wanted && !!bounds && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  if (next === shown)
    return;
  shown = next;
  if (bounds)
    holder.setBounds(bounds);
  holder.setVisible(next);
  if (!next && !wc.isDestroyed() && wc.isFocused() && !win.isDestroyed())
    win.webContents.focus();
}
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function errorPage(description) {
  return "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;font:14px/1.4 system-ui,sans-serif;color:#80848e;text-align:center;padding:24px;box-sizing:border-box}b{display:block;margin-bottom:4px;color:CanvasText;font-size:16px}</style>
<div><b>${escapeHtml(labels.failed)}</b>${escapeHtml(description)}</div>`);
}
function guardNavigation(event, legacyUrl) {
  if (event.isMainFrame === false)
    return;
  const target = event.url ?? legacyUrl;
  const link = classifyUrl(target);
  if (link.kind === "web")
    return;
  event.preventDefault();
  if (link.kind === "discord")
    push({ type: "discord", url: link.href });
}
function popupMenu(wc, win, params) {
  const items = [];
  const link = params.linkURL ? classifyUrl(params.linkURL) : null;
  if (link && link.kind !== "refused") {
    items.push({ label: labels.openLink, click: () => void import_electron.shell.openExternal(link.href).catch(() => {}) }, { label: labels.copyLink, click: () => import_electron.clipboard.writeText(link.href) }, { type: "separator" });
  }
  if (params.isEditable) {
    items.push({ label: labels.cut, role: "cut", enabled: params.editFlags.canCut }, { label: labels.copy, role: "copy", enabled: params.editFlags.canCopy }, { label: labels.paste, role: "paste", enabled: params.editFlags.canPaste }, { type: "separator" });
  } else if (params.selectionText.trim()) {
    items.push({ label: labels.copy, role: "copy" }, { type: "separator" });
  }
  items.push({ label: labels.back, enabled: canGo(wc, "Back"), click: () => go("back") }, { label: labels.forward, enabled: canGo(wc, "Forward"), click: () => go("forward") }, { label: labels.reload, click: () => go("reload") });
  const page = classifyUrl(currentUrl(wc));
  if (page.kind === "web")
    items.push({ type: "separator" }, { label: labels.openPage, click: () => void import_electron.shell.openExternal(page.href).catch(() => {}) });
  import_electron.Menu.buildFromTemplate(items).popup({ window: win });
}
function wire(h) {
  const { wc, win } = h;
  const state = () => {
    if (holder === h && !wc.isDestroyed())
      push(stateOf(wc));
  };
  wc.setWindowOpenHandler(({ url }) => {
    const link = classifyUrl(url);
    if (link.kind === "web")
      setImmediate(() => holder === h && load(link.href));
    else if (link.kind === "discord")
      push({ type: "discord", url: link.href });
    return { action: "deny" };
  });
  wc.on("will-navigate", guardNavigation);
  wc.on("will-redirect", guardNavigation);
  wc.on("did-start-loading", state);
  wc.on("did-stop-loading", state);
  wc.on("did-navigate", state);
  wc.on("did-navigate-in-page", state);
  wc.on("page-title-updated", state);
  wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || holder !== h)
      return;
    failedUrl = url || failedUrl;
    wc.loadURL(errorPage(description || String(code))).catch(() => {});
    state();
  });
  wc.on("render-process-gone", () => {
    if (holder !== h)
      return;
    const url = currentUrl(wc);
    destroyView();
    push({ type: "gone", url });
  });
  wc.on("context-menu", (_event, params) => popupMenu(wc, win, params));
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown")
      return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    const action = input.alt && input.key === "ArrowLeft" ? "back" : input.alt && input.key === "ArrowRight" ? "forward" : input.key === "F5" || mod && input.key.toLowerCase() === "r" ? "reload" : null;
    if (!action)
      return;
    event.preventDefault();
    go(action);
  });
  const onWindow = () => apply();
  const onClosed = () => destroyView();
  const onDiscordNavigation = (details, _url, inPlace, mainFrame) => {
    const isMain = details?.isMainFrame ?? mainFrame;
    const sameDocument = details?.isSameDocument ?? inPlace;
    if (isMain && !sameDocument)
      destroyView();
  };
  win.on("minimize", onWindow);
  win.on("restore", onWindow);
  win.on("hide", onWindow);
  win.on("show", onWindow);
  win.on("closed", onClosed);
  const discord = win.webContents;
  discord.on("did-start-navigation", onDiscordNavigation);
  discord.on("render-process-gone", onClosed);
  unhookWindow = () => {
    if (!win.isDestroyed()) {
      win.removeListener("minimize", onWindow);
      win.removeListener("restore", onWindow);
      win.removeListener("hide", onWindow);
      win.removeListener("show", onWindow);
      win.removeListener("closed", onClosed);
    }
    if (!discord.isDestroyed()) {
      discord.removeListener("did-start-navigation", onDiscordNavigation);
      discord.removeListener("render-process-gone", onClosed);
    }
  };
}
function destroyView() {
  const h = holder;
  holder = null;
  shown = false;
  wanted = false;
  bounds = null;
  failedUrl = null;
  unhookWindow?.();
  unhookWindow = null;
  if (!h)
    return;
  const focused = !h.wc.isDestroyed() && h.wc.isFocused();
  try {
    h.destroy();
  } catch (err) {
    console.error("[Side Browser] Couldn't close the page", err);
  }
  if (focused && !h.win.isDestroyed())
    h.win.webContents.focus();
}
function load(href) {
  if (!holder)
    return;
  failedUrl = null;
  holder.wc.loadURL(href).catch(() => {});
}
function go(action) {
  const wc = holder?.wc;
  if (!wc || wc.isDestroyed())
    return;
  const history = wc.navigationHistory;
  if (action === "back") {
    failedUrl = null;
    history?.goBack ? history.goBack() : wc.goBack?.();
  } else if (action === "forward") {
    failedUrl = null;
    history?.goForward ? history.goForward() : wc.goForward?.();
  } else if (action === "reload") {
    if (failedUrl)
      load(failedUrl);
    else
      wc.reload();
  } else if (action === "stop") {
    wc.stop();
  }
}
function cleanLabels(raw) {
  if (!raw || typeof raw !== "object")
    return;
  const next = { ...labels };
  for (const key of LABEL_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim())
      next[key] = value.slice(0, 200);
  }
  labels = next;
}
function cleanColor(raw) {
  if (typeof raw !== "string")
    return;
  const color = raw.trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*)?\)$/i.test(color) ? color : undefined;
}
var native_default = {
  start(context) {
    ctx = context;
  },
  stop() {
    destroyView();
    if (preparedSession)
      preparedSession.removeListener("will-download", onDownload);
    preparedSession = null;
    events = [];
    waiting?.(null);
    waiting = null;
    ctx = null;
  },
  open(url, options) {
    const link = classifyUrl(url);
    if (!ctx || link.kind !== "web")
      return false;
    const opts = options ?? {};
    cleanLabels(opts.labels);
    if (!holder) {
      const win = discordWindow();
      if (!win)
        return false;
      holder = createHolder(win, cleanColor(opts.background));
      shown = false;
      wire(holder);
    }
    load(link.href);
    push(stateOf(holder.wc));
    return true;
  },
  go(action) {
    go(action);
  },
  setBounds(raw) {
    if (!holder || holder.win.isDestroyed())
      return;
    const content = holder.win.getContentBounds();
    const next = toViewBounds(raw, content, holder.win.webContents.getZoomFactor());
    if (!next) {
      bounds = null;
      apply();
      return;
    }
    bounds = next;
    holder.setBounds(next);
    apply();
  },
  setVisible(visible) {
    wanted = visible === true;
    apply();
  },
  async snapshot() {
    const wc = holder?.wc;
    if (!wc || wc.isDestroyed() || !shown)
      return null;
    try {
      const image = await Promise.race([
        wc.capturePage(),
        new Promise((resolve) => setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS))
      ]);
      if (!image || image.isEmpty())
        return null;
      return "data:image/jpeg;base64," + image.toJPEG(85).toString("base64");
    } catch {
      return null;
    }
  },
  close() {
    destroyView();
  },
  openExternal(url) {
    const link = classifyUrl(url);
    if (link.kind === "refused")
      return false;
    import_electron.shell.openExternal(link.href).catch(() => {});
    return true;
  },
  state() {
    return holder && !holder.wc.isDestroyed() ? stateOf(holder.wc) : null;
  },
  nextEvent() {
    waiting?.(null);
    waiting = null;
    const next = events.shift();
    if (next)
      return Promise.resolve(next);
    return new Promise((resolve) => waiting = resolve);
  },
  cancelWait() {
    waiting?.(null);
    waiting = null;
  }
};
