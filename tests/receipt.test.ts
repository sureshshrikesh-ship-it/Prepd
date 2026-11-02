import { test } from "node:test";
import assert from "node:assert/strict";
import { accuracy, applyProductMap, extractJson, parseReceiptReply, rawKey, storeKey, totalGap } from "../lib/receipt.ts";
import { SettingsSchema, startDayAfter } from "../lib/plan.ts";

const wire = {
  store: "SPAR", branch: null, date: "2026-11-01", total: 3.99,
  items: [
    { raw: "LARGE VINE", name: "Vine tomatoes, large", cat: "veg", qty: 1, pack: null, pack_est: true, units: null, unit: null,
      price: 1.29, food: true, needs_input: false, storage: "counter", keeps: "1 week", protein: null, conf: "medium", note: null },
    { raw: "RAJAN CHILLI&LEMON S", name: "Rajan chilli and lemon snack", cat: "snacks_treats", qty: "1", pack: "100G", pack_est: true,
      units: null, unit: null, price: "£1.20", food: true, needs_input: false, storage: "cupboard", keeps: "2-4 weeks", protein: null, conf: "low", note: null },
    { raw: "Grocery NON VAT", name: "Grocery NON VAT", cat: "nonsense", qty: 1, pack: null, pack_est: false, units: null, unit: null,
      price: 1.5, food: true, needs_input: true, storage: "cupboard", keeps: "months", protein: null, conf: "weird", note: null },
  ],
  warnings: [],
};

test("parses fenced, minified reply into the app's item shape", () => {
  const r = parseReceiptReply("Here:\n```json\n" + JSON.stringify(wire) + "\n```");
  assert.equal(r.items.length, 3);
  assert.equal(r.items[1].line_total, 1.2);
  assert.equal(r.receipt_total, 3.99);
  assert.equal(r.items[0].source, "model");
});

test("repairs unknown enums and keeps needs_input", () => {
  const r = parseReceiptReply(JSON.stringify(wire));
  assert.equal(r.items[2].category, "snacks_treats");
  assert.equal(r.items[2].confidence, "low");
  assert.equal(r.items[2].needs_input, true);
});

test("total check matches to the penny", () => {
  const r = parseReceiptReply(JSON.stringify(wire));
  assert.equal(totalGap(r), 0);
});

test("product map overrides the model's guess for known lines", () => {
  const r = applyProductMap(parseReceiptReply(JSON.stringify(wire)), [
    { raw: "rajan  chilli&lemon s ", name: "Rajan chilli & lemon chicken seasoning", category: "condiments", is_food: true, pack_size: null, units_per_pack: null, unit_name: null },
  ]);
  assert.equal(r.items[1].name, "Rajan chilli & lemon chicken seasoning");
  assert.equal(r.items[1].category, "condiments");
  assert.equal(r.items[1].source, "map");
  assert.equal(r.items[0].source, "model");
});

test("store and raw keys normalise", () => {
  assert.equal(storeKey("ALDI STORES"), "aldi");
  assert.equal(storeKey("Sainsbury's Local"), "sainsburys");
  assert.equal(storeKey(null), "unknown");
  assert.equal(rawKey("  yogurt   protein "), "YOGURT PROTEIN");
});

test("accuracy counts missed lines against the score", () => {
  assert.equal(accuracy(["right", "right", "wrong", null], 1), 0.5);
  assert.equal(accuracy([null, null], 0), null);
});

test("rejects a reply with no JSON", () => {
  assert.throws(() => extractJson("Sorry, I can't read that."));
});

test("settings fall back to sensible defaults", () => {
  const s = SettingsSchema.parse({ protein_g: "9999", prep_days: null, avoid: null });
  assert.equal(s.protein_g, 150);
  assert.deepEqual(s.prep_days, ["Sun", "Wed"]);
  assert.equal(s.avoid, "");
});

test("plan starts on the next planned weekday after the shop", () => {
  assert.equal(startDayAfter(new Date("2026-11-01T12:00:00Z"), ["Mon", "Tue"]), "Mon 2026-11-02"); // shop on Sunday
  assert.equal(startDayAfter(new Date("2026-10-30T12:00:00Z"), ["Mon"]), "Mon 2026-11-02"); // shop on Friday
});

test("planned days come back in week order", () => {
  const s = SettingsSchema.parse({ plan_days: ["Mon", "Tue", "Wed", "Fri", "Thu"], prep_days: ["Wed", "Sun"] });
  assert.deepEqual(s.plan_days, ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  assert.deepEqual(s.prep_days, ["Wed", "Sun"]);
});

test("plan accepts amounts as a string or a list", async () => {
  const { parsePlanReply } = await import("../lib/plan.ts");
  const day = (amounts: unknown) => ({ day: "Mon", protein_g: 50, cost_gbp: 2, gap_g: 0,
    meals: [{ slot: "lunch", name: "Chicken rice", amounts, protein_g: 50, cost_gbp: 2, minutes: 0, from_prep: true }] });
  assert.equal(parsePlanReply(JSON.stringify({ summary: "", days: [day("200 g chicken")] })).days[0].meals[0].amounts, "200 g chicken");
  assert.equal(parsePlanReply(JSON.stringify({ summary: "", days: [day(["200 g chicken", "150 g rice"])] })).days[0].meals[0].amounts, "200 g chicken · 150 g rice");
});

test("UK traffic-light flags for food and drinks", async () => {
  const { itemFlags, fromArray, dayWarnings, isLiquid } = await import("../lib/nutrition.ts");
  const chorizo = fromArray([30, 11, 2, 2.8, 0]);
  assert.deepEqual(itemFlags(chorizo, false).map((f) => f.label), ["High fat", "High sat fat", "High salt"]);
  const lentils = fromArray([1.3, 0.2, 1.4, 0, 11]);
  assert.deepEqual(itemFlags(lentils, false).map((f) => f.label), ["High fibre"]);
  const oats = fromArray([8, 1.5, 1, 0, 4.5]);
  assert.deepEqual(itemFlags(oats, false).map((f) => f.label), ["Source of fibre"]);
  const cola = fromArray([0, 0, 10.6, 0, 0]);
  assert.deepEqual(itemFlags(cola, true), []); // 10.6 g/100 ml is under the 11.25 drink threshold
  assert.equal(isLiquid("dairy", "Whole milk 4 pints"), true);
  assert.equal(fromArray([2, 5, 1, 0, 0]), null); // saturates above fat is impossible
  assert.deepEqual(dayWarnings({ fibre_g: 20, fat_g: 50, sat_fat_g: 24, sugar_g: 10, salt_g: 7 }),
    ["High in saturated fat: 24 g (daily guide 20 g)", "High in salt: 7 g (daily guide 6 g)"]);
});

test("reader output carries nutrition for food only", () => {
  const r = parseReceiptReply(JSON.stringify({ ...wire, items: [
    { ...wire.items[0], n: [0.3, 0.1, 3.1, 0, 1.2] },
    { ...wire.items[1], food: false, n: [1, 1, 1, 1, 1] },
  ] }));
  assert.deepEqual(r.items[0].nutrition, { fat: 0.3, saturates: 0.1, sugars: 3.1, salt: 0, fibre: 1.2 });
  assert.equal(r.items[1].nutrition, null);
});

test("at-home chips and free text combine for the plan", async () => {
  const { atHomeText } = await import("../lib/plan.ts");
  assert.equal(atHomeText({ at_home_items: ["Rice", "Oats"], at_home: " paneer, ,frozen parathas" }), "Rice, Oats, paneer, frozen parathas");
});
