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

// plugins/dm-categories/index.tsx
var exports_dm_categories = {};
__export(exports_dm_categories, {
  default: () => dm_categories_default
});
module.exports = __toCommonJS(exports_dm_categories);
var import_api2 = require("@evi/api");

// plugins/dm-categories/categories.ts
var EMPTY = { categories: [] };
var MAX_NAME_LENGTH = 32;
var MAX_CATEGORIES = 50;
var MAX_CHANNELS = 2000;
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function cleanName(name) {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) : "";
}
function parseState(raw) {
  const list = raw?.categories;
  if (!Array.isArray(list))
    return EMPTY;
  const ids = new Set;
  const seen = new Set;
  const categories = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || categories.length >= MAX_CATEGORIES)
      continue;
    const { id, name, collapsed, channels } = item;
    const clean = cleanName(name);
    if (typeof id !== "string" || !id || ids.has(id) || !clean)
      continue;
    ids.add(id);
    const kept = [];
    for (const channel of Array.isArray(channels) ? channels : []) {
      if (typeof channel !== "string" || !/^\d{1,20}$/.test(channel) || seen.has(channel) || seen.size >= MAX_CHANNELS)
        continue;
      seen.add(channel);
      kept.push(channel);
    }
    categories.push({ id, name: clean, collapsed: collapsed === true, channels: kept });
  }
  return categories.length ? { categories } : EMPTY;
}
var getCategory = (state, id) => id ? state.categories.find((c) => c.id === id) : undefined;
var categoryOf = (state, channelId) => state.categories.find((c) => c.channels.includes(channelId));
function nameError(state, name, exceptId) {
  const clean = cleanName(name);
  if (!clean)
    return "empty";
  const taken = state.categories.some((c) => c.id !== exceptId && c.name.toLowerCase() === clean.toLowerCase());
  return taken ? "taken" : null;
}
function update(state, id, change) {
  let changed = false;
  const categories = state.categories.map((c) => {
    if (c.id !== id)
      return c;
    const next = change(c);
    if (next !== c)
      changed = true;
    return next;
  });
  return changed ? { categories } : state;
}
function createCategory(state, name, id = makeId()) {
  if (nameError(state, name) || getCategory(state, id) || state.categories.length >= MAX_CATEGORIES)
    return { state };
  const category = { id, name: cleanName(name), collapsed: false, channels: [] };
  return { state: { categories: [...state.categories, category] }, category };
}
function renameCategory(state, id, name) {
  if (nameError(state, name, id))
    return state;
  const clean = cleanName(name);
  return update(state, id, (c) => c.name === clean ? c : { ...c, name: clean });
}
function deleteCategory(state, id) {
  if (!getCategory(state, id))
    return state;
  const categories = state.categories.filter((c) => c.id !== id);
  return categories.length ? { categories } : EMPTY;
}
function moveCategory(state, id, by) {
  const from = state.categories.findIndex((c) => c.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= state.categories.length || to === from)
    return state;
  const categories = [...state.categories];
  const [moved] = categories.splice(from, 1);
  categories.splice(to, 0, moved);
  return { categories };
}
function setCollapsed(state, id, collapsed) {
  return update(state, id, (c) => c.collapsed === collapsed ? c : { ...c, collapsed });
}
function assign(state, channelId, categoryId) {
  const current = categoryOf(state, channelId);
  if ((current?.id ?? null) === categoryId)
    return state;
  if (categoryId && !getCategory(state, categoryId))
    return state;
  let total = 0;
  for (const c of state.categories)
    total += c.channels.length;
  const full = !current && total >= MAX_CHANNELS;
  const categories = state.categories.map((c) => {
    let channels = c.channels;
    if (c.id === current?.id)
      channels = channels.filter((id) => id !== channelId);
    if (c.id === categoryId)
      channels = [channelId, ...channels];
    return channels === c.channels ? c : { ...c, channels };
  });
  if (full) {
    const biggest = categories.reduce((a, b) => b.channels.length > a.channels.length ? b : a);
    const i = categories.indexOf(biggest);
    categories[i] = { ...biggest, channels: biggest.channels.slice(0, -1) };
  }
  return { categories };
}
var PLAIN = { plain: true, categories: [], rest: [] };
function layout(ids, state, compare, keep) {
  if (!state.categories.length || !ids.length)
    return PLAIN;
  const index = new Map;
  ids.forEach((id, i) => index.set(id, i));
  const grouped = new Set;
  const categories = state.categories.map((category) => {
    const rows = [];
    for (const id of category.channels) {
      const i = index.get(id);
      if (i === undefined || grouped.has(i))
        continue;
      grouped.add(i);
      rows.push(i);
    }
    rows.sort(compare ? (a, b) => compare(ids[a], ids[b]) || a - b : (a, b) => a - b);
    const shown = category.collapsed ? keep ? rows.filter((i) => keep(ids[i])) : [] : rows;
    return { category, rows: shown, size: rows.length };
  });
  const rest = [];
  for (let i = 0;i < ids.length; i++)
    if (!grouped.has(i))
      rest.push(i);
  return { plain: false, categories, rest };
}
function sectionSizes(l, pinnedRows, dmCount) {
  if (l.plain)
    return [pinnedRows, Math.max(dmCount, 1)];
  return [pinnedRows, ...l.categories.map((c) => Math.max(c.rows.length, 1)), l.rest.length];
}
var isPlaceholder = (l, section, row) => !l.plain && row === 0 && l.categories[section - 1]?.rows.length === 0;
var sectionCategory = (l, section) => l.plain ? undefined : l.categories[section - 1];
function rowIndex(l, section, row) {
  if (l.plain || section === 0)
    return;
  const category = l.categories[section - 1];
  if (category)
    return category.rows[row] ?? -1;
  return section === l.categories.length + 1 ? l.rest[row] ?? -1 : -1;
}
function locate(l, ids, channelId) {
  const i = ids.indexOf(channelId);
  if (l.plain || i < 0)
    return;
  for (let s = 0;s < l.categories.length; s++) {
    const { category, rows } = l.categories[s];
    const row2 = rows.indexOf(i);
    if (row2 >= 0)
      return { section: s + 1, row: row2 };
    if (category.collapsed && category.channels.includes(channelId))
      return "collapsed";
  }
  const row = l.rest.indexOf(i);
  return row >= 0 ? { section: l.categories.length + 1, row } : undefined;
}
function rowOffset(l, ids, channelId, sizes, padding, sectionHeight, rowHeight) {
  const where = locate(l, ids, channelId);
  if (!where || where === "collapsed")
    return where;
  let top = padding;
  for (let s = 0;s <= where.section; s++) {
    top += sectionHeight(s);
    const rows = s === where.section ? where.row : sizes[s] ?? 0;
    for (let r = 0;r < rows; r++)
      top += rowHeight(s, r);
  }
  return { top, height: rowHeight(where.section, where.row) };
}
var LIST_PATCH = {
  find: '"no-private-channels"',
  group: true,
  replace: [
    {
      match: /sections:\[(\i),Math\.max\((\i)\.length,1\)\]/,
      with: "sections:$self?.sections?.(this,$2,$1)??[$1,Math.max($2.length,1)]"
    },
    {
      match: /renderRow=(\i)=>\{let\{section:(\i),row:(\i)\}=\1,\{privateChannelIds:\i\}=this\.props;/,
      with: "$&{let eviRow=$self?.rowIndex?.($2,$3);if(eviRow!==void 0)return eviRow<0?null:this.renderDM($2,eviRow)}"
    },
    {
      match: /renderSection=(\i)=>\{let\{section:(\i)\}=\1;/,
      with: "$&{let eviHeader=$self?.renderSection?.($2);if(eviHeader!==void 0)return eviHeader}"
    },
    {
      match: /getSectionHeight=(\i)=>(24\*\(0!==\1\))/,
      with: "getSectionHeight=$1=>$self?.sectionHeight?.($1)??$2"
    },
    {
      match: /getRowHeight=\((\i),(\i)\)=>\{/,
      with: "$&{let eviHeight=$self?.rowHeight?.($1,$2);if(eviHeight!==void 0)return eviHeight}"
    },
    {
      match: /scrollToChannel\((\i)\)\{/,
      with: "$&if($self?.scrollToChannel?.(this,$1))return;"
    }
  ]
};

// plugins/dm-categories/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.order": "Order inside categories",
    "settings.order.recent": "Latest message first, like Direct Messages",
    "settings.order.name": "By name",
    "settings.showCounts": "Show counts",
    "settings.showCounts.description": "How many DMs each category holds, next to its name.",
    "menu.rename": "Rename Category",
    "menu.moveUp": "Move Up",
    "menu.moveDown": "Move Down",
    "menu.new": "New Category",
    "menu.delete": "Delete Category",
    "menu.delete.subtext": "Its DMs go back to Direct Messages",
    "menu.addNew": "Add to New Category",
    "menu.addTo": "Add to Category",
    "menu.moveTo": "Move to Category",
    "menu.remove": "Remove from {name}",
    "header.aria": "{name} category",
    "header.count": { one: "{count} DM", other: "{count} DMs" },
    "dialog.new": "New Category",
    "dialog.rename": "Rename Category",
    "dialog.close": "Close",
    "dialog.hint": "Categories sit above Direct Messages. Right-click any DM to add it to one.",
    "dialog.label": "Category name",
    "dialog.placeholder": "Friends, Work, Gaming…",
    "dialog.create": "Create Category",
    "dialog.cancel": "Cancel",
    "error.empty": "Give it a name",
    "error.taken": "You already have a category with that name",
    "error.max": "You can't make any more categories"
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.order": "Reihenfolge in Kategorien",
      "settings.order.recent": "Neueste Nachricht zuerst, wie bei Direktnachrichten",
      "settings.order.name": "Nach Name",
      "settings.showCounts": "Anzahl anzeigen",
      "settings.showCounts.description": "Wie viele DMs jede Kategorie enthält, neben ihrem Namen.",
      "menu.rename": "Kategorie umbenennen",
      "menu.moveUp": "Nach oben",
      "menu.moveDown": "Nach unten",
      "menu.new": "Neue Kategorie",
      "menu.delete": "Kategorie löschen",
      "menu.delete.subtext": "Ihre DMs wandern zurück zu den Direktnachrichten",
      "menu.addNew": "Zu neuer Kategorie hinzufügen",
      "menu.addTo": "Zu Kategorie hinzufügen",
      "menu.moveTo": "In Kategorie verschieben",
      "menu.remove": "Aus {name} entfernen",
      "header.aria": "Kategorie {name}",
      "header.count": { one: "{count} DM", other: "{count} DMs" },
      "dialog.new": "Neue Kategorie",
      "dialog.rename": "Kategorie umbenennen",
      "dialog.close": "Schließen",
      "dialog.hint": "Kategorien stehen über den Direktnachrichten. Klicke eine DM mit der rechten Maustaste an, um sie einer Kategorie hinzuzufügen.",
      "dialog.label": "Kategoriename",
      "dialog.placeholder": "Freunde, Arbeit, Gaming …",
      "dialog.create": "Kategorie erstellen",
      "dialog.cancel": "Abbrechen",
      "error.empty": "Gib einen Namen ein",
      "error.taken": "Du hast bereits eine Kategorie mit diesem Namen",
      "error.max": "Du kannst keine weiteren Kategorien erstellen"
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.order": "Orden dentro de las categorías",
      "settings.order.recent": "Último mensaje primero, como en los mensajes directos",
      "settings.order.name": "Por nombre",
      "settings.showCounts": "Mostrar recuentos",
      "settings.showCounts.description": "Cuántos MD tiene cada categoría, junto a su nombre.",
      "menu.rename": "Cambiar nombre de la categoría",
      "menu.moveUp": "Subir",
      "menu.moveDown": "Bajar",
      "menu.new": "Nueva categoría",
      "menu.delete": "Eliminar categoría",
      "menu.delete.subtext": "Sus MD vuelven a Mensajes directos",
      "menu.addNew": "Añadir a una categoría nueva",
      "menu.addTo": "Añadir a categoría",
      "menu.moveTo": "Mover a categoría",
      "menu.remove": "Quitar de {name}",
      "header.aria": "Categoría {name}",
      "header.count": { other: "{count} MD" },
      "dialog.new": "Nueva categoría",
      "dialog.rename": "Cambiar nombre de la categoría",
      "dialog.close": "Cerrar",
      "dialog.hint": "Las categorías van encima de Mensajes directos. Haz clic derecho en cualquier MD para añadirlo a una.",
      "dialog.label": "Nombre de la categoría",
      "dialog.placeholder": "Amigos, Trabajo, Juegos…",
      "dialog.create": "Crear categoría",
      "dialog.cancel": "Cancelar",
      "error.empty": "Ponle un nombre",
      "error.taken": "Ya tienes una categoría con ese nombre",
      "error.max": "No puedes crear más categorías"
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.order": "Ordre dans les catégories",
      "settings.order.recent": "Dernier message en premier, comme dans les messages privés",
      "settings.order.name": "Par nom",
      "settings.showCounts": "Afficher les compteurs",
      "settings.showCounts.description": "Le nombre de MP de chaque catégorie, à côté de son nom.",
      "menu.rename": "Renommer la catégorie",
      "menu.moveUp": "Monter",
      "menu.moveDown": "Descendre",
      "menu.new": "Nouvelle catégorie",
      "menu.delete": "Supprimer la catégorie",
      "menu.delete.subtext": "Ses MP retournent dans Messages privés",
      "menu.addNew": "Ajouter à une nouvelle catégorie",
      "menu.addTo": "Ajouter à une catégorie",
      "menu.moveTo": "Déplacer vers une catégorie",
      "menu.remove": "Retirer de {name}",
      "header.aria": "Catégorie {name}",
      "header.count": { other: "{count} MP" },
      "dialog.new": "Nouvelle catégorie",
      "dialog.rename": "Renommer la catégorie",
      "dialog.close": "Fermer",
      "dialog.hint": "Les catégories se placent au-dessus des messages privés. Fais un clic droit sur un MP pour l'ajouter à l'une d'elles.",
      "dialog.label": "Nom de la catégorie",
      "dialog.placeholder": "Amis, Travail, Jeux…",
      "dialog.create": "Créer la catégorie",
      "dialog.cancel": "Annuler",
      "error.empty": "Donne-lui un nom",
      "error.taken": "Tu as déjà une catégorie portant ce nom",
      "error.max": "Tu ne peux plus créer de catégories"
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.order": "カテゴリ内の並び順",
      "settings.order.recent": "ダイレクトメッセージと同じく、新しいメッセージ順",
      "settings.order.name": "名前順",
      "settings.showCounts": "件数を表示",
      "settings.showCounts.description": "各カテゴリのDMの数を、名前の横に表示します。",
      "menu.rename": "カテゴリ名を変更",
      "menu.moveUp": "上へ移動",
      "menu.moveDown": "下へ移動",
      "menu.new": "新しいカテゴリ",
      "menu.delete": "カテゴリを削除",
      "menu.delete.subtext": "DMはダイレクトメッセージに戻ります",
      "menu.addNew": "新しいカテゴリに追加",
      "menu.addTo": "カテゴリに追加",
      "menu.moveTo": "カテゴリに移動",
      "menu.remove": "{name}から削除",
      "header.aria": "{name}カテゴリ",
      "header.count": { other: "DM {count}件" },
      "dialog.new": "新しいカテゴリ",
      "dialog.rename": "カテゴリ名を変更",
      "dialog.close": "閉じる",
      "dialog.hint": "カテゴリはダイレクトメッセージの上に表示されます。DMを右クリックすると、カテゴリに追加できます。",
      "dialog.label": "カテゴリ名",
      "dialog.placeholder": "友達、仕事、ゲーム…",
      "dialog.create": "カテゴリを作成",
      "dialog.cancel": "キャンセル",
      "error.empty": "名前を入力してください",
      "error.taken": "その名前のカテゴリはすでにあります",
      "error.max": "これ以上カテゴリは作成できません"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.order": "Kolejność w kategoriach",
      "settings.order.recent": "Najnowsza wiadomość na górze, jak w wiadomościach prywatnych",
      "settings.order.name": "Według nazwy",
      "settings.showCounts": "Pokaż liczby",
      "settings.showCounts.description": "Ile DM zawiera każda kategoria, obok jej nazwy.",
      "menu.rename": "Zmień nazwę kategorii",
      "menu.moveUp": "Przenieś w górę",
      "menu.moveDown": "Przenieś w dół",
      "menu.new": "Nowa kategoria",
      "menu.delete": "Usuń kategorię",
      "menu.delete.subtext": "Jej DM wrócą do wiadomości prywatnych",
      "menu.addNew": "Dodaj do nowej kategorii",
      "menu.addTo": "Dodaj do kategorii",
      "menu.moveTo": "Przenieś do kategorii",
      "menu.remove": "Usuń z kategorii {name}",
      "header.aria": "Kategoria {name}",
      "header.count": { other: "{count} DM" },
      "dialog.new": "Nowa kategoria",
      "dialog.rename": "Zmień nazwę kategorii",
      "dialog.close": "Zamknij",
      "dialog.hint": "Kategorie są nad wiadomościami prywatnymi. Kliknij DM prawym przyciskiem myszy, aby dodać go do kategorii.",
      "dialog.label": "Nazwa kategorii",
      "dialog.placeholder": "Znajomi, Praca, Gry…",
      "dialog.create": "Utwórz kategorię",
      "dialog.cancel": "Anuluj",
      "error.empty": "Nadaj jej nazwę",
      "error.taken": "Masz już kategorię o takiej nazwie",
      "error.max": "Nie możesz utworzyć więcej kategorii"
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.order": "Ordem dentro das categorias",
      "settings.order.recent": "Mensagem mais recente primeiro, como nas mensagens diretas",
      "settings.order.name": "Por nome",
      "settings.showCounts": "Mostrar contagens",
      "settings.showCounts.description": "Quantas DMs cada categoria tem, ao lado do nome.",
      "menu.rename": "Renomear categoria",
      "menu.moveUp": "Mover para cima",
      "menu.moveDown": "Mover para baixo",
      "menu.new": "Nova categoria",
      "menu.delete": "Excluir categoria",
      "menu.delete.subtext": "As DMs dela voltam para as mensagens diretas",
      "menu.addNew": "Adicionar a uma nova categoria",
      "menu.addTo": "Adicionar à categoria",
      "menu.moveTo": "Mover para a categoria",
      "menu.remove": "Remover de {name}",
      "header.aria": "Categoria {name}",
      "header.count": { one: "{count} DM", other: "{count} DMs" },
      "dialog.new": "Nova categoria",
      "dialog.rename": "Renomear categoria",
      "dialog.close": "Fechar",
      "dialog.hint": "As categorias ficam acima das mensagens diretas. Clique com o botão direito em qualquer DM para adicioná-la a uma.",
      "dialog.label": "Nome da categoria",
      "dialog.placeholder": "Amigos, Trabalho, Jogos…",
      "dialog.create": "Criar categoria",
      "dialog.cancel": "Cancelar",
      "error.empty": "Dê um nome a ela",
      "error.taken": "Você já tem uma categoria com esse nome",
      "error.max": "Você não pode criar mais categorias"
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.order": "Порядок внутри категорий",
      "settings.order.recent": "Сначала последние сообщения, как в личных сообщениях",
      "settings.order.name": "По имени",
      "settings.showCounts": "Показывать количество",
      "settings.showCounts.description": "Сколько ЛС в каждой категории, рядом с её названием.",
      "menu.rename": "Переименовать категорию",
      "menu.moveUp": "Переместить вверх",
      "menu.moveDown": "Переместить вниз",
      "menu.new": "Новая категория",
      "menu.delete": "Удалить категорию",
      "menu.delete.subtext": "Её ЛС вернутся в личные сообщения",
      "menu.addNew": "Добавить в новую категорию",
      "menu.addTo": "Добавить в категорию",
      "menu.moveTo": "Переместить в категорию",
      "menu.remove": "Убрать из категории «{name}»",
      "header.aria": "Категория «{name}»",
      "header.count": { other: "ЛС: {count}" },
      "dialog.new": "Новая категория",
      "dialog.rename": "Переименовать категорию",
      "dialog.close": "Закрыть",
      "dialog.hint": "Категории расположены над личными сообщениями. Нажмите на ЛС правой кнопкой мыши, чтобы добавить его в категорию.",
      "dialog.label": "Название категории",
      "dialog.placeholder": "Друзья, Работа, Игры…",
      "dialog.create": "Создать категорию",
      "dialog.cancel": "Отмена",
      "error.empty": "Введите название",
      "error.taken": "Категория с таким названием уже есть",
      "error.max": "Больше категорий создать нельзя"
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.order": "Kategorilerin içindeki sıralama",
      "settings.order.recent": "Direkt Mesajlar gibi en yeni mesaj önce",
      "settings.order.name": "Ada göre",
      "settings.showCounts": "Sayıları göster",
      "settings.showCounts.description": "Her kategoride kaç DM olduğunu adının yanında gösterir.",
      "menu.rename": "Kategoriyi Yeniden Adlandır",
      "menu.moveUp": "Yukarı Taşı",
      "menu.moveDown": "Aşağı Taşı",
      "menu.new": "Yeni Kategori",
      "menu.delete": "Kategoriyi Sil",
      "menu.delete.subtext": "DM'leri Direkt Mesajlar'a geri döner",
      "menu.addNew": "Yeni Kategoriye Ekle",
      "menu.addTo": "Kategoriye Ekle",
      "menu.moveTo": "Kategoriye Taşı",
      "menu.remove": "{name} kategorisinden çıkar",
      "header.aria": "{name} kategorisi",
      "header.count": { other: "{count} DM" },
      "dialog.new": "Yeni Kategori",
      "dialog.rename": "Kategoriyi Yeniden Adlandır",
      "dialog.close": "Kapat",
      "dialog.hint": "Kategoriler Direkt Mesajlar'ın üstünde yer alır. Bir kategoriye eklemek için herhangi bir DM'ye sağ tıkla.",
      "dialog.label": "Kategori adı",
      "dialog.placeholder": "Arkadaşlar, İş, Oyun…",
      "dialog.create": "Kategori Oluştur",
      "dialog.cancel": "İptal",
      "error.empty": "Bir ad ver",
      "error.taken": "Bu ada sahip bir kategorin zaten var",
      "error.max": "Daha fazla kategori oluşturamazsın"
    } })["tr"];
  }
});

