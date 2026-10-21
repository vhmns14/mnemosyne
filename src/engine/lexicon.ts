/**
 * Light bilingual (Indonesian + English) normalisation for the lexical recall leg.
 * No dependencies, no dictionary: affix stripping plus a small synonym table, applied
 * identically to queries and stored facts so "berwisata" meets "wisata", "jogging"
 * meets "jog", "pekerjaan" meets "bekerja", and "trip" meets "travel".
 *
 * Every token yields a small set of keys (surface form, English stem, Indonesian
 * stem candidates, synonym group). Over-generation is deliberate and bounded: a key
 * only matters when the same key comes out of both the query and a fact.
 */

const STOP = new Set(
  (
    "the a an and or but in on at to for of with by from into is are was were be been being have has had do does did will would " +
    "should could this that these those what where when how who why which his her their its he she they them it i you we me my your our " +
    "now still usually there here any some about as than then so not no yes " +
    "yang dan atau tetapi di ke dari pada untuk dengan oleh tentang ini itu adalah ialah sebagai ada telah sudah akan bisa dapat pun juga " +
    "jika kalau agar supaya apa siapa kapan dimana mana mengapa bagaimana gimana dia ia mereka kamu aku saya kami kita sih lagi nya"
  ).split(" ")
);

/** Synonym groups; members are matched after stemming, so list base forms. */
const SYNONYM_GROUPS: string[][] = [
  ["travel", "trip", "journey", "vacation", "holiday", "tour", "itinerary", "getaway", "visit", "liburan", "libur", "wisata", "pelesir", "mudik", "plesiran", "perjalanan"],
  ["job", "work", "career", "employ", "employed", "employer", "occupation", "profession", "kerja", "pekerjaan", "karier", "karir", "profesi"],
  ["live", "reside", "home", "house", "address", "move", "moved", "relocate", "tinggal", "rumah", "alamat", "pindah", "domisili"],
  ["food", "eat", "meal", "dish", "cuisine", "diet", "makan", "makanan", "masakan", "kuliner"],
  ["drink", "beverage", "minum", "minuman"],
  ["coffee", "latte", "espresso", "cappuccino", "kopi"],
  ["like", "love", "enjoy", "prefer", "favorite", "favourite", "fond", "suka", "senang", "gemar", "favorit", "hobi", "hobby"],
  ["dislike", "hate", "avoid", "benci"],
  ["allergy", "allergic", "alergi"],
  ["family", "wife", "husband", "spouse", "partner", "child", "kid", "son", "daughter", "keluarga", "istri", "suami", "anak"],
  ["pet", "dog", "cat", "puppy", "kitten", "peliharaan", "anjing", "kucing"],
  ["car", "vehicle", "mobil", "kendaraan", "motor"],
  ["health", "doctor", "sick", "ill", "medical", "hospital", "sehat", "sakit", "dokter"],
  ["money", "budget", "salary", "income", "finance", "uang", "gaji", "anggaran", "duit"],
  ["study", "learn", "school", "university", "universitas", "college", "course", "degree", "graduate", "kuliah", "ajar", "belajar", "sekolah", "kampus", "lulus"],
  ["sport", "exercise", "workout", "gym", "jog", "jogging", "fitness", "olahraga", "lari"],
  ["music", "song", "band", "concert", "musik", "lagu", "konser"],
  ["read", "book", "novel", "baca", "buku"],
  ["code", "coding", "program", "programming", "developer", "software", "ngoding"],
  ["meeting", "meet", "rapat", "pertemuan"],
  ["sleep", "tidur"],
  ["wedding", "marry", "married", "marriage", "nikah", "menikah", "kawin"],
  ["birthday", "born", "lahir"],
  ["language", "speak", "fluent", "bahasa"],
];

