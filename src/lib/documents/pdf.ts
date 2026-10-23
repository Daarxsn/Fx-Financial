import "server-only";

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export type PdfSnapshot = {
  sourceType: "INVOICE" | "QUOTATION" | "RECEIPT";
  sourceDocumentId: string;
  documentNumber: string;
  lifecycleStatus: string;
  documentDate: string | null;
  dueDate: string | null;
  validUntil: string | null;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  paidAmount: string;
  paymentStatus: string;
  notes: string | null;
  supplier: unknown;
  customer: unknown;
  configurationSnapshotId: string | null;
  configurationSha256: string | null;
  configurationSnapshot: unknown;
  lines: unknown[];
  method?: string;
  reference?: string | null;
  reversalReason?: string | null;
  [key: string]: unknown;
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { value = JSON.parse(value) as unknown; } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return fallback;
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim() || fallback;
}
function addressLines(value: unknown): string[] {
  const address = object(value);
  return ["line1","line2","addressLine1","addressLine2","city","district","state","postalCode","postal_code","country","countryCode"]
    .map(key => address[key]).filter(v => typeof v === "string" && v.trim()).map(v => String(v).trim());
}
function fontPath(): string {
  const root = resolve(process.cwd(), "node_modules", "@fontsource", "noto-sans");
  const candidates = [
    join(root, "files", "noto-sans-devanagari-400-normal.woff2"),
    join(root, "files", "noto-sans-latin-400-normal.woff2"),
    join(root, "files", "noto-sans-latin-400-normal.woff"),
  ];
  return candidates.find(existsSync) ?? "";
}
const amt = (value: unknown) => text(value, "0.0000");

async function approvedBrandLogo(config: Record<string, unknown>): Promise<Buffer | null> {
  const brand = object(config.brand);
  const code = text(brand.code ?? brand.name, "").toUpperCase();
  const reference = text(brand.logoReference, "");
  const brandRoot = resolve(process.cwd(), "public", "brand");
  const approved: string[] = [];
  if (reference.startsWith("/brand/") && !reference.includes("..")) {
    const candidate = resolve(process.cwd(), "public", reference.slice(1));
    if (candidate.startsWith(brandRoot + sep)) approved.push(candidate);
  }
  if (code.includes("COWORK")) approved.push(join(brandRoot, "fx-coworks.webp"));
  else if (code.includes("DIGI")) approved.push(join(brandRoot, "fx-digitech.webp"));
  else if (code.includes("MYFX") || code.includes("POS")) approved.push(join(brandRoot, "myfx-pos.webp"));
  const file = approved.find(candidate => candidate.startsWith(brandRoot + sep) && existsSync(candidate));
  if (!file) return null;
  try {
    const sharp = await import("sharp");
    return await sharp.default(file).rotate().png().toBuffer();
  } catch {
    // Keep document generation functional with the typographic wordmark fallback.
    return null;
  }
}

function amountInWords(value: string, currencyCode: string): string {
  const small = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  const underThousand = (initial: number): string => {
    let n = initial;
    const parts: string[] = [];
    if (n >= 100) { parts.push(small[Math.floor(n / 100)] + " hundred"); n %= 100; }
    if (n >= 20) parts.push(tens[Math.floor(n / 10)] + (n % 10 ? "-" + small[n % 10] : ""));
    else if (n > 0) parts.push(small[n]);
    return parts.join(" ");
  };
  const wholeWords = (raw: string): string => {
    let n = BigInt(raw || "0");
    if (n === 0n) return "zero";
    const groups: Array<[bigint, string]> = [[10000000n, "crore"], [100000n, "lakh"], [1000n, "thousand"], [1n, ""]];
    const parts: string[] = [];
    for (const [size, name] of groups) {
      if (n >= size) {
        const count = Number(n / size);
        n %= size;
        if (count) parts.push(underThousand(count) + (name ? " " + name : ""));
      }
    }
    return parts.join(" ");
  };
  const [whole, fractionRaw = ""] = value.split(".");
  const fraction = fractionRaw.padEnd(4, "0").slice(0, 4);
  const main = wholeWords(whole);
  if (currencyCode === "INR" && fraction.slice(2) === "00") {
    const paise = Number(fraction.slice(0, 2));
    return "Indian Rupees " + main + (paise ? " and " + wholeWords(String(paise)) + " paise" : "") + " only";
  }
  if (Number(fraction) === 0) return currencyCode + " " + main + " only";
  return currencyCode + " " + main + " and decimal " + fraction.split("").map(d => small[Number(d)]).join(" ") + " only";
}

