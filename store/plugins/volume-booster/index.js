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

// plugins/volume-booster/index.ts
var exports_volume_booster = {};
__export(exports_volume_booster, {
  default: () => volume_booster_default
});
module.exports = __toCommonJS(exports_volume_booster);
var import_api2 = require("@evi/api");

// plugins/volume-booster/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.multiplier": "Volume limit",
    "settings.multiplier.description": "How far past Discord's maximum the volume goes: 2 allows up to twice it, 5 up to five times (the slider then ends at 300% or 433%). Very high volumes clip and distort."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.multiplier": "Lautstärkegrenze",
      "settings.multiplier.description": "Wie weit die Lautstärke über Discords Maximum hinausgeht: 2 erlaubt bis zum Doppelten, 5 bis zum Fünffachen (der Regler endet dann bei 300 % bzw. 433 %). Sehr hohe Lautstärken übersteuern und verzerren."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.multiplier": "Límite de volumen",
      "settings.multiplier.description": "Cuánto puede pasar el volumen del máximo de Discord: 2 permite hasta el doble y 5 hasta cinco veces más (el control deslizante llega entonces al 300 % o al 433 %). Los volúmenes muy altos saturan y distorsionan."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.multiplier": "Limite de volume",
      "settings.multiplier.description": "Jusqu'où le volume peut dépasser le maximum de Discord : 2 permet jusqu'au double, 5 jusqu'à cinq fois plus (le curseur s'arrête alors à 300 % ou 433 %). Un volume très élevé sature et déforme le son."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.multiplier": "音量の上限",
      "settings.multiplier.description": "音量をDiscordの上限からどこまで上げられるか。2なら最大2倍、5なら最大5倍です(スライダーの上限はそれぞれ300%、433%になります)。音量が大きすぎると音割れして歪みます。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.multiplier": "Limit głośności",
      "settings.multiplier.description": "O ile głośność może przekroczyć maksimum Discorda: 2 pozwala najwyżej na dwukrotność, 5 na pięciokrotność (suwak kończy się wtedy na 300% lub 433%). Bardzo wysoka głośność powoduje przesterowanie i zniekształcenia."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.multiplier": "Limite de volume",
      "settings.multiplier.description": "Até onde o volume passa do máximo do Discord: 2 permite até o dobro, 5 até cinco vezes (o controle então termina em 300% ou 433%). Volumes muito altos estouram e distorcem o som."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.multiplier": "Предел громкости",
      "settings.multiplier.description": "Насколько громкость может превысить максимум Discord: 2 — не больше чем вдвое, 5 — не больше чем в пять раз (ползунок тогда заканчивается на 300% или 433%). Очень высокая громкость приводит к искажениям и хрипам."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.multiplier": "Ses sınırı",
      "settings.multiplier.description": "Sesin Discord'un en yüksek seviyesini ne kadar aşabileceği: 2 en fazla iki katına, 5 en fazla beş katına izin verir (kaydırıcı o zaman %300 veya %433'te biter). Çok yüksek sesler patlar ve bozulur."
    } })["tr"];
  }
});

