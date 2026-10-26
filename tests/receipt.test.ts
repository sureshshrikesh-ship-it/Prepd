import { test } from "node:test";
import assert from "node:assert/strict";
import { accuracy, extractJson, parseReceiptReply, totalGap } from "../lib/receipt.ts";

const reply = {
  store: "Aldi", branch: "Edgbaston Road", date: "2026-10-25", receipt_total: 3.99,
  items: [
    { raw: "LARGE VINE", name: "Vine tomatoes, large", category: "veg", qty: 1, pack_size: null, pack_size_estimated: true,
      line_total: 1.29, is_food: true, storage: "counter", keeps: "1-2 weeks", protein_g: null, confidence: "medium", note: null },
    { raw: "YOGURT PROTEIN", name: "Protein yogurt", category: "dairy", qty: "3", pack_size: "200g", pack_size_estimated: false,
      line_total: "£2.25", is_food: true, storage: "fridge", keeps: "1-2 weeks", protein_g: 60, confidence: "high", note: null },
    { raw: "CLEAR HONEY", name: "Clear honey", category: "spreads", qty: 1, pack_size: "340g", pack_size_estimated: true,
      line_total: 0.45, is_food: true, storage: "cupboard", keeps: "months", protein_g: null, confidence: "nope", note: null },
  ],
  warnings: [],
};

test("parses a fenced reply with chatter around it", () => {
  const r = parseReceiptReply("Here you go:\n```json\n" + JSON.stringify(reply) + "\n```\nDone.");
  assert.equal(r.items.length, 3);
  assert.equal(r.items[1].qty, 3);
  assert.equal(r.items[1].line_total, 2.25);
});

test("repairs unknown enums instead of failing the whole receipt", () => {
  const r = parseReceiptReply(JSON.stringify(reply));
  assert.equal(r.items[2].category, "snacks_treats");
  assert.equal(r.items[2].confidence, "low");
});

test("total check matches to the penny", () => {
  const r = parseReceiptReply(JSON.stringify(reply));
  assert.equal(totalGap(r), 0);
  assert.equal(totalGap({ ...r, receipt_total: null }), null);
});

test("accuracy counts missed lines against the score", () => {
  assert.equal(accuracy(["right", "right", "wrong", null], 1), 0.5);
  assert.equal(accuracy([null, null], 0), null);
});

test("rejects a reply with no JSON", () => {
  assert.throws(() => extractJson("Sorry, I can't read that."));
});
