/**
 * Store search: every word you type has to match somewhere, in any order, forgiving a typo, and the
 * best matches come first. Pure, so it's tested on its own (tests/storeSearch.test.ts).
 *
 * A word matches, best first: the start of the name, the start of a word in the name, the start of an
 * id, tag or author, the start of a word in the description, anywhere in any of those, and last one
 * or two letters off from a word (one for 4+ letters, two for 8+).
 */

export interface Searchable {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    authors?: string[];
    /** The same text in other languages: the English original and every translation */
    alsoNamed?: string[];
    alsoDescribed?: string[];
}

/** Lowercase, no accents: "Café" and "cafe" are the same word */
export function normalize(text: string) {
    return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

const words = (text: string) => normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Damerau-Levenshtein distance, giving up past `max` */
export function editDistance(a: string, b: string, max: number) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2: number[] = [];
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let best = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], prev2[j - 2] + 1);
            best = Math.min(best, row[j]);
        }
        if (best > max) return max + 1;
        prev2 = prev;
        prev = row;
    }
    return prev[b.length];
}

const typosAllowed = (word: string) => word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;

interface Fields {
    names: string[];
    nameWords: string[];
    labels: string[];
    descriptionWords: string[];
    all: string;
}

/**
 * Normalizing and splitting every translation is most of a search's work, so it's done once per
 * item: a Searchable is read as it was the first time, make a new one when its text changes
 */
const fieldsCache = new WeakMap<Searchable, Fields>();

function fieldsOf(item: Searchable): Fields {
    let fields = fieldsCache.get(item);
    if (!fields) fieldsCache.set(item, fields = splitFields(item));
    return fields;
}

function splitFields(item: Searchable): Fields {
    const names = [item.name, ...item.alsoNamed ?? []].map(normalize);
    const labels = [item.id, ...item.tags ?? [], ...item.authors ?? []].map(normalize);
    const descriptions = [item.description ?? "", ...item.alsoDescribed ?? []];
    return {
        names,
        nameWords: names.flatMap(words),
        labels: [...labels, ...labels.flatMap(words)],
        descriptionWords: descriptions.flatMap(words),
        all: [...names, ...labels, ...descriptions.map(normalize)].join("\n"),
    };
}

/** How well one typed word matches, 0 for not at all */
function wordScore(word: string, f: Fields) {
    if (f.names.some(n => n.startsWith(word))) return 100;
    if (f.nameWords.some(w => w.startsWith(word))) return 60;
    if (f.labels.some(l => l.startsWith(word))) return 40;
    if (f.descriptionWords.some(w => w.startsWith(word))) return 20;
    if (f.all.includes(word)) return 10;
    const max = typosAllowed(word);
    if (!max) return 0;
    // Compared with each word's start of the same length too, so a typo while still typing counts
    const near = (w: string) => editDistance(word, w, max) <= max || (w.length > word.length && editDistance(word, w.slice(0, word.length), max) <= max);
    if (f.nameWords.some(near)) return 8;
    if (f.labels.some(near) || f.descriptionWords.some(near)) return 4;
    return 0;
}

/** How well `item` matches `query`: 0 when some word doesn't match at all, higher is better */
export function searchScore(item: Searchable, query: string) {
    return scoreWords(words(query), item);
}

function scoreWords(typed: string[], item: Searchable) {
    if (!typed.length) return 1;
    const f = fieldsOf(item);
    let total = 0;
    for (const word of typed) {
        const score = wordScore(word, f);
        if (!score) return 0;
        total += score;
    }
    // The whole query as one phrase in the name beats the same words scattered
    if (typed.length > 1 && f.names.some(n => n.includes(typed.join(" ")))) total += 50;
    return total;
}

/**
 * The items that match, best first. Items that score the same keep the order they came in, which is
 * the listing's own sort.
 */
export function searchItems<T>(items: T[], query: string, searchable: (item: T) => Searchable): T[] {
    const typed = words(query);
    if (!typed.length) return items;
    return items
        .map((item, index) => ({ item, index, score: scoreWords(typed, searchable(item)) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(r => r.item);
}
