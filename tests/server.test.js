const test = require("node:test");
const assert = require("node:assert/strict");
const {
  driveFolderIdFrom,
  taskToDosFromRows,
  parseReceiptText,
  photoFileName,
  receiptFileName,
  sheetDefinitions,
  spreadsheetIdFrom,
  uploadedFileName,
  usersFromJobRows
} = require("../dist/server.js");

test("receipt parser finds total, store, and purchase date", () => {
  const parsed = parseReceiptText(`
    HARDWARE STORE
    Receipt Date 7/30/2026
    Hammer 12.99
    Box of nails 4.50
    Subtotal 17.49
    Tax 1.44
    TOTAL $18.93
    VISA 18.93
  `);
  assert.deepEqual(parsed, { total: "18.93", store: "HARDWARE STORE", purchaseDate: "2026-07-30" });
});

test("receipt parser handles split totals", () => {
  const parsed = parseReceiptText(`
    THE HOME DEPOT
    10/11/23 02:14 PM
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
  assert.equal(parsed.purchaseDate, "2023-10-11");
});

test("invoice parser prefers order total over zero balance", () => {
  const parsed = parseReceiptText(`
    Customer Receipt
    THE HOME DEPOT
    5/26/2026, 3:05 PM PDT
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
  assert.equal(parsed.purchaseDate, "2026-05-26");
});

test("invoice parser recognizes suppliers and labeled dates", () => {
  const builders = parseReceiptText(`
    Builders FirstSource
    DATE 04-17-26
    QTY ITEM NO. DESCRIPTION U/M UNIT PRICE EXTENDED PRICE
    20 51214DF18GL 5-1/2X14 GLAM LF 27.50 550.00
    SUBTOTAL 550.00 TAX .00 TOTAL 550.00
  `);
  assert.equal(builders.store, "Builders FirstSource");
  assert.equal(builders.total, "550.00");
  assert.equal(builders.purchaseDate, "2026-04-17");

  const parr = parseReceiptText(`
    PARR Lumber
    INVOICE DATE 04/27/2026
    ORDERED DESCRIPTION PRICE AMOUNT
    1 4812CD 4x8 15/32 4-Ply Cdx Plywood 26.16 ea 26.16
    TOTAL $26.16
  `);
  assert.equal(parr.store, "Parr Lumber");
  assert.equal(parr.purchaseDate, "2026-04-27");
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
    Receipt: ["Job", "Person", "Date", "Photo", "Total", "Store", "Purchase Date"],
    "Task Reports": ["Job", "Person", "Date", "Task", "Input"],
    "Task ToDo": ["Job", "Date Assigned", "Assigned To", "Status", "Task"],
    Accounting: ["Job", "Person", "Date", "File", "Tag"],
    Leads: ["Job", "Person", "Date", "File", "Tag"],
    Other: ["Job", "Person", "Date", "File", "Tag"]
  });
});

test("uploaded files keep safe extensions and category names", () => {
  assert.equal(
    uploadedFileName("Smith / Kitchen", "2026-07-30", "invoice.PDF", "application/pdf", "Accounting"),
    "Smith_Kitchen_Accounting_2026-07-30.pdf"
  );
});

test("unfinished tasks come from Task ToDo and preserve their rows", () => {
  assert.deepEqual(
    taskToDosFromRows([
      ["Test", "2026-08-01", "Allan", "", "Order lumber"],
      ["Test", "2026-08-01", "Allan", "Finished", "Schedule inspection"],
      ["Other job", "2026-08-01", "Diana", "", "Unrelated task"]
    ], "Test"),
    [
      {
        id: "1",
        job: "Test",
        dateAssigned: "2026-08-01",
        assignedTo: "Allan",
        status: "",
        text: "Order lumber",
        rowIndex: 1
      }
    ]
  );
});

test("worker codes come from Jobs columns E and F", () => {
  assert.deepEqual(usersFromJobRows([
    ["Allan", "1234"],
    ["Missing pin", ""],
    ["Diana", "5678"]
  ]), [
    { name: "Allan", pin: "1234" },
    { name: "Diana", pin: "5678" }
  ]);
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
