const test = require("node:test");
const assert = require("node:assert/strict");
const { parseReceiptText, photoFileName, receiptFileName, sheetDefinitions } = require("../dist/server.js");

test("receipt parser finds the final total and purchased items", () => {
  const parsed = parseReceiptText(`
    HARDWARE STORE
    Hammer 12.99
    Box of nails 4.50
    Subtotal 17.49
    Tax 1.44
    TOTAL $18.93
    VISA 18.93
  `);
  assert.equal(parsed.total, "18.93");
  assert.equal(parsed.lineItems, "Hammer — 12.99\nBox of nails — 4.50");
});

test("upload names are safe and predictable", () => {
  assert.equal(photoFileName("Smith / Kitchen", "2026-07-26"), "Smith_Kitchen_2026-07-26.jpg");
  assert.equal(photoFileName("Smith / Kitchen", "2026-07-26", 2), "Smith_Kitchen_2026-07-26_2.jpg");
  assert.equal(receiptFileName("Smith / Kitchen", "2026-07-26"), "Smith_Kitchen_receipt_2026-07-26.jpg");
});

test("workbook tabs and columns match the application contract", () => {
  assert.deepEqual(sheetDefinitions, {
    Jobs: ["Job"],
    Photos: ["Job", "Date", "Photo"],
    Reports: ["Job", "Date", "Report"],
    Receipt: ["Job", "Date", "Photo", "Total", "Line Items"]
  });
});
