import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderDocumentPdf, type PdfSnapshot } from "../src/lib/documents/pdf";
import { getPrivateObject, headPrivateObject, putPrivateObject, PrivateStorageError } from "../src/lib/documents/storage";

async function main(): Promise<void> {
const original = {
  driver: process.env.DOCUMENTS_STORAGE_DRIVER,
  root: process.env.DOCUMENTS_STORAGE_LOCAL_ROOT,
  bucket: process.env.DOCUMENTS_STORAGE_BUCKET,
  endpoint: process.env.DOCUMENTS_STORAGE_ENDPOINT,
};
const tempRoot = await mkdtemp(join(tmpdir(), "fx-documents-test-"));

function sha(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
function snapshot(sourceType: PdfSnapshot["sourceType"], brandName: string): PdfSnapshot {
  const lines = Array.from({ length: sourceType === "INVOICE" ? 80 : sourceType === "QUOTATION" ? 3 : 1 }, (_, i) => ({
    lineNumber: i + 1,
    lineKind: "ITEM",
    milestone: i === 0 ? "Milestone 1" : "",
    description: sourceType === "INVOICE" && i === 0
      ? "A long description with multilingual content हिन्दी English — " + "Detailed service ".repeat(8)
      : "Professional service " + (i + 1),
    unitCode: "EA",
    quantity: "2.0000",
    unitPrice: "125.2500",
    discountType: "AMOUNT",
    discountValue: "0.0000",
    discountAmount: "0.0000",
    taxRate: "18.000000",
    taxCode: "GST18",
    taxCalculationMode: "EXCLUSIVE",
    taxAmount: "45.0900",
    lineTotal: "295.5900",
  }));
  return {
    sourceType,
    sourceDocumentId: randomUUID(),
    documentNumber: "FX-" + sourceType.slice(0, 3) + "-2026-00001",
    lifecycleStatus: sourceType === "RECEIPT" ? "RECORDED" : sourceType === "QUOTATION" ? "SENT" : "ISSUED",
    documentDate: "2026-10-22",
    dueDate: sourceType === "INVOICE" ? "2026-11-21" : null,
    validUntil: sourceType === "QUOTATION" ? "2026-11-05" : null,
    currency: "INR",
    subtotal: "10020.0000",
    discountTotal: "20.0000",
    taxTotal: "1800.0000",
    grandTotal: "11800.0000",
    paidAmount: sourceType === "INVOICE" ? "2500.0000" : "0.0000",
    paymentStatus: sourceType === "INVOICE" ? "PARTIALLY_PAID" : sourceType === "RECEIPT" ? "RECORDED" : "NOT_APPLICABLE",
    notes: "Test fixture only. No real customer or company information.",
    supplier: {
      legalName: "Falchion Example Issuer",
      displayName: "Falchion Example Issuer",
      email: "billing@example.invalid",
      address: { line1: "1 Test Street", city: "Pune", state: "Maharashtra", postalCode: "411001", country: "India" },
      taxIdentifier: "TEST-TAX-NOT-REAL",
    },
    customer: {
      name: "Example Customer (Test Fixture)",
      email: "customer@example.invalid",
      phone: "+91 00000 00000",
      billingAddress: { line1: "2 Example Road", city: "Pune", state: "Maharashtra", postalCode: "411002", country: "India" },
    },
    configurationSnapshotId: randomUUID(),
    configurationSha256: "a".repeat(64),
    configurationSnapshot: {
      legalEntity: { legalName: "Falchion Example Issuer" },
      brand: { name: brandName, code: brandName === "MyFX POS" ? "MYFXPOS" : brandName === "FX Digitech" ? "DIGITECH" : "COWORKS", logoReference: brandName === "MyFX POS" ? "/brand/myfx-pos.webp" : brandName === "FX Digitech" ? "/brand/fx-digitech.webp" : "/brand/fx-coworks.webp", primaryColor: "#DCAF51" },
      template: { config: { primaryColor: "#DCAF51", footer: "Test configuration; not statutory or customer-approved wording." } },
    },
    lines,
    ...(sourceType === "RECEIPT" ? { method: "BANK_TRANSFER", reference: "TEST-REFERENCE", reversalReason: null } : {}),
  };
}

try {
  process.env.DOCUMENTS_STORAGE_DRIVER = "filesystem";
  process.env.DOCUMENTS_STORAGE_LOCAL_ROOT = tempRoot;
  delete process.env.DOCUMENTS_STORAGE_BUCKET;
  delete process.env.DOCUMENTS_STORAGE_ENDPOINT;

  const fixtures = [
    snapshot("INVOICE", "MyFX POS"),
    snapshot("QUOTATION", "FX Digitech"),
    snapshot("RECEIPT", "FX Coworks"),
  ];
  const rendered: Buffer[] = [];
  for (const fixture of fixtures) {
    const bytes = await renderDocumentPdf(fixture, "2026-10-22T10:00:00.000Z");
    assert.ok(bytes.length > 1000, fixture.sourceType + " PDF must have meaningful output");
    assert.ok(bytes.toString("latin1").includes("/Subtype /Image"), fixture.sourceType + " PDF must embed the supplied brand logo asset");
    assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-", fixture.sourceType + " output must be a PDF");
    assert.ok(bytes.length <= 25 * 1024 * 1024, "PDF stays within the storage limit");
    rendered.push(bytes);
  }
  assert.ok((rendered[0].toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length > 1,
    "long invoice line items must paginate instead of overflowing a single page");

  const key = "documents/test-entity/invoice/" + randomUUID() + "/" + randomUUID() + ".pdf";
  const bytes = rendered[0];
  const digest = sha(bytes);
  const stored = await putPrivateObject(key, bytes, digest);
  assert.equal(stored.byteSize, bytes.length);
  assert.equal(stored.sha256, digest);
  assert.deepEqual(await getPrivateObject(key), bytes, "private storage must return the exact artifact");
  assert.deepEqual(await headPrivateObject(key), { byteSize: bytes.length, sha256: digest });

  await assert.rejects(
    () => putPrivateObject(key, Buffer.from("%PDF-overwrite-attempt"), sha(Buffer.from("%PDF-overwrite-attempt"))),
    (error: unknown) => error instanceof PrivateStorageError && error.code === "DOCUMENT_STORAGE_UNAVAILABLE",
    "storage must never overwrite an existing evidence key",
  );
  await assert.rejects(
    () => putPrivateObject("../escape.pdf", bytes, digest),
    (error: unknown) => error instanceof PrivateStorageError && error.code === "DOCUMENT_INTEGRITY_FAILURE",
    "path traversal storage keys must be rejected",
  );
  await assert.rejects(
    () => putPrivateObject("documents/test-entity/invoice/" + randomUUID() + ".pdf", bytes, "b".repeat(64)),
    (error: unknown) => error instanceof PrivateStorageError && error.code === "DOCUMENT_INTEGRITY_FAILURE",
    "a mismatched digest must never be stored",
  );

  console.log("PASS: invoice, quotation and receipt PDF rendering; multilingual/long-line layout; invoice pagination; private object round-trip; checksum validation; traversal rejection; and no-overwrite behavior.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
  if (original.driver === undefined) delete process.env.DOCUMENTS_STORAGE_DRIVER;
  else process.env.DOCUMENTS_STORAGE_DRIVER = original.driver;
  if (original.root === undefined) delete process.env.DOCUMENTS_STORAGE_LOCAL_ROOT;
  else process.env.DOCUMENTS_STORAGE_LOCAL_ROOT = original.root;
  if (original.bucket === undefined) delete process.env.DOCUMENTS_STORAGE_BUCKET;
  else process.env.DOCUMENTS_STORAGE_BUCKET = original.bucket;
  if (original.endpoint === undefined) delete process.env.DOCUMENTS_STORAGE_ENDPOINT;
  else process.env.DOCUMENTS_STORAGE_ENDPOINT = original.endpoint;
}


}

main().catch((error: unknown) => {
  console.error("PDF/storage unit test failed", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});