// plugins/dm-categories/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var STORAGE_KEY = "categories";
var HEADER_HEIGHT = 32;
var DM = 1;
var GROUP_DM = 3;
var settings = {
  order: {
    type: "select",
    get label() {
      return t("settings.order");
    },
    default: "recent",
    options: [
      { get label() {
        return t("settings.order.recent");
      }, value: "recent" },
      { get label() {
        return t("settings.order.name");
      }, value: "name" }
    ]
  },
  showCounts: {
    type: "boolean",
    get label() {
      return t("settings.showCounts");
    },
    get description() {
      return t("settings.showCounts.description");
    },
    default: true
  }
};
var ctx;
var state = EMPTY;
var storage = () => ctx?.settings;
var list;
var current = PLAIN;
var currentIds = [];
var currentSizes = [];
var shownWhileCollapsed = "";
var listeners = new Set;
function refresh() {
  list ??= findMountedList();
  for (const listener of listeners)
    listener();
  try {
    list?.forceUpdate();
  } catch {}
}
function findMountedList() {
  const node = document.querySelector('[data-list-id^="private-channels-"]');
  if (!node)
    return;
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  for (let fiber = key ? node[key] : null, depth = 0;fiber && depth < 40; fiber = fiber.return, depth++) {
    const instance = fiber.stateNode;
    if (typeof instance?.renderDM === "function" && typeof instance.scrollToChannel === "function")
      return instance;
  }
}
function commit(next) {
  if (next === state)
    return;
  state = next;
  storage()?.set(STORAGE_KEY, state);
  refresh();
}
var hasUnread = (channelId) => {
  try {
    return !!import_api2.getStore("ReadStateStore")?.hasUnread?.(channelId);
  } catch {
    return false;
  }
};
var collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
function channelName(channelId) {
  const channel = import_api2.getStore("ChannelStore")?.getChannel?.(channelId);
  if (!channel)
    return "";
  if (channel.name)
    return channel.name;
  const users = import_api2.getStore("UserStore");
  const relationships = import_api2.getStore("RelationshipStore");
  const ids = channel.recipients ?? [];
  return ids.map((id) => {
    const user = users?.getUser?.(id);
    return relationships?.getNickname?.(id) || user?.globalName || user?.global_name || user?.username || "";
  }).filter(Boolean).join(", ");
}
function compareByName() {
  const names = new Map;
  const name = (id) => {
    let n = names.get(id);
    if (n === undefined)
      names.set(id, n = channelName(id));
    return n;
  };
  return (a, b) => collator.compare(name(a), name(b));
}
function laidOut(ids, selected) {
  const compare = ctx?.settings.get("order") === "name" ? compareByName() : undefined;
  return layout(ids, state, compare, (id) => id === selected || hasUnread(id));
}
function collapsedKey(l) {
  return l.categories.filter((c) => c.category.collapsed).map((c) => c.rows.join(",")).join(";");
}
function onReadState() {
  if (!list || current.plain || !state.categories.some((c) => c.collapsed))
    return;
  const next = laidOut(currentIds, list.props.selectedChannelId);
  if (collapsedKey(next) !== shownWhileCollapsed)
    refresh();
}
var openContextMenu = () => import_api2.find(import_api2.filters.byCode("enableSpellCheck", "renderLazy"));
var MenuRoot = () => import_api2.find(import_api2.filters.componentByCode("Menu API only allows Items"));
var closeContextMenu = () => void import_api2.Dispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });
function openHeaderMenu(event, category) {
  const open = openContextMenu();
  const Root = MenuRoot();
  if (!open || !Root)
    return;
  const index = state.categories.findIndex((c) => c.id === category.id);
  open(event, () => /* @__PURE__ */ jsx_runtime.jsxs(Root, {
    navId: "evi-dm-category",
    onClose: closeContextMenu,
    "aria-label": t("header.aria", { name: category.name }),
    onSelect: undefined,
    children: [
      /* @__PURE__ */ jsx_runtime.jsxs(import_api2.Menu.Group, {
        children: [
          /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
            id: "evi-dmc-rename",
            label: t("menu.rename"),
            action: () => openNameDialog({ category })
          }),
          /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
            id: "evi-dmc-up",
            label: t("menu.moveUp"),
            disabled: index <= 0,
            action: () => commit(moveCategory(state, category.id, -1))
          }),
          /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
            id: "evi-dmc-down",
            label: t("menu.moveDown"),
            disabled: index < 0 || index >= state.categories.length - 1,
            action: () => commit(moveCategory(state, category.id, 1))
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs(import_api2.Menu.Group, {
        children: [
          /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
            id: "evi-dmc-new-empty",
            label: t("menu.new"),
            action: () => openNameDialog({})
          }),
          /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
            id: "evi-dmc-delete",
            label: t("menu.delete"),
            color: "danger",
            subtext: category.channels.length ? t("menu.delete.subtext") : undefined,
            action: () => commit(deleteCategory(state, category.id))
          })
        ]
      })
    ]
  }));
}
function useStateVersion() {
  const [, rerender] = import_api2.React.useReducer((n) => n + 1, 0);
  import_api2.React.useEffect(() => {
    listeners.add(rerender);
    return () => void listeners.delete(rerender);
  }, []);
}
function CategoryHeader({ entry }) {
  useStateVersion();
  const showCounts = ctx?.settings.get("showCounts") ?? true;
  const category = getCategory(state, entry.category.id) ?? entry.category;
  const expanded = !category.collapsed;
  return /* @__PURE__ */ jsx_runtime.jsx("li", {
    className: "evi-dmc-header",
    role: "none",
    children: /* @__PURE__ */ jsx_runtime.jsxs("button", {
      type: "button",
      className: "evi-dmc-toggle",
      "aria-expanded": expanded,
      title: category.name.length > 20 ? category.name : undefined,
      onClick: () => commit(setCollapsed(state, category.id, expanded)),
      onContextMenu: (e) => openHeaderMenu(e, category),
      children: [
        /* @__PURE__ */ jsx_runtime.jsx("span", {
          className: "evi-dmc-name",
          children: category.name
        }),
        showCounts && /* @__PURE__ */ jsx_runtime.jsx("span", {
          className: "evi-dmc-count",
          "aria-label": t("header.count", { count: entry.size }),
          children: entry.size
        }),
        /* @__PURE__ */ jsx_runtime.jsx("svg", {
          className: "evi-dmc-chevron",
          viewBox: "0 0 24 24",
          width: "12",
          height: "12",
          "aria-hidden": "true",
          children: /* @__PURE__ */ jsx_runtime.jsx("path", {
            d: "M5.3 9.3a1 1 0 0 1 1.4 0L12 14.58l5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.42Z",
            fill: "currentColor"
          })
        })
      ]
    })
  });
}
var closeOpen;
function openNameDialog(options) {
  closeOpen?.();
  const close = import_api2.openLayer((close2) => /* @__PURE__ */ jsx_runtime.jsx(NameDialog, {
    ...options,
    onClose: () => close2()
  }), {
    onClosed: () => void (closeOpen === close && (closeOpen = undefined))
  });
  closeOpen = close;
}
function NameDialog({ category, channelId, onClose }) {
  const [name, setName] = import_api2.React.useState(category?.name ?? "");
  const [error, setError] = import_api2.React.useState(null);
  const input = import_api2.React.useRef(null);
  const renaming = !!category;
  import_api2.React.useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    input.current?.select();
    const onKey = (e) => {
      if (e.key !== "Escape")
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, []);
  function submit(e) {
    e.preventDefault();
    const problem = nameError(state, name, category?.id);
    if (problem) {
      setError(t(problem === "empty" ? "error.empty" : "error.taken"));
      input.current?.focus();
      return;
    }
    if (category) {
      commit(renameCategory(state, category.id, name));
    } else {
      const created = createCategory(state, name);
      if (!created.category) {
        setError(t("error.max"));
        return;
      }
      commit(channelId ? assign(created.state, channelId, created.category.id) : created.state);
    }
    onClose();
  }
  return /* @__PURE__ */ jsx_runtime.jsx("div", {
    className: "evi-dmc-scrim evi-scrim",
    onMouseDown: (e) => e.target === e.currentTarget && onClose(),
    children: /* @__PURE__ */ jsx_runtime.jsxs("div", {
      className: "evi-dmc-modal evi-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "evi-dmc-title",
      children: [
        /* @__PURE__ */ jsx_runtime.jsxs("header", {
          className: "evi-dmc-head",
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("h2", {
              id: "evi-dmc-title",
              children: renaming ? t("dialog.rename") : t("dialog.new")
            }),
            /* @__PURE__ */ jsx_runtime.jsx("button", {
              type: "button",
              className: "evi-dmc-close",
              "aria-label": t("dialog.close"),
              onClick: onClose,
              children: /* @__PURE__ */ jsx_runtime.jsx("svg", {
                viewBox: "0 0 24 24",
                width: "20",
                height: "20",
                "aria-hidden": "true",
                children: /* @__PURE__ */ jsx_runtime.jsx("path", {
                  d: "M6 6l12 12M18 6L6 18",
                  stroke: "currentColor",
                  strokeWidth: "2",
                  strokeLinecap: "round"
                })
              })
            })
          ]
        }),
        /* @__PURE__ */ jsx_runtime.jsxs("form", {
          className: "evi-dmc-body",
          onSubmit: submit,
          noValidate: true,
          children: [
            !renaming && /* @__PURE__ */ jsx_runtime.jsx("p", {
              className: "evi-dmc-hint",
              children: t("dialog.hint")
            }),
            /* @__PURE__ */ jsx_runtime.jsx("label", {
              className: "evi-dmc-label",
              htmlFor: "evi-dmc-name",
              children: t("dialog.label")
            }),
            /* @__PURE__ */ jsx_runtime.jsx("input", {
              id: "evi-dmc-name",
              ref: input,
              className: "evi-dmc-input",
              type: "text",
              inputMode: "text",
              value: name,
              maxLength: MAX_NAME_LENGTH,
              placeholder: t("dialog.placeholder"),
              autoComplete: "off",
              spellCheck: false,
              "aria-invalid": !!error,
              "aria-describedby": error ? "evi-dmc-error" : undefined,
              onChange: (e) => {
                setName(e.currentTarget.value);
                setError(null);
              }
            }),
            error && /* @__PURE__ */ jsx_runtime.jsx("p", {
              id: "evi-dmc-error",
              className: "evi-dmc-error",
              role: "alert",
              children: error
            }),
            /* @__PURE__ */ jsx_runtime.jsxs("footer", {
              className: "evi-dmc-foot",
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("button", {
                  type: "button",
                  className: "evi-dmc-button",
                  "data-variant": "secondary",
                  onClick: onClose,
                  children: t("dialog.cancel")
                }),
                /* @__PURE__ */ jsx_runtime.jsx("button", {
                  type: "submit",
                  className: "evi-dmc-button",
                  children: renaming ? t("dialog.rename") : t("dialog.create")
                })
              ]
            })
          ]
        })
      ]
    })
  });
}
function dmMenuItems(channelId) {
  const inCategory = categoryOf(state, channelId);
  if (!state.categories.length) {
    return /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
      id: "evi-dmc-add-new",
      label: t("menu.addNew"),
      action: () => openNameDialog({ channelId })
    });
  }
  const choices = state.categories.map((c) => /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.CheckboxItem, {
    id: `evi-dmc-to-${c.id}`,
    label: c.name,
    checked: c.id === inCategory?.id,
    action: () => commit(assign(state, channelId, c.id === inCategory?.id ? null : c.id))
  }, c.id));
  choices.push(/* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Separator, {}, "evi-dmc-sep"), /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
    id: "evi-dmc-add-new",
    label: t("menu.new"),
    action: () => openNameDialog({ channelId })
  }, "evi-dmc-add-new"));
  const items = [/* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
    id: "evi-dmc-add",
    label: inCategory ? t("menu.moveTo") : t("menu.addTo"),
    children: choices
  }, "evi-dmc-add")];
  if (inCategory) {
    items.push(/* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
      id: "evi-dmc-remove",
      label: t("menu.remove", { name: inCategory.name }),
      action: () => commit(assign(state, channelId, null))
    }, "evi-dmc-remove"));
  }
  return items;
}
var dm_categories_default = import_api2.definePlugin({
  settings,
  patches: [LIST_PATCH],
  css: `
.evi-dmc-header { list-style: none; box-sizing: border-box; height: ${HEADER_HEIGHT}px; padding: 8px 4px 4px 8px; }
.evi-dmc-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 20px;
    padding: 0 8px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--channels-default, var(--text-muted, #949ba4));
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    line-height: 18px;
    text-align: start;
    cursor: pointer;
}
@media (hover: hover) { .evi-dmc-toggle:hover { color: var(--interactive-text-hover, var(--interactive-hover, #dbdee1)); } }
.evi-dmc-toggle:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: 0; }
.evi-dmc-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-dmc-count { flex-shrink: 0; font-size: 12px; font-variant-numeric: tabular-nums; opacity: .75; }
.evi-dmc-chevron { flex-shrink: 0; }
.evi-dmc-toggle[aria-expanded="false"] .evi-dmc-chevron { rotate: -90deg; }
@media (prefers-reduced-motion: no-preference) { .evi-dmc-chevron { transition: rotate 150ms ease-out; } }

.evi-dmc-scrim { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: rgba(0,0,0,.7); }
.evi-dmc-modal { width: min(420px, calc(100vw - 32px)); border-radius: 12px;
  background: var(--modal-background, var(--background-base-low, #313338)); color: var(--text-default, var(--text-normal, #dbdee1));
  border: 1px solid var(--border-subtle, transparent); box-shadow: var(--shadow-high, 0 8px 24px rgba(0,0,0,.4)); font-family: var(--font-primary); }
.evi-dmc-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 16px 0 20px; }
.evi-dmc-head h2 { margin: 0; font-size: 20px; line-height: 24px; font-weight: 600; color: var(--text-strong, var(--header-primary, #f2f3f5)); }
.evi-dmc-close { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: var(--interactive-normal, #b5bac1); cursor: pointer; }
@media (hover: hover) { .evi-dmc-close:hover { background: var(--background-modifier-hover, rgba(255,255,255,.06)); color: var(--interactive-hover, #dbdee1); } }
.evi-dmc-body { display: flex; flex-direction: column; padding: 8px 20px 20px; }
.evi-dmc-hint { margin: 0 0 8px; font-size: 14px; line-height: 18px; color: var(--text-muted, #949ba4); text-wrap: pretty; }
.evi-dmc-label { margin: 8px 0 8px; font-size: 14px; font-weight: 500; color: var(--text-default, #dbdee1); }
.evi-dmc-input { width: 100%; box-sizing: border-box; height: 40px; padding: 0 10px; border-radius: 8px; font: inherit; font-size: 15px;
  border: 1px solid var(--input-border, var(--border-subtle, rgba(255,255,255,.08))); background: var(--input-background, var(--background-tertiary, #1e1f22)); color: inherit; }
.evi-dmc-input::placeholder { color: var(--text-muted, #949ba4); }
.evi-dmc-input:focus { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: -1px; }
.evi-dmc-input[aria-invalid="true"] { border-color: var(--status-danger, #f23f43); }
.evi-dmc-error { margin: 8px 0 0; font-size: 14px; line-height: 18px; color: var(--text-feedback-critical, var(--status-danger, #f23f43)); }
.evi-dmc-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
.evi-dmc-button { height: 38px; padding: 0 16px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 500; white-space: nowrap; cursor: pointer;
  background: var(--button-filled-brand-background, var(--brand-500, #5865f2)); color: var(--white, #fff); transition: background-color 150ms ease-out, scale 200ms ease-out; }
@media (hover: hover) {
  .evi-dmc-button:hover { background: var(--button-filled-brand-background-hover, var(--brand-560, #4752c4)); }
  .evi-dmc-button[data-variant="secondary"]:hover { background: var(--button-secondary-background-hover, rgba(255,255,255,.12)); }
}
.evi-dmc-button:active { scale: .97; }
.evi-dmc-button[data-variant="secondary"] { background: var(--button-secondary-background, rgba(255,255,255,.08)); color: var(--text-default, #dbdee1); }
.evi-dmc-button:focus-visible, .evi-dmc-close:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .evi-dmc-button { transition: none; } .evi-dmc-button:active { scale: none; } }
`,
  sections(instance, ids, pinnedRows) {
    list = instance;
    try {
      if (!ctx || !Array.isArray(ids))
        return void (current = PLAIN);
      current = laidOut(ids, instance.props.selectedChannelId);
      currentIds = ids;
      shownWhileCollapsed = collapsedKey(current);
      if (current.plain)
        return;
      return currentSizes = sectionSizes(current, pinnedRows, ids.length);
    } catch (err) {
      ctx?.logger.error("Couldn't lay out the DM list", err);
      current = PLAIN;
    }
  },
  rowIndex(section, row) {
    return ctx ? rowIndex(current, section, row) : undefined;
  },
  renderSection(section) {
    const entry = ctx && sectionCategory(current, section);
    if (!entry)
      return;
    return /* @__PURE__ */ jsx_runtime.jsx(CategoryHeader, {
      entry
    }, `evi-dmc-${entry.category.id}`);
  },
  rowHeight(section, row) {
    return ctx && isPlaceholder(current, section, row) ? 0 : undefined;
  },
  sectionHeight(section) {
    return ctx && sectionCategory(current, section) ? HEADER_HEIGHT : undefined;
  },
  scrollToChannel(instance, channelId) {
    if (!ctx || current.plain || channelId == null || instance !== list)
      return false;
    try {
      const where = rowOffset(current, currentIds, channelId, currentSizes, instance.props.padding ?? 8, (s) => instance.getSectionHeight(s), (s, r) => instance.getRowHeight(s, r));
      if (where === "collapsed")
        return true;
      if (!where || !instance._list?.scrollIntoViewRect)
        return false;
      instance._list.scrollIntoViewRect({ start: Math.max(where.top - 8, 0), end: where.top + where.height + 8 });
      return true;
    } catch (err) {
      ctx.logger.error("Couldn't scroll to the DM", err);
      return false;
    }
  },
  start(context) {
    ctx = context;
    state = parseState(storage()?.get(STORAGE_KEY));
    context.settings.onChange(refresh);
    const readStates = import_api2.getStore("ReadStateStore");
    if (readStates?.addChangeListener) {
      readStates.addChangeListener(onReadState);
      context.onDispose(() => readStates.removeChangeListener?.(onReadState));
    }
    context.contextMenu("user-context", (children, props) => {
      const channel = props?.channel;
      if (channel?.id && channel.type === DM && !channel.guild_id)
        children.push(/* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Group, {
          children: dmMenuItems(channel.id)
        }, "evi-dmc"));
    });
    context.contextMenu("gdm-context", (children, props) => {
      const channel = props?.channel;
      if (channel?.id && channel.type === GROUP_DM)
        children.push(/* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Group, {
          children: dmMenuItems(channel.id)
        }, "evi-dmc"));
    });
    context.onDispose(() => {
      closeOpen?.({ instant: true });
      ctx = undefined;
      current = PLAIN;
      try {
        list?.forceUpdate();
      } catch {}
      list = undefined;
    });
    refresh();
  }
});
