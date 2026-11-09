import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIPES, avoided, checkRecipe, deductions, matchesHome, matchesItem, needIn, rankRecipes, scaled, type Recipe } from "../lib/recipes.ts";
import type { PantryItem } from "../lib/pantry.ts";

let n = 0;
const item = (over: Partial<PantryItem>): PantryItem => ({
  id: `i${++n}`, name: "Thing", category: null, storage: "fridge", unit: "g", unit_label: null, qty: 100, start_qty: 100,
  use_by: null, cost_gbp: null, protein_g_total: null, fat_100: null, saturates_100: null, sugars_100: null, salt_100: null, fibre_100: null,
  status: "active", added_at: "2026-11-01", ...over,
});
const R = (id: string) => RECIPES.find((r) => r.id === id) as Recipe;
const ing = (r: Recipe, k: string) => r.ingredients.find((i) => i.k === k)!;

test("library is well formed: unique ids, steps only use real ingredients", () => {
  assert.ok(RECIPES.length >= 20);
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  for (const r of RECIPES) {
    const keys = new Set(r.ingredients.map((i) => i.k));
    assert.equal(keys.size, r.ingredients.length, `${r.id} has duplicate ingredient keys`);
    for (const s of r.steps) for (const u of s.uses ?? []) assert.ok(keys.has(u), `${r.id}: step uses unknown ${u}`);
    assert.ok(r.protein > 0 && r.minutes > 0 && r.serves > 0);
  }
});

test("matching avoids look-alikes", () => {
  const chicken = ing(R("chicken-curry"), "chicken");
  assert.ok(matchesItem("Chicken Breast Fillets", chicken));
  assert.ok(matchesItem("Chicken thighs", chicken));
  assert.ok(!matchesItem("Chicken stock cubes", chicken));
  assert.ok(!matchesItem("Rajan chicken powder", chicken));
  const eggs = ing(R("shakshuka"), "eggs");
  assert.ok(matchesItem("Large free range eggs", eggs));
  assert.ok(!matchesItem("Egg noodles", eggs));
  const peas = ing(R("chicken-fried-rice"), "peas");
  assert.ok(!matchesItem("Chickpeas", peas));
  const pepper = ing(R("shakshuka"), "pepper");
  assert.ok(matchesItem("Red peppers", pepper));
  assert.ok(!matchesItem("Black pepper", pepper));
  const fajita = ing(R("chicken-fajita-wraps"), "fajita");
  assert.ok(matchesItem("Fajita seasoning", fajita));
});

test("at-home staples count", () => {
  assert.ok(matchesHome(["Rice", "Eggs"], ing(R("chicken-fried-rice"), "rice")));
  assert.ok(matchesHome(["Spices"], ing(R("chicken-curry"), "masala")));
  assert.ok(matchesHome(["Yogurt"], ing(R("chicken-curry"), "yogurt")));
  assert.ok(matchesHome(["Salt & pepper"], ing(R("chicken-curry"), "salt")));
  assert.ok(!matchesHome(["Milk"], ing(R("chicken-curry"), "chicken")));
});

test("amounts convert between counts and weights", () => {
  const onion = ing(R("chicken-curry"), "onion");
  assert.equal(needIn(onion, 1, { name: "Brown onions", unit: "g" }), 150);
  const rice = ing(R("chicken-curry"), "rice");
  assert.equal(needIn(rice, 150, { name: "Basmati rice", unit: "g" }), 150);
  assert.equal(needIn(rice, 150, { name: "Rice", unit: "pack" }), null);
  const toms = ing(R("chicken-curry"), "toms");
  assert.equal(needIn(toms, 400, { name: "Chopped tomatoes", unit: "piece" }), 1);
  assert.equal(scaled(ing(R("chicken-fried-rice"), "chicken"), 2, 3), 450);
  assert.equal(scaled(ing(R("chicken-fried-rice"), "eggs"), 2, 1), 1);
});

test("check finds have, short and missing, and uses food going off", () => {
  const today = new Date("2026-11-09T12:00:00");
  const items = [
    item({ name: "Chicken breast", qty: 300, use_by: "2026-11-10" }),
    item({ name: "Eggs", unit: "piece", unit_label: "egg", qty: 6 }),
    item({ name: "Brown onions", unit: "piece", unit_label: "onion", qty: 3 }),
  ];
  const c = checkRecipe(R("chicken-curry"), 2, items, ["Rice", "Spices", "Cooking oil", "Salt & pepper", "Garlic", "Ginger"], today);
  assert.deepEqual(c.missing.map((l) => l.ing.k).sort(), ["toms", "yogurt"]);
  assert.deepEqual(c.short.map((l) => l.ing.k), ["chicken"]); // needs 350 g, has 300 g (less than 90%)
  assert.equal(c.soon.length, 1);
  const d = deductions(c);
  assert.deepEqual(d.map((x) => [x.item.name, x.amount]), [["Chicken breast", 300], ["Brown onions", 1]]);
});

test("ranking puts cook-now first, avoid list filters", () => {
  const items = [item({ name: "Eggs", unit: "piece", qty: 12 }), item({ name: "Cheddar", qty: 400 }), item({ name: "Ham slices", qty: 120 })];
  const ranked = rankRecipes(RECIPES, items, ["Butter", "Salt & pepper"]);
  assert.equal(ranked[0].recipe.id, "ham-cheese-omelette");
  assert.equal(ranked[0].check.missing.length, 0);
  assert.ok(avoided(R("prawn-noodles"), "shellfish"));
  assert.ok(avoided(R("chicken-curry"), "vegetarian"));
  assert.ok(!avoided(R("red-lentil-dal"), "vegan"));
  assert.ok(avoided(R("chicken-curry"), "mushrooms, chicken"));
  assert.ok(!rankRecipes(RECIPES, [], [], "vegetarian").some((r) => !r.recipe.veg));
});
