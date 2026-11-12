// Tests the "may be in inventory" matching in the send-order edge function.
// Run: node --experimental-strip-types tests/inventory-match.mjs
// Loads the real function file with a stand in for Deno, so nothing is sent.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

globalThis.Deno = { serve() {}, env: { get() { return ""; } } };
const dir = mkdtempSync(join(tmpdir(), "inv-"));
copyFileSync(new URL("../supabase/functions/send-order/index.ts", import.meta.url), join(dir, "send-order.ts"));
const { inventoryMatches, reference } = await import(join(dir, "send-order.ts"));

const stock = [
  { id: "a", style: "Clear 1-Lite", width_in: "30.000", height_in: "80.000", core: "Solid", qty: 2, notes: "Rack B" },
  { id: "b", style: "Shaker 2 Panel", width_in: 28, height_in: 80, core: "Hollow", qty: 1 },
  { id: "c", style: "Shaker 2 Panel", width_in: 28, height_in: 80, core: "Hollow", qty: 0 },
  { id: "d", style: "Barn Plank", width_in: 36, height_in: 84, core: "Solid", qty: 1 },
];
const rows = [
  { doorStyle: "clear 1 lite", width: "30", height: "80", productType: "1.375 Glass", qty: 1, location: "Bed 1" }, // 1 match, glass is solid
  { doorStyle: "Clear 1 Lite", width: "30", height: "80", productType: "1.375 Hollow" },  // core differs
  { doorStyle: "Shaker 2 Panel", width: "28", height: "80", productType: "1.375 Hollow", qty: 2 }, // b only, c is empty
  { doorStyle: "Shaker 2 Panel", width: "28 1/2", height: "80", productType: "1.375 Hollow" }, // size differs
  { doorStyle: "Custom", customStyle: "Barn-Plank", width: "36", height: "84", productType: "" }, // typed name, unknown core
  { doorStyle: "Custom", width: "36", height: "84" },                                       // custom with no name
  { doorStyle: "Clear 1 Lite", width: "", height: "80" },                                   // no width
];
const got = inventoryMatches(rows, stock);
assert.deepEqual(got.map((m) => [m.line, m.stock.map((d) => d.id).join()]),
  [[1, "a"], [3, "b"], [5, "d"]]);
assert.equal(got[0].location, "Bed 1");
assert.equal(got[1].wanted, 2);
assert.equal(got[2].style, "Barn-Plank");
assert.deepEqual(inventoryMatches(undefined, stock), []);
assert.deepEqual(inventoryMatches(rows, []), []);
assert.equal(inventoryMatches([{ doorStyle: "Clear 1-Lite", width: "29.5", height: "80" }],
  [{ ...stock[0], width_in: "29.500" }]).length, 1);
assert.equal(inventoryMatches([{ doorStyle: "Clear 1-Lite", width: "29-1/2", height: "80\"" }],
  [{ ...stock[0], width_in: 29.5 }]).length, 1);

// Cross referenced with the existing tables: the alias table makes the
// portal's name and the price list's name one door, and a style the price
// list only sells in solid is solid even when the line says nothing.
const ref = reference(
  [{ style: "Clear 1-Lite", size_key: "6'8|Solid", price: 359.31 },
   { style: "Clear 1-Lite", size_key: "6'8|Hollow", price: null },
   { style: "Columbia", size_key: "6'8|Hollow", price: 212.77 },
   { style: "Columbia", size_key: "6'8|Solid", price: 303.84 },
   { style: "Columbia", size_key: "6'8|Bifold", price: 226.71 }],
  [{ order_style: "Samish (Smooth)", price_style: "Columbia" }]);
const shelf = [
  { id: "s1", style: "Columbia", width_in: 30, height_in: 80, core: "Hollow", qty: 1 },
  { id: "s2", style: "Columbia", width_in: 30, height_in: 80, core: "Bifold", qty: 1 },
  { id: "s3", style: "Clear 1-Lite", width_in: 30, height_in: 80, core: "Solid", qty: 1 },
];
const lines = [
  { doorStyle: "Samish (Smooth)", width: "30", height: "80", productType: "1.375 Hollow", doorType: "Single Swing" },
  { doorStyle: "Samish (Smooth)", width: "30", height: "80", productType: "1.375 Hollow", doorType: "Bifold" },
  { doorStyle: "Samish (Smooth)", width: "30", height: "80", productType: "1.75 Thick" },
  { doorStyle: "Clear 1 Lite", width: "30", height: "80", productType: "" },
];
assert.deepEqual(inventoryMatches(lines, shelf, ref).map((m) => [m.line, m.core, m.stock.map((d) => d.id).join()]),
  [[1, "Hollow", "s1"], [2, "Bifold", "s2"], [4, "Solid", "s3"]]);
// without the alias table, the portal's name finds nothing
assert.equal(inventoryMatches(lines.slice(0, 1), shelf, reference()).length, 0);
console.log("inventory matching: all good");
