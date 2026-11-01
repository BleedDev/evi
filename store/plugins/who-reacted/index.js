var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
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

// plugins/who-reacted/index.tsx
var exports_who_reacted = {};
__export(exports_who_reacted, {
  default: () => who_reacted_default
});
module.exports = __toCommonJS(exports_who_reacted);
var import_api2 = require("@evi/api");

// plugins/who-reacted/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.max": "Avatars per reaction",
    "settings.max.description": "Past that, a reaction shows how many more reacted.",
    "settings.showExtra": "Show how many more",
    "settings.showExtra.description": "A +12 after the avatars when more people reacted than are shown."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.max": "Avatare pro Reaktion",
      "settings.max.description": "Darüber hinaus zeigt eine Reaktion an, wie viele weitere reagiert haben.",
      "settings.showExtra": "Anzahl weiterer anzeigen",
      "settings.showExtra.description": "Ein +12 hinter den Avataren, wenn mehr Leute reagiert haben, als angezeigt werden."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.max": "Avatares por reacción",
      "settings.max.description": "Si hay más, la reacción muestra cuántas personas más reaccionaron.",
      "settings.showExtra": "Mostrar cuántas más",
      "settings.showExtra.description": "Un +12 después de los avatares cuando reaccionaron más personas de las que se muestran."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.max": "Avatars par réaction",
      "settings.max.description": "Au-delà, la réaction indique combien d'autres personnes ont réagi.",
      "settings.showExtra": "Afficher combien d'autres",
      "settings.showExtra.description": "Un +12 après les avatars quand plus de personnes ont réagi que celles affichées."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.max": "リアクションごとのアバター数",
      "settings.max.description": "これを超えると、他に何人がリアクションしたかを表示します。",
      "settings.showExtra": "残りの人数を表示",
      "settings.showExtra.description": "表示しきれないほど多くの人がリアクションした場合、アバターの後ろに +12 のように表示します。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.max": "Awatary na reakcję",
      "settings.max.description": "Powyżej tej liczby reakcja pokazuje, ile jeszcze osób zareagowało.",
      "settings.showExtra": "Pokazuj, ile jeszcze",
      "settings.showExtra.description": "Np. +12 po awatarach, gdy zareagowało więcej osób, niż jest pokazanych."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.max": "Avatares por reação",
      "settings.max.description": "Acima disso, a reação mostra quantas pessoas a mais reagiram.",
      "settings.showExtra": "Mostrar quantas a mais",
      "settings.showExtra.description": "Um +12 depois dos avatares quando mais pessoas reagiram do que as mostradas."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.max": "Аватаров на реакцию",
      "settings.max.description": "Если реакций больше, показывается, сколько ещё людей отреагировали.",
      "settings.showExtra": "Показывать, сколько ещё",
      "settings.showExtra.description": "Например, +12 после аватаров, если отреагировало больше людей, чем показано."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.max": "Tepki başına avatar",
      "settings.max.description": "Bunun üstünde, tepki kaç kişinin daha tepki verdiğini gösterir.",
      "settings.showExtra": "Kaç kişi daha olduğunu göster",
      "settings.showExtra.description": "Gösterilenden fazla kişi tepki verdiğinde avatarların yanında +12 gibi bir sayı gösterir."
    } })["tr"];
  }
});

// plugins/who-reacted/queue.ts
var MINUTE = 60000;
var systemClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle)
};
function rateLimitWait(err) {
  if (err?.status !== 429)
    return;
  const header = err.headers?.["retry-after"] ?? err.headers?.["Retry-After"];
  const seconds = [err.retryAfter, err.body?.retry_after, typeof header === "string" ? parseFloat(header) : header].find((s) => typeof s === "number" && Number.isFinite(s) && s > 0);
  return seconds ? Math.ceil(seconds * 1000) : 0;
}
var isThenable = (value) => typeof value?.then === "function";