// plugins/volume-booster/volume.ts
var DISCORD_MAX = 200;
var DEFAULT_MULTIPLIER = 2;
var MIN_MULTIPLIER = 1;
var MAX_MULTIPLIER = 5;
function clampMultiplier(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n))
    return DEFAULT_MULTIPLIER;
  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, n));
}
function maxAmplitude(multiplier) {
  return DISCORD_MAX * clampMultiplier(multiplier);
}
function capVolume(volume, multiplier) {
  const max = maxAmplitude(multiplier);
  return typeof volume === "number" && volume > max ? max : volume;
}
function sliderToAmplitude(slider, base = 100) {
  if (slider === 0)
    return 0;
  const n = slider / base;
  return (n < 1 ? Math.pow(n, 2.8) : Math.pow(10, (n - 1) * 6 / 20)) * base;
}
function amplitudeToSlider(amplitude, base = 100) {
  if (amplitude === 0)
    return 0;
  const n = amplitude / base;
  return (n < 1 ? Math.pow(n, 1 / 2.8) : 20 * Math.log10(n) / 6 + 1) * base;
}
var DISCORD_MAX_AMPLITUDE = sliderToAmplitude(DISCORD_MAX);
function sliderMax(discordMax, multiplier) {
  if (typeof discordMax !== "number" || !Number.isFinite(discordMax))
    return discordMax;
  return Math.max(discordMax, Math.floor(amplitudeToSlider(discordMax * clampMultiplier(multiplier))));
}
function clampSynced(volume) {
  return typeof volume === "number" && volume > DISCORD_MAX ? DISCORD_MAX : volume;
}
function keepBoosted(local, synced) {
  return typeof local === "number" && local > DISCORD_MAX && synced === DISCORD_MAX;
}
var guard = (fn, ...args) => `($self?.${fn}?.(${args.join(",")})??${args[0]})`;
var PATCHES = {
  userVolumeMenu: {
    find: '"user-volume",label:',
    replace: {
      match: /(?<=maxValue:\i\.isPlatformEmbedded\?)([^:,]+)(?=:)/,
      with: guard("sliderMax", "$1")
    }
  },
  streamTile: {
    find: "isPlatformEmbedded?200:100,onValueChange",
    replace: {
      match: /(?<=maxValue:\i\.isPlatformEmbedded\?)(200)(?=:100,onValueChange)/,
      with: guard("sliderMax", "$1")
    }
  },
  capLocalVolume: {
    find: "AUDIO_SET_LOCAL_VOLUME:function",
    replace: {
      match: /(AUDIO_SET_LOCAL_VOLUME:function\((\i)\)\{let\{context:\i,userId:\i,volume:(\i)\}=\2;)/,
      with: "$1$3=$self?.capVolume?.($3)??$3;"
    }
  },
  syncWrite: {
    find: "AudioContextSettingsMigrated",
    replace: [
      {
        match: /(?<=localVolumes\)\).{0,80}?volume:)\(0,\i\.\i\)\(\i,\i\)/,
        with: guard("clampSynced", "$&")
      },
      {
        match: /(?<=isLocalMute\(\i,\i\),volume:)(\i)(?=\}\))/,
        with: guard("clampSynced", "$1")
      },
      {
        match: /(?<=\(0,\i\.\i\)\(\i,\i,\{volume:)(\i)(?=\})/,
        with: guard("clampSynced", "$1")
      }
    ]
  },
  syncRead: {
    find: "audioContextSettings??{user:{},stream:{}}",
    replace: {
      match: /(\i)\.volume!==(\i)\?(\i)\[(\i)\]=\1\.volume:delete \3\[\4\],(\i\.eachConnection\(\i=>\{\i\.setLocalVolume\(\4,)\1\.volume\)/,
      with: "($self?.keepBoosted?.($3[$4],$1.volume)||($1.volume!==$2?$3[$4]=$1.volume:delete $3[$4])),$5$3[$4]??$2)"
    }
  }
};

// plugins/volume-booster/index.ts
var audioActions = import_api2.filters.byProps("setLocalVolume", "toggleLocalMute", "toggleSelfDeaf");
var running = false;
var multiplier = DEFAULT_MULTIPLIER;
function lowerAbove(max) {
  try {
    const state = import_api2.getStore("MediaEngineStore")?.getState?.();
    const actions = import_api2.find(audioActions);
    if (!state?.settingsByContext || !actions)
      return;
    for (const [context, settings] of Object.entries(state.settingsByContext)) {
      for (const [userId, volume] of Object.entries(settings?.localVolumes ?? {})) {
        if (typeof volume === "number" && volume > max)
          actions.setLocalVolume(userId, max, context);
      }
    }
  } catch {}
}
var volume_booster_default = import_api2.definePlugin({
  settings: {
    multiplier: {
      type: "number",
      get label() {
        return t("settings.multiplier");
      },
      get description() {
        return t("settings.multiplier.description");
      },
      default: DEFAULT_MULTIPLIER,
      min: MIN_MULTIPLIER,
      max: MAX_MULTIPLIER,
      step: 0.5
    }
  },
  patches: [PATCHES.userVolumeMenu, PATCHES.streamTile, PATCHES.capLocalVolume, PATCHES.syncWrite, PATCHES.syncRead],
  sliderMax: (discordMax) => running ? sliderMax(discordMax, multiplier) : discordMax,
  capVolume: (volume) => running ? capVolume(volume, multiplier) : volume,
  clampSynced,
  keepBoosted: (local, synced) => running && keepBoosted(local, synced),
  start(ctx) {
    multiplier = clampMultiplier(ctx.settings.get("multiplier"));
    running = true;
    lowerAbove(maxAmplitude(multiplier));
    ctx.settings.onChange((values) => {
      multiplier = clampMultiplier(values.multiplier);
      lowerAbove(maxAmplitude(multiplier));
    });
    ctx.onDispose(() => {
      running = false;
      lowerAbove(DISCORD_MAX_AMPLITUDE);
    });
  }
});
