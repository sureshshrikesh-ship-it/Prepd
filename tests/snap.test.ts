import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_QUESTIONS, resolveSnap, type StockRef } from "../lib/snap.ts";

const item = (over: Record<string, unknown>) => ({
  name: "Thing", cat: "veg", qty: 1, unit: "pack", unit_label: null, storage: "fridge", keeps: "1 week",
  protein: null, n: null, conf: "high", f: null, ask: null, ...over,
});

test("receipt and other photos are passed through", () => {
  assert.deepEqual(resolveSnap('{"kind":"receipt"}', []), { kind: "receipt" });
  assert.deepEqual(resolveSnap('Here: {"kind":"other"}', []), { kind: "other" });
});

test("shopping photo: produce counted, questions kept, bad items dropped", () => {
  const reply = JSON.stringify({ kind: "shopping", notes: ["Bag partly hidden"], items: [
    item({ name: "Carrots", qty: 1000, unit: "g", ask: { q: "How many carrots?", type: "count", options: [] } }),
    item({ name: "Chicken thighs", cat: "meat", qty: 500, unit: "g", protein: 100,
      ask: { q: "Which pack?", type: "choice", options: [{ label: "500 g", qty: 500, unit: "g" }, { label: "1 kg", qty: 1000, unit: "g" }] } }),
    item({ name: "Eggs", cat: "eggs", qty: 12, unit: "piece", unit_label: "egg", protein: 75 }),
    { name: "", qty: "x" },
  ] });
  const r = resolveSnap(reply, []);
  assert.equal(r.kind, "shopping");
  if (r.kind !== "shopping") return;
  assert.equal(r.items.length, 3);
  assert.deepEqual([r.items[0].qty, r.items[0].unit, r.items[0].unit_label], [13, "piece", "carrot"]);
  assert.deepEqual(r.items[0].question, { type: "count", q: "How many carrots?", start: 13 });
  assert.equal(r.items[1].question?.type, "choice");
  assert.equal(r.items[1].protein_per_unit, 0.2);
  assert.equal(r.items[2].question, null);
  assert.deepEqual(r.notes, ["Bag partly hidden"]);
});

test("never more than five questions", () => {
  const items = Array.from({ length: 8 }, (_, i) => item({ name: `Tin ${i}`, ask: { q: "How many?", type: "count", options: [] } }));
  const r = resolveSnap(JSON.stringify({ kind: "shopping", items, notes: [] }), []);
  if (r.kind !== "shopping") return assert.fail();
  assert.equal(r.items.filter((i) => i.question).length, MAX_QUESTIONS);
});

test("fridge photo matches tracked stock by code and keeps its unit", () => {
  const stock: StockRef[] = [{ code: "F1", id: "milk", name: "Whole milk", qty: 2272, unit: "ml", unit_label: null }];
  const r = resolveSnap(JSON.stringify({ kind: "fridge", notes: [], items: [
    item({ name: "Milk", cat: "dairy", qty: 800, unit: "ml", f: "f1" }),
    item({ name: "Butter", cat: "dairy", qty: 250, unit: "g", f: "F7" }),
  ] }), stock);
  if (r.kind !== "fridge") return assert.fail();
  assert.deepEqual(r.items[0].match, { id: "milk", name: "Whole milk", before: 2272, unit: "ml", unit_label: null });
  assert.equal(r.items[0].qty, 800);
  assert.equal(r.items[1].match, null);
});
