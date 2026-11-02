// Nutrition flags using UK rules, applied by the app (not the model) so they are consistent.
// Item thresholds: FSA/DHSC front-of-pack "traffic light" guidance (per 100 g, or per 100 ml for drinks).
// Fibre claims: "source of fibre" >= 3 g/100 g, "high fibre" >= 6 g/100 g (UK nutrition and health claims rules).
// Daily guides: adult reference intakes (fat 70 g, saturates 20 g, sugars 90 g, salt 6 g); SACN fibre 30 g/day.

export type Nutrition = { fat: number; saturates: number; sugars: number; salt: number; fibre: number };
export type Flag = { label: string; tone: "warn" | "good" };

const FOOD = { fat: 17.5, saturates: 5, sugars: 22.5, salt: 1.5 };
const DRINK = { fat: 8.75, saturates: 2.5, sugars: 11.25, salt: 0.75 };

export const DAILY = { fat: 70, saturates: 20, sugars: 90, salt: 6, fibre: 30 };

export function isLiquid(category: string, name: string): boolean {
  return category === "drinks" || (category === "dairy" && /\b(milk|drink|kefir|lassi)\b/i.test(name));
}

/** Flags for one product, from its per-100 g (or ml) values. Highs first, then fibre. */
export function itemFlags(n: Nutrition | null | undefined, liquid: boolean): Flag[] {
  if (!n) return [];
  const t = liquid ? DRINK : FOOD;
  const out: Flag[] = [];
  if (n.fat > t.fat) out.push({ label: "High fat", tone: "warn" });
  if (n.saturates > t.saturates) out.push({ label: "High sat fat", tone: "warn" });
  if (n.sugars > t.sugars) out.push({ label: "High sugar", tone: "warn" });
  if (n.salt > t.salt) out.push({ label: "High salt", tone: "warn" });
  if (!liquid && n.fibre >= 6) out.push({ label: "High fibre", tone: "good" });
  else if (!liquid && n.fibre >= 3) out.push({ label: "Source of fibre", tone: "good" });
  return out;
}

export type DayNutrients = { fibre_g: number; fat_g: number; sat_fat_g: number; sugar_g: number; salt_g: number };

/** Warnings for a day's planned meals against adult daily reference intakes. */
export function dayWarnings(d: DayNutrients): string[] {
  const out: string[] = [];
  const over = (v: number, guide: number, what: string) => {
    if (v > guide) out.push(`High in ${what}: ${Math.round(v * 10) / 10} g (daily guide ${guide} g)`);
  };
  over(d.fat_g, DAILY.fat, "fat");
  over(d.sat_fat_g, DAILY.saturates, "saturated fat");
  over(d.sugar_g, DAILY.sugars, "sugar");
  over(d.salt_g, DAILY.salt, "salt");
  return out;
}

/** Parse the reader's compact [fat, saturates, sugars, salt, fibre] array. */
export function fromArray(a: number[] | null | undefined): Nutrition | null {
  if (!a || a.length !== 5 || a.some((x) => !Number.isFinite(x) || x < 0 || x > 100)) return null;
  const [fat, saturates, sugars, salt, fibre] = a;
  if (saturates > fat + 0.5) return null; // impossible reading
  return { fat, saturates, sugars, salt, fibre };
}