class FetchQueue {
  limits;
  clock;
  pending = new Map;
  running = new Map;
  done = new Set;
  sent = [];
  last = -Infinity;
  pausedUntil = -Infinity;
  strikes = 0;
  timer;
  generation = 0;
  constructor(limits, clock = systemClock) {
    this.limits = limits;
    this.clock = clock;
  }
  has(key) {
    return this.done.has(key);
  }
  add(key, job) {
    if (this.running.has(key))
      return void this.running.set(key, job);
    if (this.done.has(key) || this.pending.has(key))
      return;
    this.pending.set(key, job);
    this.schedule();
  }
  remove(key) {
    this.pending.delete(key);
    if (this.running.has(key))
      this.running.set(key, undefined);
  }
  clear() {
    this.pending.clear();
    this.running.clear();
    this.done.clear();
    this.sent.length = 0;
    this.last = this.pausedUntil = -Infinity;
    this.strikes = 0;
    this.generation++;
    this.stopTimer();
  }
  nextAt() {
    const { gapMs, perMinute } = this.limits;
    const capped = this.sent.length >= perMinute ? this.sent[this.sent.length - perMinute] + MINUTE : -Infinity;
    return Math.max(this.last + gapMs, capped, this.pausedUntil);
  }
  schedule() {
    if (this.timer !== undefined || !this.pending.size)
      return;
    this.timer = this.clock.setTimeout(() => this.next(), Math.max(0, this.nextAt() - this.clock.now()));
  }
  stopTimer() {
    if (this.timer !== undefined)
      this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
  next() {
    this.timer = undefined;
    const now = this.clock.now();
    if (now < this.nextAt())
      return this.schedule();
    const first = this.pending.entries().next();
    if (first.done)
      return;
    const [key, job] = first.value;
    this.pending.delete(key);
    this.done.add(key);
    this.last = now;
    this.sent.push(now);
    if (this.sent.length > this.limits.perMinute)
      this.sent.shift();
    let result;
    try {
      result = job();
    } finally {
      this.schedule();
    }
    if (!isThenable(result))
      return;
    const generation = this.generation;
    this.running.set(key, job);
    result.then(() => {
      if (generation !== this.generation)
        return;
      this.running.delete(key);
      this.strikes = 0;
    }, (err) => {
      if (generation === this.generation)
        this.failed(key, err);
    });
  }
  failed(key, err) {
    const job = this.running.get(key);
    this.running.delete(key);
    const wait = rateLimitWait(err);
    if (wait === undefined)
      return;
    const { backoffMs, maxBackoffMs } = this.limits;
    this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + Math.max(wait, Math.min(maxBackoffMs, backoffMs * 2 ** this.strikes)));
    this.strikes++;
    this.done.delete(key);
    if (job && !this.pending.has(key)) {
      const rest = [...this.pending];
      this.pending.clear();
      this.pending.set(key, job);
      for (const [k, j] of rest)
        this.pending.set(k, j);
    }
    this.stopTimer();
    this.schedule();
  }
}

// plugins/who-reacted/reactors.ts
var REACTION_VOTE = 2;
var reactionKey = (messageId, emoji, type) => `${messageId}:${emoji.name ?? ""}:${emoji.id ?? ""}:${type}`;
var shownCount = (props) => (props.type === 1 ? props.burst_count : props.count) ?? 0;
function pickReactors(users, count, max, hidden) {
  const shown = [];
  let known = 0, blocked = 0;
  for (const user of users) {
    known++;
    if (hidden(user.id))
      blocked++;
    else if (shown.length < max)
      shown.push(user);
  }
  return { shown, extra: Math.max(0, Math.max(count, known) - blocked - shown.length) };
}
var extraLabel = (extra) => extra > 99 ? "+99+" : `+${extra}`;
var FETCH_REACTORS = ['"MESSAGE_REACTION_ADD_USERS"', ".POLL_ANSWER_VOTERS("];
var PATCHES = {
  pill: {
    find: ".reactionCount,value:",
    replace: {
      match: /(?=\(0,\i\.jsx\)\(\i,\{count:\i,reactionRef:\i\}\))/,
      with: "$self?.renderUsers?.(arguments[0]),"
    }
  }
};

