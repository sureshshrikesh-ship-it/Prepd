// The living fridge: turning receipt lines into stock, estimating use-by dates, and showing amounts.
// Pure functions (no database) so they can be unit-tested.

export type Unit = "g" | "ml" | "piece" | "pack";
export type Storage = "fridge" | "freezer" | "cupboard" | "counter";

export type PantryItem = {
  id: string;
  name: string;
  category: string | null;
  storage: Storage;
  unit: Unit;
  unit_label: string | null;
  qty: number;
  start_qty: number;
  use_by: string | null;
  cost_gbp: number | null;
  protein_g_total: number | null;
  fat_100: number | null; saturates_100: number | null; sugars_100: number | null; salt_100: number | null; fibre_100: number | null;
  status: "active" | "finished" | "binned";
  added_at: string;
};

const PINT_ML = 568;

/**
 * How much stock one receipt line adds. Countable things become pieces ("6 eggs"),
 * weighed things become grams or millilitres, anything else stays as packs.
 */
export function parsePack(
  pack: string | null, qty: number, unitsPerPack: number | null, unitName: string | null,
): { amount: number; unit: Unit; label: string | null } {
  const n = Math.max(1, qty || 1);
  if (unitsPerPack && unitsPerPack > 0 && unitName) {
    return { amount: round(unitsPerPack * n), unit: "piece", label: unitName.toLowerCase() };
  }
  const p = (pack ?? "").toLowerCase().replace(/,/g, "").trim();
  const multi = p.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|ltr|litre)\b/);
  if (multi) {
    const conv = toBase(Number(multi[2]), multi[3]);
    return { amount: round(Number(multi[1]) * conv.amount * n), unit: conv.unit, label: null };
  }
  const single = p.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|ltr|litre|pt|pint)s?\b/);
  if (single) {
    const conv = toBase(Number(single[1]), single[2]);
    return { amount: round(conv.amount * n), unit: conv.unit, label: null };
  }
  const count = p.match(/(\d+)\s*(pk|pack|x)\b/);
  if (count) return { amount: Number(count[1]) * n, unit: "piece", label: null };
  return { amount: n, unit: "pack", label: null };
}

function toBase(v: number, u: string): { amount: number; unit: "g" | "ml" } {
  switch (u) {
    case "kg": return { amount: v * 1000, unit: "g" };
    case "g": return { amount: v, unit: "g" };
    case "l": case "ltr": case "litre": return { amount: v * 1000, unit: "ml" };
    case "cl": return { amount: v * 10, unit: "ml" };
    case "pt": case "pint": return { amount: v * PINT_ML, unit: "ml" };
    default: return { amount: v, unit: "ml" };
  }
}

const round = (x: number) => Math.round(x * 10) / 10;

/** Conservative use-by estimate from the reader's shelf-life bucket. The pack's own date always wins. */
export function useByFrom(keeps: string | null, storage: Storage, from: Date): string {
  const days = storage === "freezer" ? 90 : ({
    "1-2 days": 1, "3-5 days": 3, "1 week": 6, "1-2 weeks": 9, "2-4 weeks": 18, "months": 90, "use-by on pack": 2,
  } as Record<string, number>)[(keeps ?? "").toLowerCase()] ?? 7;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "1.2 kg", "500 ml", "6 eggs", "2 packs". */
export function formatQty(qty: number, unit: Unit, label?: string | null): string {
  const q = Math.round(qty * 10) / 10;
  if (unit === "g") return q >= 1000 ? `${Math.round(q / 100) / 10} kg` : `${Math.round(q)} g`;
  if (unit === "ml") return q >= 1000 ? `${Math.round(q / 100) / 10} l` : `${Math.round(q)} ml`;
  if (unit === "piece") {
    const name = label || "item";
    return `${q} ${q === 1 ? name : plural(name)}`;
  }
  return `${q} ${q === 1 ? "pack" : "packs"}`;
}

function plural(w: string): string {
  if (/(s|sh|ch|x)$/.test(w)) return w + "es";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

/** Days until the use-by date (negative once passed), counted from local midnight. */
export function daysLeft(useBy: string | null, today = new Date()): number | null {
  if (!useBy) return null;
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = useBy.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - t) / 86_400_000);
}

