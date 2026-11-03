import { test } from "node:test";
import assert from "node:assert/strict";
import { daysLeft, formatQty, parsePack, stepFor, useByFrom, useByLabel } from "../lib/pantry.ts";
import { parsePlanReply, resolveUses, startDayAfter } from "../lib/plan.ts";

test("pack sizes become stock amounts", () => {
  assert.deepEqual(parsePack("1KG", 1, null, null), { amount: 1000, unit: "g", label: null });
  assert.deepEqual(parsePack("4PT", 1, null, null), { amount: 2272, unit: "ml", label: null });
  assert.deepEqual(parsePack("1l", 2, null, null), { amount: 2000, unit: "ml", label: null });
  assert.deepEqual(parsePack("6x32g", 1, null, null), { amount: 192, unit: "g", label: null });
  assert.deepEqual(parsePack("7PK", 1, null, null), { amount: 7, unit: "piece", label: null });
  assert.deepEqual(parsePack("4x145g", 1, 4, "Tin"), { amount: 4, unit: "piece", label: "tin" });
  assert.deepEqual(parsePack(null, 3, 12, "egg"), { amount: 36, unit: "piece", label: "egg" });
  assert.deepEqual(parsePack(null, 2, null, null), { amount: 2, unit: "pack", label: null });
  assert.deepEqual(parsePack("circa 290G", 1, null, null), { amount: 290, unit: "g", label: null });
});

test("use-by estimates are conservative and freezer keeps long", () => {
  const sun = new Date("2026-11-01T18:00:00Z");
  assert.equal(useByFrom("use-by on pack", "fridge", sun), "2026-11-03");
  assert.equal(useByFrom("3-5 days", "fridge", sun), "2026-11-04");
  assert.equal(useByFrom("months", "cupboard", sun), "2027-01-30");
  assert.equal(useByFrom("1-2 days", "freezer", sun), "2027-01-30");
  assert.equal(useByFrom("something odd", "fridge", sun), "2026-11-08");
});

test("amounts read naturally", () => {
  assert.equal(formatQty(1200, "g"), "1.2 kg");
  assert.equal(formatQty(350, "g"), "350 g");
  assert.equal(formatQty(2272, "ml"), "2.3 l");
  assert.equal(formatQty(1, "piece", "egg"), "1 egg");
  assert.equal(formatQty(6, "piece", "egg"), "6 eggs");
  assert.equal(formatQty(3, "piece", "peach"), "3 peaches");
  assert.equal(formatQty(2, "piece", "berry"), "2 berries");
  assert.equal(formatQty(0.5, "pack"), "0.5 packs");
  assert.equal(stepFor("g", 1000), 100);
  assert.equal(stepFor("piece", 6), 1);
});

test("use-by labels", () => {
  const today = new Date(2026, 10, 3);
  assert.equal(daysLeft("2026-11-03", today), 0);
  assert.equal(useByLabel(daysLeft("2026-11-02", today)).text, "Past its date");
  assert.equal(useByLabel(daysLeft("2026-11-04", today)).text, "Use tomorrow");
  assert.equal(useByLabel(daysLeft("2026-11-06", today)).tone, "warn");
  assert.equal(useByLabel(null).text, "");
});

test("planner codes resolve to pantry ids, invented codes drop, uses are capped at stock", () => {
  const plan = parsePlanReply(JSON.stringify({ summary: "", days: [{ day: "Mon", meals: [{ slot: "dinner", name: "Stir-fry", amounts: "",
    uses: [{ f: "F1", qty: 250 }, { f: "f2", qty: 9 }, { f: "F9", qty: 1 }, { f: "F1", qty: 0 }] }] }] }));
  const out = resolveUses(plan, [
    { code: "F1", id: "a", name: "Chicken", qty: 1000 },
    { code: "F2", id: "b", name: "Onions", qty: 3 },
  ]);
  assert.deepEqual(out.days[0].meals[0].uses, [
    { pantry_id: "a", name: "Chicken", qty: 250 },
    { pantry_id: "b", name: "Onions", qty: 3 },
  ]);
});

test("plan can start today when asked", () => {
  const mon = new Date("2026-11-02T09:00:00");
  assert.equal(startDayAfter(mon, ["Mon", "Tue"], true), "Mon 2026-11-02");
  assert.equal(startDayAfter(mon, ["Mon", "Tue"]), "Tue 2026-11-03");
});