// plugins/who-reacted/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var settings = {
  max: { type: "number", get label() {
    return t("settings.max");
  }, get description() {
    return t("settings.max.description");
  }, default: 5, min: 1, max: 10, step: 1 },
  showExtra: { type: "boolean", get label() {
    return t("settings.showExtra");
  }, get description() {
    return t("settings.showExtra.description");
  }, default: true }
};
var FETCH_LIMIT = 10;
var context;
var queue = new FetchQueue({ gapMs: 1000, perMinute: 20, backoffMs: 30000, maxBackoffMs: 5 * 60000 });
function store(name) {
  try {
    return import_api2.findStore(name);
  } catch {
    return;
  }
}
var reactionsStore = () => store("MessageReactionsStore");
var asked = new Set;
function subscribe(onChange) {
  const s = reactionsStore();
  s?.addChangeListener?.(onChange);
  asked.add(onChange);
  return () => {
    s?.removeChangeListener?.(onChange);
    asked.delete(onChange);
  };
}
var asking;
var retries = new Map;
function lookUp(key, channelId, messageId, emoji, type) {
  const retry = retries.get(key);
  if (retry)
    return retry().then(() => void retries.delete(key), (err) => {
      if (rateLimitWait(err) === undefined)
        retries.delete(key);
      throw err;
    });
  const seen = {};
  asking = seen;
  try {
    reactionsStore()?.getReactions?.(channelId, messageId, emoji, FETCH_LIMIT, type);
  } finally {
    asking = undefined;
  }
  for (const listener of asked)
    listener();
  return seen.request?.catch((err) => {
    if (seen.again && rateLimitWait(err) !== undefined)
      retries.set(key, seen.again);
    throw err;
  });
}
var watched = new Map;
var observer;
function watch(el, onChange) {
  if (typeof IntersectionObserver !== "function") {
    onChange(true);
    return () => {};
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries)
      watched.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: "200px 0px" });
  watched.set(el, onChange);
  observer.observe(el);
  return () => {
    watched.delete(el);
    observer?.unobserve(el);
  };
}
function isHidden(id) {
  const relationships = store("RelationshipStore");
  return !!(relationships?.isBlockedOrIgnored?.(id) ?? relationships?.isBlocked?.(id));
}
var noSettings = () => {
  return;
};
var noSubscribe = () => () => {};
var useSettings = () => context ? context.settings.use() : import_api2.React.useSyncExternalStore(noSubscribe, noSettings);
function Reactors({ message, emoji, type = 0, count }) {
  const values = useSettings();
  const channelId = message.getChannelId();
  const key = reactionKey(message.id, emoji, type);
  const anchor = import_api2.React.useRef(null);
  import_api2.React.useEffect(() => {
    if (!context)
      return;
    const job = () => lookUp(key, channelId, message.id, emoji, type);
    const pill = anchor.current?.parentElement ?? anchor.current;
    const unwatch = pill ? watch(pill, (visible) => visible ? queue.add(key, job) : queue.remove(key)) : (queue.add(key, job), undefined);
    return () => {
      unwatch?.();
      queue.remove(key);
    };
  }, [key]);
  const ids = import_api2.React.useSyncExternalStore(subscribe, () => {
    if (!queue.has(key))
      return "";
    const users2 = reactionsStore()?.getReactions?.(channelId, message.id, emoji, FETCH_LIMIT, type);
    return users2 ? [...users2.keys()].join(",") : "";
  });
  if (!values)
    return null;
  const { max, showExtra } = values;
  const users = ids ? ids.split(",").map((id) => ({ id })) : [];
  const { shown, extra } = pickReactors(users, count, max, isHidden);
  const guildId = shown.length ? store("ChannelStore")?.getChannel?.(channelId)?.getGuildId?.() : undefined;
  const userStore = shown.length ? store("UserStore") : undefined;
  return /* @__PURE__ */ jsx_runtime.jsxs("span", {
    ref: anchor,
    className: "evi-who-reacted",
    "aria-hidden": "true",
    children: [
      shown.map(({ id }) => {
        const src = userStore?.getUser?.(id)?.getAvatarURL?.(guildId ?? undefined, 32);
        return src ? /* @__PURE__ */ jsx_runtime.jsx("img", {
          className: "evi-who-reacted-avatar",
          src,
          alt: "",
          draggable: false
        }, id) : null;
      }),
      showExtra && shown.length > 0 && extra > 0 && /* @__PURE__ */ jsx_runtime.jsx("span", {
        className: "evi-who-reacted-extra",
        children: extraLabel(extra)
      })
    ]
  });
}
var who_reacted_default = import_api2.definePlugin({
  settings,
  patches: [PATCHES.pill],
  renderUsers(props) {
    try {
      if (!context || !props?.message?.id || !props.emoji || props.hideCount || props.type === REACTION_VOTE)
        return null;
      const count = shownCount(props);
      if (!count)
        return null;
      return /* @__PURE__ */ jsx_runtime.jsx(Reactors, {
        message: props.message,
        emoji: props.emoji,
        type: props.type,
        count
      });
    } catch (err) {
      context?.logger.error("Couldn't draw who reacted", err);
      return null;
    }
  },
  css: `
        .evi-who-reacted { display: inline-flex; align-items: center; margin-inline-start: 6px; pointer-events: none; }
        .evi-who-reacted:empty { margin-inline-start: 0; }
        .evi-who-reacted-avatar { inline-size: 16px; block-size: 16px; border-radius: 50%; object-fit: cover;
            box-shadow: 0 0 0 1.5px var(--background-base-lower, var(--background-primary, #1e1f22)); }
        .evi-who-reacted-avatar + .evi-who-reacted-avatar { margin-inline-start: -4px; }
        .evi-who-reacted-extra { margin-inline-start: 4px; color: var(--text-muted, #949ba4); font-size: 12px; font-weight: 600;
            font-variant-numeric: tabular-nums; }
    `,
  start(ctx) {
    context = ctx;
    ctx.hookExport("after", import_api2.filters.byCode(...FETCH_REACTORS), (call) => {
      if (!asking)
        return;
      const { original, self, args } = call;
      asking.request = Promise.resolve(call.result);
      asking.again = () => Promise.resolve(original.apply(self, args));
    });
    ctx.onDispose(() => {
      context = undefined;
      queue.clear();
      retries.clear();
      observer?.disconnect();
      observer = undefined;
      watched.clear();
    });
  }
});