export function useByLabel(n: number | null): { text: string; tone: "bad" | "warn" | "ok" | "calm" } {
  if (n == null) return { text: "", tone: "calm" };
  if (n < 0) return { text: "Past its date", tone: "bad" };
  if (n === 0) return { text: "Use today", tone: "bad" };
  if (n === 1) return { text: "Use tomorrow", tone: "warn" };
  if (n <= 3) return { text: `Use in ${n} days`, tone: "warn" };
  if (n <= 14) return { text: `${n} days`, tone: "ok" };
  return { text: "Keeps", tone: "calm" };
}

/** Sensible quick-adjust step for the Fridge screen. */
export function stepFor(unit: Unit, qty: number): number {
  if (unit === "g") return qty > 600 ? 100 : 50;
  if (unit === "ml") return qty > 1200 ? 250 : 100;
  if (unit === "pack") return 0.5;
  return 1;
}

// Fruit and veg people count rather than weigh, with a typical UK weight each (grams).
// Longest names first so "sweet potato" wins over "potato".
const COUNTABLE: [RegExp, string, number][] = [
  [/\bsweet potato(es)?\b/, "sweet potato", 200],
  [/\bspring onions?\b/, "spring onion", 15],
  [/\b(red |white |brown )?onions?\b/, "onion", 150],
  [/\bcarrots?\b/, "carrot", 75],
  [/\bpotato(es)?\b/, "potato", 170],
  [/\b(salad |vine |large vine |plum )?tomato(es)?\b/, "tomato", 85],
  [/\bpeppers?\b/, "pepper", 160],
  [/\bcourgettes?\b/, "courgette", 200],
  [/\baubergines?\b/, "aubergine", 250],
  [/\bcucumbers?\b/, "cucumber", 300],
  [/\bleeks?\b/, "leek", 200],
  [/\bparsnips?\b/, "parsnip", 100],
  [/\bbeetroots?\b/, "beetroot", 100],
  [/\blemons?\b/, "lemon", 100],
  [/\blimes?\b/, "lime", 65],
  [/\boranges?\b/, "orange", 180],
  [/\b(easy peelers?|satsumas?|clementines?|mandarins?)\b/, "easy peeler", 80],
  [/\bapples?\b/, "apple", 150],
  [/\bpears?\b/, "pear", 140],
  [/\bbananas?\b/, "banana", 120],
  [/\bavocados?\b/, "avocado", 170],
  [/\bgarlic( bulbs?)?\b/, "bulb", 45],
];
const NOT_WHOLE = /\b(pur[eé]e|paste|sauce|juice|crisps?|chips|tinned|tin|canned|chopped|frozen|powder|oil|dried|soup|ketchup|chutney|pickled|jam|cherry|baby|mix|salad bag|fries)\b/;

/** If people count this item (onions, carrots, lemons…), its name and typical weight each. */
export function countableAs(name: string): { label: string; gramsEach: number } | null {
  const n = name.toLowerCase();
  if (NOT_WHOLE.test(n)) return null;
  for (const [re, label, g] of COUNTABLE) {
    if (re.test(n)) return { label, gramsEach: /\b(mini|midi|small)\b/.test(n) ? Math.round(g * 0.65) : g };
  }
  return null;
}

/** Turn a weighed amount of countable produce into a count: 1 kg of carrots -> 13 carrots. */
export function asCount(name: string, amount: number, unit: Unit): { amount: number; unit: Unit; label: string | null } | null {
  if (unit !== "g") return null;
  const c = countableAs(name);
  if (!c) return null;
  return { amount: Math.max(1, Math.round(amount / c.gramsEach)), unit: "piece", label: c.label };
}
