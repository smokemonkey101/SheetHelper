const test = require("node:test");
const assert = require("node:assert/strict");
const {
  driveFolderIdFrom,
  jobTasksFromRows,
  parseReceiptText,
  photoFileName,
  receiptFileName,
  sheetDefinitions,
  spreadsheetIdFrom,
  uploadedFileName
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
    { item: "Hammer", amount: "1", costPer: "12.99" },
    { item: "Box of nails", amount: "1", costPer: "4.50" }
  ]);
});

test("receipt parser handles split totals and quantity-at-unit-price items", () => {
  const parsed = parseReceiptText(`
    THE HOME DEPOT
    066785314502 HDX TOTE <A>
    27 GAL TOUGH STORAGE TOTE BLK/YLW
    2018.47
    36.94
    049206111873 PAINT BRSH <A>
    2 IN ANGLED SASH POLY BRUSH
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
  assert.equal(parsed.store, "Home Depot");
  assert.deepEqual(parsed.lineItems, [
    { item: "HDX TOTE <A>", amount: "2", costPer: "18.47" },
    { item: "PAINT BRSH <A>", amount: "3", costPer: "7.35" }
  ]);
});

test("invoice parser prefers order total over zero balance and reads table rows", () => {
  const parsed = parseReceiptText(`
    Customer Receipt
    THE HOME DEPOT
    Item Description Unit Price Qty Subtotal
    3 American Standard Reliant Toilet 119.00 each 357.00
    1 Delta Classic Bathtub 339.00 each 339.00
    Subtotal $6,599.85
    Discounts -$867.99
    Sales Tax $0.00
    Order Total $5,731.86
    Balance Due $0.00
  `);
  assert.equal(parsed.store, "Home Depot");
  assert.equal(parsed.total, "5731.86");
  assert.deepEqual(parsed.lineItems, [
    { item: "American Standard Reliant Toilet", amount: "3", costPer: "119.00" },
    { item: "Delta Classic Bathtub", amount: "1", costPer: "339.00" }
  ]);
});

test("invoice parser recognizes construction suppliers and sales-order rows", () => {
  const builders = parseReceiptText(`
    Builders FirstSource
    QTY ITEM NO. DESCRIPTION U/M UNIT PRICE EXTENDED PRICE
    20 51214DF18GL 5-1/2X14 GLAM LF 27.50 550.00
    SUBTOTAL 550.00 TAX .00 TOTAL 550.00
  `);
  assert.equal(builders.store, "Builders FirstSource");
  assert.equal(builders.total, "550.00");
  assert.deepEqual(builders.lineItems, [
    { item: "51214DF18GL 5-1/2X14 GLAM", amount: "20", costPer: "27.50" }
  ]);

  const parr = parseReceiptText(`
    PARR Lumber
    ORDERED DESCRIPTION PRICE AMOUNT
    1 4812CD 4x8 15/32 4-Ply Cdx Plywood 26.16 ea 26.16
    TOTAL $26.16
  `);
  assert.equal(parr.store, "Parr Lumber");
  assert.deepEqual(parr.lineItems, [
    { item: "4812CD 4x8 15/32 4-Ply Cdx Plywood", amount: "1", costPer: "26.16" }
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
    Receipt: ["Job", "Person", "Date", "Photo", "Total", "Store", "Line Item", "Amount", "Cost Per"],
    Tasks: ["Job", "Person", "Date", "Task", "Input"],
    Accounting: ["Job", "Person", "Date", "File"],
    Leads: ["Job", "Person", "Date", "File"],
    Other: ["Job", "Person", "Date", "File"]
  });
});

test("uploaded files keep safe extensions and category names", () => {
  assert.equal(
    uploadedFileName("Smith / Kitchen", "2026-07-30", "invoice.PDF", "application/pdf", "Accounting"),
    "Smith_Kitchen_Accounting_2026-07-30.pdf"
  );
});

test("tasks come from the selected Jobs row and preserve their sheet cells", () => {
  assert.deepEqual(
    jobTasksFromRows([
      ["Test", "Order lumber", "", "Schedule inspection"],
      ["Other job", "Unrelated task"]
    ], "Test"),
    [
      { id: "1:1", text: "Order lumber", rowIndex: 1, columnIndex: 1 },
      { id: "1:3", text: "Schedule inspection", rowIndex: 1, columnIndex: 3 }
    ]
  );
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
