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

// plugins/calm-name-effects/index.ts
var exports_calm_name_effects = {};
__export(exports_calm_name_effects, {
  default: () => calm_name_effects_default
});
module.exports = __toCommonJS(exports_calm_name_effects);
var import_api2 = require("@evi/api");

// plugins/calm-name-effects/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.animateOnHover": "Animate on hover",
    "settings.animateOnHover.description": "Play a name's effect while your pointer is on it. Off keeps every name still."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.animateOnHover": "Beim Darüberfahren animieren",
      "settings.animateOnHover.description": "Spielt den Effekt eines Namens ab, solange dein Mauszeiger darauf ist. Ausgeschaltet bleibt jeder Name statisch."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.animateOnHover": "Animar al pasar el cursor",
      "settings.animateOnHover.description": "Reproduce el efecto de un nombre mientras el cursor está encima. Desactivado, todos los nombres se quedan quietos."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.animateOnHover": "Animer au survol",
      "settings.animateOnHover.description": "Joue l'effet d'un pseudo tant que le pointeur est dessus. Désactivé, tous les pseudos restent immobiles."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.animateOnHover": "ホバー時にアニメーション",
      "settings.animateOnHover.description": "ポインターを重ねている間だけ、名前のエフェクトを再生します。オフにすると、すべての名前が静止したままになります。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.animateOnHover": "Animuj po najechaniu",
      "settings.animateOnHover.description": "Odtwarza efekt nazwy, gdy wskaźnik jest na niej. Po wyłączeniu wszystkie nazwy pozostają statyczne."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.animateOnHover": "Animar ao passar o mouse",
      "settings.animateOnHover.description": "Reproduz o efeito de um nome enquanto o ponteiro está sobre ele. Desativado, todos os nomes ficam parados."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.animateOnHover": "Анимация при наведении",
      "settings.animateOnHover.description": "Проигрывает эффект имени, пока курсор находится на нём. Если выключено, все имена остаются неподвижными."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.animateOnHover": "Üzerine gelince canlandır",
      "settings.animateOnHover.description": "İşaretçin üzerindeyken bir ismin efektini oynatır. Kapalıyken tüm isimler durağan kalır."
    } })["tr"];
  }
});

// plugins/calm-name-effects/index.ts
var settings = {
  animateOnHover: {
    type: "boolean",
    get label() {
      return t("settings.animateOnHover");
    },
    get description() {
      return t("settings.animateOnHover.description");
    },
    default: true
  }
};
var stylesFilter = Object.assign((v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((c) => typeof c === "string" && /^innerContainer_+[\w-]+$/.test(c)) && Object.values(v).some((c) => typeof c === "string" && /^gummyLetter_+[\w-]+$/.test(c)), { $code: ['"innerContainer_', '"gummyLetter_'], $label: "display name styles CSS module" });
function buildCss(classes, onHover) {
  const cls = (name) => Object.values(classes).find((c) => typeof c === "string" && new RegExp(`^${name}_+[\\w-]+$`).test(c));
  const animated = cls("animated"), inner = cls("innerContainer");
  if (!animated || !inner)
    return "";
  const scope = `.${animated}${onHover ? ":not(:hover)" : ""} .${inner}`;
  return `${[scope, `${scope} *`, `${scope}::before`, `${scope} *::before`, `${scope}::after`, `${scope} *::after`].join(`,
`)} {
    animation: none !important;
}`;
}
var styles;
var calm_name_effects_default = import_api2.definePlugin({
  settings,
  start(ctx) {
    const style = ctx.addStyle("");
    const apply = () => {
      if (styles)
        style.update(buildCss(styles, ctx.settings.get("animateOnHover")));
    };
    if (styles)
      apply();
    else
      ctx.waitFor(stylesFilter, (classes) => {
        styles = classes;
        apply();
      });
    ctx.settings.onChange(apply);
  }
});
