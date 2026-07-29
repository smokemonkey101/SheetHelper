const test = require("node:test");
const assert = require("node:assert/strict");
const {
  driveFolderIdFrom,
  parseReceiptText,
  photoFileName,
  receiptFileName,
  sheetDefinitions,
  spreadsheetIdFrom
} = require("../dist/server.js");

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
  assert.deepEqual(parsed.lineItems, [
    "Item: Hammer, Amount: 1, Cost Per: 12.99",
    "Item: Box of nails, Amount: 1, Cost Per: 4.50"
  ]);
});

test("receipt parser handles split totals and quantity-at-unit-price items", () => {
  const parsed = parseReceiptText(`
    HOME IMPROVEMENT STORE
    27 GAL Tough Storage TOTE BLK/YLW
    2018.47
    36.94
    Deck Screws
    3 @ 7.35
    22.05
    SUBTOTAL
    58.99
    TAX
    5.16
    TOTAL
    $64.15
  `);
  assert.equal(parsed.total, "64.15");
  assert.deepEqual(parsed.lineItems, [
    "Item: 27 GAL Tough Storage TOTE BLK/YLW, Amount: 2, Cost Per: 18.47",
    "Item: Deck Screws, Amount: 3, Cost Per: 7.35"
  ]);
});

test("upload names are safe and predictable", () => {
  assert.equal(photoFileName("Smith / Kitchen", "2026-07-26"), "Smith_Kitchen_2026-07-26.jpg");
  assert.equal(photoFileName("Smith / Kitchen", "2026-07-26", 2), "Smith_Kitchen_2026-07-26_2.jpg");
  assert.equal(receiptFileName("Smith / Kitchen", "2026-07-26"), "Smith_Kitchen_receipt_2026-07-26.jpg");
});

test("workbook tabs and columns match the application contract", () => {
  assert.deepEqual(sheetDefinitions, {
    Jobs: ["Job"],
    Photos: ["Job", "Person", "Date", "Photo"],
    Reports: ["Job", "Person", "Date", "Report"],
    Receipt: [
      "Job", "Person", "Date", "Photo", "Total",
      ...Array.from({ length: 20 }, (_, index) => `Line Item ${index + 1}`)
    ]
  });
});

test("Google URLs are normalized to resource IDs", () => {
  assert.equal(
    spreadsheetIdFrom("https://docs.google.com/spreadsheets/d/abc123_xyz/edit#gid=0"),
    "abc123_xyz"
  );
  assert.equal(
    driveFolderIdFrom("https://drive.google.com/drive/u/1/folders/folder_456?usp=sharing"),
    "folder_456"
  );
  assert.equal(driveFolderIdFrom("already-an-id"), "already-an-id");
});
