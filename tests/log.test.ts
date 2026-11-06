import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLog, type StockLine } from "../lib/log.ts";
import { asCount, countableAs } from "../lib/pantry.ts";

const stock: StockLine[] = [
  { code: "F1", id: "eggs", name: "Free range eggs", qty: 6, unit: "piece", unit_label: "egg" },
  { code: "F2", id: "spin", name: "Baby spinach", qty: 200, unit: "g", unit_label: null },
  { code: "F3", id: "cor", name: "Fresh coriander", qty: 25, unit: "g", unit_label: null },
  { code: "F4", id: "milk", name: "Whole milk", qty: 500, unit: "ml", unit_label: null },
];

test("quick log turns a note into capped, confirmable changes", () => {
  const reply = JSON.stringify({
    changes: [
      { f: "F1", kind: "used", qty: 3 },
      { f: "f2", kind: "used", qty: 50 },
      { f: "F3", kind: "binned", qty: null },
      { f: "F4", kind: "used", qty: 900 },   // more than is left -> finished
      { f: "F9", kind: "used", qty: 1 },     // invented code -> dropped
      { f: "F1", kind: "used", qty: 1 },     // same item twice -> first wins
      { f: "F2", kind: "used", qty: null },  // used with no amount -> dropped (already seen anyway)
    ],
    new_items: [{ name: "Milk", qty: 2272, unit: "ml", unit_label: null, storage: "fridge", keeps: "1 week" }],
    unclear: ["the curry"],
  });
  const out = resolveLog(reply, stock);
  assert.deepEqual(out.changes.map((c) => [c.item_id, c.kind, c.delta, c.after]), [
    ["eggs", "used", -3, "3 eggs"],
    ["spin", "used", -50, "150 g"],
    ["cor", "binned", -25, "binned"],
    ["milk", "finished", -500, "0 ml"],
  ]);
  assert.equal(out.new_items.length, 1);
  assert.deepEqual(out.unclear, ["the curry"]);
});

test("fruit and veg are counted, not weighed", () => {
  assert.deepEqual(asCount("Carrots", 1000, "g"), { amount: 13, unit: "piece", label: "carrot" });
  assert.deepEqual(asCount("Red onions", 500, "g"), { amount: 3, unit: "piece", label: "onion" });
  assert.deepEqual(asCount("Sweet potatoes", 1000, "g"), { amount: 5, unit: "piece", label: "sweet potato" });
  assert.equal(countableAs("Mini apples")?.gramsEach, 98);
  assert.equal(asCount("Tomato purée, double concentrate", 200, "g"), null);
  assert.equal(asCount("Cherry tomatoes", 250, "g"), null);
  assert.equal(asCount("Frozen mixed peppers", 500, "g"), null);
  assert.equal(asCount("Chicken breast", 1000, "g"), null);
  assert.equal(asCount("Carrots", 2, "pack"), null);
});