/** English light stems; returns the stem plus an "e"-restored form when a suffix was cut. */
function englishStems(w: string): string[] {
  if (w.length <= 3) return [w];
  let s = w;
  let cut = false;
  if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("ied") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("ing") && s.length > 5) { s = s.slice(0, -3); cut = true; }
  else if (s.endsWith("ed") && s.length > 4) { s = s.slice(0, -2); cut = true; }
  else if (/(ss|sh|ch|x|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us") && !s.endsWith("is") && s.length > 3) s = s.slice(0, -1);
  const out = [s];
  // doubled final consonant from -ing/-ed: "jogging" -> "jogg" -> "jog"
  if (cut && /([bcdfgklmnprtvz])\1$/.test(s)) out[0] = s.slice(0, -1);
  else if (cut) out.push(s + "e"); // "moved" -> "mov" + "move"
  return out;
}

/** Prefix rules: [pattern, roots]. Nasal prefixes also yield the dropped initial (p/t/s/k). */
const ID_PREFIXES: Array<[RegExp, (m: RegExpMatchArray) => string[]]> = [
  [/^(ber|ter|per)(.*)$/, (m) => [m[2]]],
  [/^(bel|pel)(ajar.*)$/, (m) => [m[2]]],
  [/^(meny|peny)([aiueo].*)$/, (m) => ["s" + m[2], "ny" + m[2]]],
  [/^(meng|peng)([aiueo].*)$/, (m) => ["k" + m[2], m[2], "ng" + m[2]]],
  [/^(meng|peng)([ghkq].*)$/, (m) => [m[2]]],
  [/^(mem|pem)([aiueo].*)$/, (m) => ["p" + m[2], "m" + m[2]]],
  [/^(mem|pem)([bfpv].*)$/, (m) => [m[2]]],
  [/^(men|pen)([aiueo].*)$/, (m) => ["t" + m[2], "n" + m[2]]],
  [/^(men|pen)([cdjstz].*)$/, (m) => [m[2]]],
  [/^(me|pe)([lmnrwy].*)$/, (m) => [m[2]]],
  [/^(di|ke|se)(.*)$/, (m) => [m[2]]],
  [/^(be|pe)(.*)$/, (m) => [m[2]]],
];

function prefixRoots(base: string): string[] {
  for (const [re, f] of ID_PREFIXES) {
    const m = base.match(re);
    if (m) return f(m).filter((r) => r.length >= 4);
  }
  return [];
}

/** Indonesian root candidates (Nazief-Adriani style, simplified; several on purpose). */
function indonesianStems(w: string): string[] {
  if (w.length < 5) return [w];
  const out = new Set<string>([w]);
  const bases = new Set<string>([w]);
  const particle = w.replace(/(lah|kah|tah|pun)$/, "");
  if (particle.length >= 4) bases.add(particle);
  for (const b of Array.from(bases)) {
    const poss = b.replace(/(nya|ku|mu)$/, "");
    if (poss.length >= 4) bases.add(poss);
  }
  for (const b of bases) {
    const forms = [b];
    const m = b.match(/^(.{4,}?)(kan|an|i)$/);
    if (m) forms.push(m[1]);
    for (const f of forms) {
      out.add(f);
      for (const r of prefixRoots(f)) {
        out.add(r);
        for (const r2 of prefixRoots(r)) out.add(r2); // stacked: diper-, memper-, keber-
      }
    }
  }
  return Array.from(out);
}

let synonymIndex: Map<string, string> | null = null;
function synonyms(): Map<string, string> {
  if (synonymIndex) return synonymIndex;
  synonymIndex = new Map();
  for (const group of SYNONYM_GROUPS) {
    const id = `~${group[0]}`;
    for (const word of group) {
      for (const k of baseKeys(word)) if (!synonymIndex.has(k)) synonymIndex.set(k, id);
    }
  }
  return synonymIndex;
}

function baseKeys(w: string): Set<string> {
  const keys = new Set<string>([w, ...englishStems(w)]);
  for (const s of indonesianStems(w)) keys.add(s);
  return keys;
}

export interface TokenKeys {
  token: string;
  /** Surface + stem keys (a match on these counts fully). */
  keys: Set<string>;
  /** Synonym group id, if any (a match only through it counts partially). */
  group: string | null;
}

export function lexicalTokens(text: string, max = 64): TokenKeys[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const out: TokenKeys[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    const keys = baseKeys(w);
    let group: string | null = null;
    const syn = synonyms();
    for (const k of keys) {
      const g = syn.get(k);
      if (g) {
        group = g;
        break;
      }
    }
    out.push({ token: w, keys, group });
    if (out.length >= max) break;
  }
  return out;
}

/** Flat key set for a document (stems + synonym groups). */
export function lexicalKeySet(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of lexicalTokens(text, 512)) {
    for (const k of t.keys) out.add(k);
    if (t.group) out.add(t.group);
  }
  return out;
}

export const SYNONYM_WEIGHT = 0.6;

/**
 * Fraction of the query's tokens found in the document (stem match = 1, synonym-group
 * match only = SYNONYM_WEIGHT), weighted by inverse document frequency when `df` is
 * given. In [0, 1].
 */
export function lexicalCoverage(query: TokenKeys[], doc: Set<string>, idf?: (t: TokenKeys) => number): number {
  if (query.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (const t of query) {
    const w = idf ? idf(t) : 1;
    den += w;
    let hit = 0;
    for (const k of t.keys) if (doc.has(k)) { hit = 1; break; }
    if (!hit && t.group && doc.has(t.group)) hit = SYNONYM_WEIGHT;
    num += w * hit;
  }
  return den > 0 ? num / den : 0;
}

/** Off-switch for A/B evaluation: MNEMO_LEXICON=off. */
export function lexiconEnabled(): boolean {
  return (process.env.MNEMO_LEXICON || "on").toLowerCase() !== "off";
}
