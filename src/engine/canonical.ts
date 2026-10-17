/**
 * Entity canonicalization for the triple graph.
 *
 * The graph is only as good as its node identity: "16 GB", "16GB" and "16384MB"
 * used to become three separate nodes, which dilutes PageRank, associative
 * resonance and the standing card. This normalizes units, whitespace and
 * trailing punctuation, then applies registered canonical aliases.
 *
 * Case is intentionally preserved — lower-casing subjects/objects would churn
 * every stored triple and every rendered card for no retrieval gain (matching
 * already compares LOWER(subject)/LOWER(object)).
 */
const UNIT_PATTERN = /(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB)\b/gi;

export function canonicalizeEntity(name: string, aliases?: Record<string, string>): string {
  if (!name) return "";

  let value = name.trim().replace(/[.,;:]+$/, "").replace(/\s+/g, " ");
  if (!value) return "";

  value = value.replace(UNIT_PATTERN, (_match: string, amount: string, rawUnit: string) => {
    const unit = rawUnit.toUpperCase();
    const numeric = Number(amount);
    // 16384MB and 16GB are the same constraint on a 16GB laptop.
    if (unit === "MB" && numeric >= 1024 && numeric % 1024 === 0) {
      return `${numeric / 1024}gb`;
    }
    return `${amount}${unit.toLowerCase()}`;
  });

  const key = value.toLowerCase();
  const canonical = aliases?.[key];
  return canonical ? canonical.trim() : value;
}

export function getAliasMap(db: { query: (sql: string) => { all: () => unknown[] } }): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    const rows = db.query("SELECT alias, canonical_name FROM entity_aliases").all() as Array<{
      alias: string;
      canonical_name: string;
    }>;
    for (const row of rows) {
      if (row.alias) map[row.alias.toLowerCase()] = row.canonical_name;
    }
  } catch {
    // aliases table unavailable (fresh or partial schema)
  }
  return map;
}