export async function renderDocumentPdf(snapshot: PdfSnapshot, capturedAt: Date | string): Promise<Buffer> {
  const config = object(snapshot.configurationSnapshot);
  const brand = object(config.brand);
  const template = object(config.template);
  const templateConfig = object(template.config);
  const entityConfig = object(config.legalEntity);
  const logoBuffer = await approvedBrandLogo(config);
  return await new Promise<Buffer>((resolveBuffer, rejectBuffer) => {
    let rendererStage = "document-setup";
    try {
      const code = text(brand.code ?? brand.name, "").toUpperCase();
      const isCoworks = code.includes("COWORK");
      const isDigitech = code.includes("DIGI");
      const gold = "#DCAF51";
      const red = "#F25138";
      const green = "#67AF7A";
      const sourceLabel = snapshot.sourceType === "INVOICE"
        ? text(templateConfig.documentTitle, "PROFORMA INVOICE:")
        : snapshot.sourceType === "QUOTATION" ? "QUOTATION" : "PAYMENT RECEIPT";
      const issuedTime = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
      const doc = new PDFDocument({
        size: "A4", margins: { top: 34, bottom: 50, left: 34, right: 36 }, bufferPages: true, compress: true,
        info: {
          Title: sourceLabel + " " + snapshot.documentNumber,
          Subject: "Document snapshot " + text(snapshot.configurationSnapshotId, ""),
          Author: text(object(snapshot.supplier).legalName ?? object(snapshot.supplier).displayName ?? object(snapshot.supplier).name, "Falchion Xeniaa"),
          Creator: "Falchion Xeniaa Invoice Management System", Producer: "PDFKit",
          CreationDate: Number.isFinite(issuedTime.getTime()) ? issuedTime : new Date(0),
          ModDate: Number.isFinite(issuedTime.getTime()) ? issuedTime : new Date(0),
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      doc.on("error", (error: unknown) => {
        console.error("PDF renderer stream failed", {
          stage: rendererStage, errorName: error instanceof Error ? error.name : "UnknownError",
          ...(process.env.GITHUB_ACTIONS === "true" && error instanceof Error ? { errorMessage: error.message.slice(0, 180) } : {}),
        });
        rejectBuffer(error);
      });
      doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
      let fontName = "Helvetica";
      const embedded = fontPath();
      if (embedded) {
        try { doc.registerFont("FalchionNoto", embedded); fontName = "FalchionNoto"; }
        catch { fontName = "Helvetica"; }
      }
      const supplier = object(snapshot.supplier);
      const customer = object(snapshot.customer);
      const issuer = text(supplier.legalName ?? supplier.displayName ?? supplier.name, "Falchion Xeniaa");
      const customerName = text(customer.name ?? customer.customerName, "Customer");
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const width = right - left;
      const pageBottom = () => doc.page.height - doc.page.margins.bottom - 4;
      const clean = (value: unknown) => text(value, "");
      const addCell = (x: number, y: number, w: number, h: number, fill = "#FFFFFF") => {
        doc.save().fillColor(fill).rect(x, y, w, h).fill().restore();
        doc.save().strokeColor("#222222").lineWidth(0.55).rect(x, y, w, h).stroke().restore();
      };
      const body = (size = 8) => doc.font(fontName).fontSize(size).fillColor("#151515");
      const ensure = (height: number) => { if (doc.y + height > pageBottom()) { doc.addPage(); doc.y = 36; } };

      rendererStage = "header";
      const wordmarkFit: [number, number] = isDigitech ? [210, 78] : [138, 108];
      if (logoBuffer) doc.image(logoBuffer, left + 8, 27, { fit: wordmarkFit, valign: "center" });
      else {
        doc.font("Helvetica-Bold").fontSize(25).fillColor("#111111").text(isCoworks ? "FX Coworks" : isDigitech ? "FX DigTech" : "myfx POS", left + 8, 55, { width: 205 });
      }
      const titleWidth = 245;
      const titleX = right - titleWidth;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#050505").text(sourceLabel, titleX, 39, { width: titleWidth, align: "right" });
      doc.font("Helvetica").fontSize(10).fillColor("#111111").text("Invoice no: " + text(snapshot.documentNumber), titleX, 59, { width: titleWidth, align: "right" });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111111").text("Date: ", titleX + 12, 83, { width: 58, align: "right", continued: true });
      doc.font("Helvetica").fontSize(9.5).fillColor("#111111").text(snapshot.documentDate?.slice(0, 10) ?? "—", { width: titleWidth - 72, align: "right" });
      const expiryLabel = snapshot.sourceType === "QUOTATION" ? "Expires on: " : "Due date: ";
      const expiry = snapshot.sourceType === "QUOTATION" ? snapshot.validUntil : snapshot.dueDate;
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111111").text(expiryLabel, titleX + 6, 104, { width: 68, align: "right", continued: true });
      doc.font("Helvetica").fontSize(9.5).fillColor("#111111").text(expiry?.slice(0, 10) ?? "—", { width: titleWidth - 74, align: "right" });
      const triWidth = Math.min(286, width * 0.56);
      const triX = right - triWidth;
      const triY = 126;
      const segment = triWidth / 3;
      doc.save().fillColor(gold).rect(triX, triY, segment, 4).fill().restore();
      doc.save().fillColor(red).rect(triX + segment, triY, segment, 4).fill().restore();
      doc.save().fillColor(green).rect(triX + segment * 2, triY, triWidth - segment * 2, 4).fill().restore();

      rendererStage = "issuer-customer";
      const identityY = 174;
      const half = (width - 20) / 2;
      const customerX = left + half + 20;
      const leftAddress = addressLines(supplier.billingAddress ?? supplier.address ?? supplier.registeredAddress);
      const registrations = Array.isArray(config.selectedTaxRegistrations)
        ? (config.selectedTaxRegistrations as unknown[]).map(value => object(value)) : [];
      const taxRegLines = registrations.map(reg => {
        const type = clean(reg.registrationType ?? reg.displayLabel ?? reg.registrationKey);
        const number = clean(reg.registrationNumber);
        return type && number ? type + ": " + number : number || type;
      }).filter(Boolean);
      const issuerLines = [
        clean(supplier.invoicePhone ?? supplier.phone),
        ...leftAddress,
        ...taxRegLines,
        ...(!taxRegLines.length && clean(supplier.taxIdentifier ?? supplier.gstNumber) ? ["GSTIN: " + clean(supplier.taxIdentifier ?? supplier.gstNumber)] : []),
      ].filter(Boolean);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#050505").text(issuer.toUpperCase(), left, identityY, { width: half });
      body(9).text(issuerLines.join("\n") || "Supplier details from approved company settings.", left, identityY + 23, { width: half, lineGap: 2 });
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#050505").text("BILL TO:", customerX, identityY, { width: half, align: "right" });
      const customerAddress = addressLines(customer.billingAddress ?? customer.address);
      const clientLines = [
        "Name: " + customerName,
        clean(customer.phone) ? "Number: " + clean(customer.phone) : "",
        ...customerAddress.map((part, index) => index === 0 ? "Address: " + part : part),
        clean(customer.taxIdentifier) ? "GSTIN: " + clean(customer.taxIdentifier) : "",
      ].filter(Boolean);
      body(9).text(clientLines.join("\n") || "Customer billing details", customerX, identityY + 23, { width: half, align: "right", lineGap: 2 });
      const leftBlockHeight = doc.heightOfString(issuerLines.join("\n") || "Supplier details from approved company settings.", { width: half });
      const rightBlockHeight = doc.heightOfString(clientLines.join("\n") || "Customer billing details", { width: half });
      const identityBottom = Math.max(identityY + 23 + leftBlockHeight, identityY + 23 + rightBlockHeight);
      doc.y = Math.max(identityBottom + 62, 343);

      rendererStage = "line-items";
      const rows = Array.isArray(snapshot.lines) ? snapshot.lines : [];
      const columnWidths = [width * 0.07, width * 0.337, width * 0.167, width * 0.204, width * 0.222];
      const columnXs = [left];
      for (let index = 0; index < columnWidths.length - 1; index++) columnXs.push(columnXs[index] + columnWidths[index]);
      const headerHeight = 25;
      const drawLineHeader = () => {
        const y = doc.y;
        const labels = ["#", "Description", "Milestone", "Rate", "Amount"];
        labels.forEach((label, index) => {
          addCell(columnXs[index], y, columnWidths[index], headerHeight, "#EEEEEE");
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#111111")
            .text(label, columnXs[index] + 4, y + 7, { width: columnWidths[index] - 8, align: index === 0 ? "center" : "left" });
        });
        doc.y = y + headerHeight;
      };
      drawLineHeader();
      rows.forEach((raw, index) => {
        const item = object(raw);
        const description = text(item.description, "Item / service");
        const milestone = text(item.milestone, "—");
        const quantityUnit = "Qty: " + text(item.quantity, "1") + " " + text(item.unitCode, "unit");
        body(8);
        const descH = doc.heightOfString(description, { width: columnWidths[1] - 10 });
        const qtyH = doc.heightOfString(quantityUnit, { width: columnWidths[1] - 10 });
        const milestoneH = doc.heightOfString(milestone, { width: columnWidths[2] - 8 });
        const rowHeight = Math.max(45, descH + qtyH + 15, milestoneH + 14);
        if (doc.y + rowHeight > pageBottom()) { doc.addPage(); doc.y = 36; drawLineHeader(); }
        const y = doc.y;
        const values = [String(item.lineNumber ?? index + 1), "", milestone, text(item.unitPrice, "0.0000"), text(item.lineTotal, "0.0000")];
        columnWidths.forEach((cellWidth, col) => addCell(columnXs[col], y, cellWidth, rowHeight));
        doc.font("Helvetica").fontSize(8).fillColor("#161616").text(values[0], columnXs[0] + 3, y + 8, { width: columnWidths[0] - 6, align: "center" });
        doc.font(fontName).fontSize(8).fillColor("#161616").text(description, columnXs[1] + 5, y + 7, { width: columnWidths[1] - 10 });
        doc.font(fontName).fontSize(6.5).fillColor("#656565").text(quantityUnit, columnXs[1] + 5, y + 10 + descH, { width: columnWidths[1] - 10 });
        doc.font(fontName).fontSize(8).fillColor("#161616").text(milestone, columnXs[2] + 4, y + 8, { width: columnWidths[2] - 8 });
        doc.font(fontName).fontSize(8).fillColor("#161616").text(values[3], columnXs[3] + 4, y + 8, { width: columnWidths[3] - 8, align: "right" });
        doc.font(fontName).fontSize(8).fillColor("#161616").text(values[4], columnXs[4] + 4, y + 8, { width: columnWidths[4] - 8, align: "right" });
        doc.y = y + rowHeight;
      });

      rendererStage = "totals";
      const rateWidth = columnWidths[3];
      const amountWidth = columnWidths[4];
      const totalsLabelX = columnXs[3];
      const totalsValueX = columnXs[4];
      const drawTotal = (label: string, value: string, grand = false) => {
        ensure(24);
        const y = doc.y;
        addCell(totalsLabelX, y, rateWidth, 24, grand ? "#F2F2F2" : "#FFFFFF");
        addCell(totalsValueX, y, amountWidth, 24, grand ? "#F2F2F2" : "#FFFFFF");
        doc.font(grand ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#111111")
          .text(label, totalsLabelX + 4, y + 7, { width: rateWidth - 8, align: "right" });
        doc.font(grand ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#111111")
          .text(value, totalsValueX + 4, y + 7, { width: amountWidth - 8, align: "right" });
        doc.y = y + 24;
      };
      const totals = [
        ["Sub Total:", amt(snapshot.subtotal)],
        ...(Number(snapshot.discountTotal) !== 0 ? [["Discount:", "− " + amt(snapshot.discountTotal)] as [string, string]] : []),
        ["Tax:", amt(snapshot.taxTotal)],
        ["Grand Total:", amt(snapshot.grandTotal) + " " + text(snapshot.currency, "INR")],
      ] as Array<[string, string]>;
      totals.forEach(([label, value]) => drawTotal(label, value, label === "Grand Total:"));

      rendererStage = "amount-words";
      const words = amountInWords(amt(snapshot.grandTotal), text(snapshot.currency, "INR"));
      ensure(doc.heightOfString(words, { width: width * 0.57 }) + 32);
      doc.moveDown(1.2);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#090909").text("Amount in words:", left, doc.y, { width: width * 0.57 });
      doc.moveDown(0.35);
      body(9).text(words, left, doc.y, { width: width * 0.57, lineGap: 2 });
      if (snapshot.sourceType === "RECEIPT") {
        doc.moveDown(0.5);
        body(8).text("METHOD: " + text(snapshot.method) + "    REFERENCE: " + text(snapshot.reference), left, doc.y, { width });
      }
      if (snapshot.reversalReason) {
        ensure(30);
        doc.moveDown(0.3);
        doc.font(fontName).fontSize(8).fillColor("#B42318").text("REVERSAL REASON: " + text(snapshot.reversalReason), left, doc.y, { width });
      }
      if (snapshot.notes) {
        ensure(doc.heightOfString(text(snapshot.notes), { width }) + 28);
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#111111").text("NOTES", left, doc.y);
        doc.moveDown(0.25);
        body(8).text(text(snapshot.notes), left, doc.y, { width, lineGap: 2 });
      }

      rendererStage = "bank-and-terms";
      const bank = object(entityConfig.bankDetails ?? supplier.bankDetails ?? supplier.bankDetailsJson);
      const bankLines = [
        clean(bank.beneficiaryName ?? bank.accountName) ? "Beneficiary Name: " + clean(bank.beneficiaryName ?? bank.accountName) : "",
        clean(bank.bankName) ? "Bank: " + clean(bank.bankName) : "",
        clean(bank.ifsc ?? bank.ifscCode) ? "IFSC: " + clean(bank.ifsc ?? bank.ifscCode) : "",
        clean(bank.accountNumber ?? bank.accountNo) ? "Account number: " + clean(bank.accountNumber ?? bank.accountNo) : "",
        clean(bank.swift ?? bank.swiftCode) ? "SWIFT: " + clean(bank.swift ?? bank.swiftCode) : "",
        clean(supplier.invoiceEmail ?? supplier.email) ? "Email: " + clean(supplier.invoiceEmail ?? supplier.email) : "",
      ].filter(Boolean);
      const terms = text(templateConfig.terms ?? entityConfig.invoiceTerms ?? templateConfig.footer ?? entityConfig.invoiceFooter, "");
      const closing = "Looking forward to doing business with you.";
      const footerHalf = (width - 28) / 2;
      const termsHeight = terms ? doc.heightOfString(terms, { width: footerHalf }) : 0;
      const bankHeight = bankLines.length ? doc.heightOfString(bankLines.join("\n"), { width: footerHalf }) : 0;
      const closingHeight = doc.heightOfString(closing, { width: footerHalf });
      ensure(Math.max(84, termsHeight, bankHeight) + closingHeight + 30);
      doc.moveDown(1.25);
      const footerTop = doc.y;
      const rightFooterX = left + footerHalf + 28;
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text(closing, left + 4, footerTop, { width: footerHalf });
      if (bankLines.length) {
        body(8).text(bankLines.join("\n"), left + 4, footerTop + closingHeight + 10, { width: footerHalf, lineGap: 2 });
      }
      if (terms) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111").text("Terms & Conditions", rightFooterX, footerTop + closingHeight + 10, { width: footerHalf });
        body(8).text(terms, rightFooterX, footerTop + closingHeight + 26, { width: footerHalf, lineGap: 2 });
      }
      const footerContentHeight = Math.max(closingHeight + 10 + bankHeight, closingHeight + 26 + termsHeight);
      doc.y = Math.max(doc.y, footerTop + footerContentHeight + 12);

      if (snapshot.sourceType === "INVOICE") {
        const signatureY = Math.max(doc.y + 12, doc.page.height - 86);
        if (signatureY + 24 > pageBottom()) { doc.addPage(); doc.y = doc.page.height - 90; }
        else doc.y = signatureY;
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111111").text("Signature: ______________________________", left + 7, doc.y, { width: width * 0.72 });
      }
      if (snapshot.configurationSha256) {
        ensure(14);
        doc.moveDown(0.3);
        doc.font(fontName).fontSize(5.5).fillColor("#888888").text("Configuration snapshot SHA-256: " + snapshot.configurationSha256, left, doc.y, { width });
      }

      const pages = doc.bufferedPageRange();
      for (let p = pages.start; p < pages.start + pages.count; p++) {
        doc.switchToPage(p);
        const y = doc.page.height - 28;
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#111111").text(String(p + 1), left, y, { width, align: "center" });
      }
      rendererStage = "finalize";
      doc.end();
    } catch (error) {
      console.error("PDF renderer failed", {
        stage: rendererStage, errorName: error instanceof Error ? error.name : "UnknownError",
        ...(process.env.GITHUB_ACTIONS === "true" && error instanceof Error ? { errorMessage: error.message.slice(0, 180) } : {}),
      });
      rejectBuffer(error);
    }
  });
}
