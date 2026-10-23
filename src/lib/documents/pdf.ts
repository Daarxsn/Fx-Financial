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
      const accent = isCoworks ? "#931314" : isDigitech ? "#173E3B" : "#0D665B";
      const gold = "#DCAF51";
      const pale = isCoworks ? "#FBF2F2" : isDigitech ? "#F0F5F4" : "#EDF6F4";
      const sourceLabel = snapshot.sourceType === "INVOICE"
        ? text(templateConfig.documentTitle, "PROFORMA INVOICE")
        : snapshot.sourceType === "QUOTATION" ? "QUOTATION" : "PAYMENT RECEIPT";
      const status = text(snapshot.lifecycleStatus, "UNKNOWN").toUpperCase();
      const issuedTime = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
      const doc = new PDFDocument({
        size: "A4", margins: { top: 34, bottom: 52, left: 44, right: 44 }, bufferPages: true, compress: true,
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
      const brandName = text(brand.name ?? brand.displayName ?? brand.brandName, issuer);
      const customerName = text(customer.name ?? customer.customerName, "Customer");
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const width = right - left;
      const bottom = () => doc.page.height - doc.page.margins.bottom - 12;
      const rule = (y: number, color = "#DDE4E5") => doc.save().strokeColor(color).lineWidth(0.6).moveTo(left, y).lineTo(right, y).stroke().restore();
      const plain = (v: unknown) => { const rendered = text(v, ""); return rendered; };
      const body = (size = 8) => doc.font(fontName).fontSize(size).fillColor("#253039");
      const ensure = (height: number) => { if (doc.y + height > bottom()) { doc.addPage(); doc.y = 36; } };
      const drawWordmark = (x: number, y: number) => {
        if (logoBuffer) { doc.image(logoBuffer, x, y, { fit: [225, 66], align: "left", valign: "center" }); return; }
        if (isCoworks) {
          doc.font(fontName).fontSize(26).fillColor(accent).text("FX", x, y, { continued: true });
          doc.font(fontName).fontSize(18).fillColor("#111111").text(" Coworks");
        } else if (isDigitech) {
          doc.font(fontName).fontSize(24).fillColor(accent).text("FX", x, y, { continued: true });
          doc.font(fontName).fontSize(20).fillColor("#111111").text(" DigTech");
        } else {
          doc.font(fontName).fontSize(27).fillColor(gold).text("myfx", x, y, { continued: true });
          doc.font(fontName).fontSize(17).fillColor(accent).text(" POS");
        }
      };

      rendererStage = "header";
      doc.save().fillColor(accent).rect(0, 0, doc.page.width, 11).fill().restore();
      doc.save().fillColor(gold).rect(0, 11, doc.page.width, 3).fill().restore();
      drawWordmark(left, 26);
      const titleWidth = 236;
      const titleX = right - titleWidth;
      doc.font(fontName).fontSize(17).fillColor("#14191D").text(sourceLabel, titleX, 39, { width: titleWidth, align: "right" });
      doc.font(fontName).fontSize(8).fillColor("#59646B").text("Document no. " + text(snapshot.documentNumber), titleX, 65, { width: titleWidth, align: "right" });
      doc.font(fontName).fontSize(8).fillColor(status === "CANCELLED" || status === "REVERSED" ? "#B42318" : accent).text(status, titleX, 79, { width: titleWidth, align: "right" });
      doc.y = 109;
      rule(doc.y, accent);
      doc.moveDown(0.7);

      rendererStage = "issuer-customer";
      const identityY = doc.y;
      const half = (width - 22) / 2;
      const customerX = left + half + 22;
      doc.font(fontName).fontSize(8).fillColor(accent).text("SUPPLIER", left, identityY, { width: half });
      doc.font(fontName).fontSize(10).fillColor("#171C20").text(issuer, left, identityY + 14, { width: half });
      const supplierLines = [
        ...addressLines(supplier.billingAddress ?? supplier.address ?? supplier.registeredAddress),
        plain(supplier.invoiceEmail ?? supplier.email), plain(supplier.invoicePhone ?? supplier.phone),
        plain(supplier.taxIdentifier ?? supplier.gstNumber), plain(supplier.website),
      ].filter(Boolean);
      body(8).text(supplierLines.join("\n") || "Approved issuer details are retained in the issue-time snapshot.", left, identityY + 30, { width: half, lineGap: 2 });
      doc.font(fontName).fontSize(8).fillColor(accent).text("BILL TO", customerX, identityY, { width: half });
      doc.font(fontName).fontSize(10).fillColor("#171C20").text(customerName, customerX, identityY + 14, { width: half });
      const customerLines = [
        ...addressLines(customer.billingAddress ?? customer.address),
        plain(customer.email), plain(customer.phone), plain(customer.taxIdentifier),
      ].filter(Boolean);
      body(8).text(customerLines.join("\n") || "Customer billing details", customerX, identityY + 30, { width: half, lineGap: 2 });
      doc.y = Math.max(doc.y, identityY + 91);
      rule(doc.y);
      doc.moveDown(0.7);

      rendererStage = "document-metadata";
      const metadata = [
        ["INVOICE DATE", snapshot.documentDate?.slice(0, 10) ?? "—"],
        ["DUE DATE", snapshot.sourceType === "INVOICE" ? snapshot.dueDate?.slice(0, 10) ?? "—" : "—"],
        ["CURRENCY", text(snapshot.currency, "INR")],
      ];
      const metaWidth = width / metadata.length;
      const metaY = doc.y;
      metadata.forEach((entry, index) => {
        const x = left + index * metaWidth;
        doc.font(fontName).fontSize(7).fillColor("#68747A").text(entry[0], x, metaY, { width: metaWidth - 12 });
        doc.font(fontName).fontSize(9).fillColor("#1E2A30").text(entry[1], x, metaY + 12, { width: metaWidth - 12 });
      });
      doc.y = metaY + 34;
      rule(doc.y);
      doc.moveDown(0.7);

      rendererStage = "line-items";
      const rows = Array.isArray(snapshot.lines) ? snapshot.lines : [];
      const milestoneX = left + 30;
      const milestoneWidth = 82;
      const descriptionX = left + 120;
      const descriptionWidth = width - 220;
      const amountX = right - 92;
      const drawLineHeader = () => {
        const y = doc.y;
        doc.save().fillColor(accent).rect(left, y, width, 26).fill().restore();
        doc.font(fontName).fontSize(7).fillColor("#FFFFFF").text("#", left + 4, y + 8, { width: 22 });
        doc.text("MILESTONE", milestoneX, y + 8, { width: milestoneWidth });
        doc.text("DESCRIPTION", descriptionX, y + 8, { width: descriptionWidth });
        doc.text("AMOUNT", amountX, y + 8, { width: 88, align: "right" });
        doc.y = y + 30;
      };
      drawLineHeader();
      rows.forEach((raw, index) => {
        const item = object(raw);
        const description = text(item.description, "Item / service");
        const milestone = text(item.milestone, "—");
        const qty = text(item.quantity, "1");
        const unit = text(item.unitCode, "unit");
        const rate = text(item.unitPrice, "0.0000");
        const amount = text(item.lineTotal, "0.0000");
        doc.font(fontName).fontSize(8);
        const descriptionHeight = doc.heightOfString(description, { width: descriptionWidth });
        const rateLine = "Qty " + qty + " " + unit + " · Rate " + text(snapshot.currency, "INR") + " " + rate;
        const rateHeight = doc.heightOfString(rateLine, { width: descriptionWidth });
        const rowHeight = Math.max(38, descriptionHeight + rateHeight + 17);
        if (doc.y + rowHeight > bottom()) { doc.addPage(); doc.y = 36; drawLineHeader(); }
        const y = doc.y;
        if (index % 2 === 0) doc.save().fillColor("#FBFCFC").rect(left, y, width, rowHeight).fill().restore();
        doc.font(fontName).fontSize(8).fillColor("#48545B").text(String(item.lineNumber ?? index + 1), left + 4, y + 9, { width: 22 });
        doc.font(fontName).fontSize(7.5).fillColor("#36444A").text(milestone, milestoneX, y + 9, { width: milestoneWidth });
        doc.font(fontName).fontSize(8).fillColor("#222C32").text(description, descriptionX, y + 7, { width: descriptionWidth });
        doc.font(fontName).fontSize(6.5).fillColor("#7B858B").text(rateLine, descriptionX, y + 10 + descriptionHeight, { width: descriptionWidth });
        doc.font(fontName).fontSize(8).fillColor("#222C32").text(amount, amountX, y + 9, { width: 88, align: "right" });
        doc.y = y + rowHeight;
        rule(doc.y, "#E6EAEC");
      });
      if (!rows.length) { body(8).text("No item lines are present in this source snapshot."); doc.moveDown(0.5); }

      rendererStage = "totals";
      doc.moveDown(0.7);
      const totalsX = right - 238;
      const totalRows: Array<[string, string]> = snapshot.sourceType === "RECEIPT"
        ? [["RECEIPT AMOUNT", amt(snapshot.grandTotal)]]
        : [["SUBTOTAL", amt(snapshot.subtotal)], ["DISCOUNT", "− " + amt(snapshot.discountTotal)], ["TAX", amt(snapshot.taxTotal)], ["GRAND TOTAL", amt(snapshot.grandTotal)]];
      totalRows.forEach(([label, value]) => {
        ensure(26);
        const y = doc.y;
        const grand = label === "GRAND TOTAL" || label === "RECEIPT AMOUNT";
        if (grand) doc.save().fillColor(pale).rect(totalsX, y - 2, 238, 26).fill().restore();
        doc.font(fontName).fontSize(grand ? 9 : 8).fillColor(grand ? accent : "#68747A").text(label, totalsX + 8, y + 5, { width: 108 });
        doc.font(fontName).fontSize(grand ? 10 : 8).fillColor("#172127").text(value + (grand ? " " + text(snapshot.currency) : ""), totalsX + 117, y + 5, { width: 112, align: "right" });
        doc.y = y + 24;
      });
      if (snapshot.sourceType === "INVOICE") {
        const words = amountInWords(amt(snapshot.grandTotal), text(snapshot.currency, "INR"));
        ensure(doc.heightOfString(words, { width }) + 32);
        doc.moveDown(0.4);
        doc.font(fontName).fontSize(7).fillColor(accent).text("AMOUNT IN WORDS", left, doc.y);
        doc.moveDown(0.25);
        body(8).text(words, left, doc.y, { width, lineGap: 2 });
        doc.moveDown(0.5);
      }
      if (snapshot.sourceType === "RECEIPT") {
        ensure(32); doc.moveDown(0.3);
        body(8).text("METHOD: " + text(snapshot.method) + "    REFERENCE: " + text(snapshot.reference), left, doc.y, { width });
      }
      if (snapshot.reversalReason) {
        ensure(30); doc.moveDown(0.3);
        doc.font(fontName).fontSize(8).fillColor("#B42318").text("REVERSAL REASON: " + text(snapshot.reversalReason), left, doc.y, { width });
      }
      if (snapshot.notes) {
        ensure(doc.heightOfString(text(snapshot.notes), { width }) + 28);
        doc.moveDown(0.5);
        doc.font(fontName).fontSize(8).fillColor(accent).text("NOTES", left, doc.y);
        doc.moveDown(0.25);
        body(8).text(text(snapshot.notes), left, doc.y, { width, lineGap: 2 });
      }

      rendererStage = "payment-footer";
      const bank = object(entityConfig.bankDetails ?? supplier.bankDetails ?? supplier.bankDetailsJson);
      const bankLines = [
        plain(bank.beneficiaryName ?? bank.accountName), plain(bank.bankName),
        plain(bank.accountNumber ?? bank.accountNo), plain(bank.ifsc ?? bank.ifscCode), plain(bank.swift ?? bank.swiftCode),
      ].filter(Boolean);
      const terms = text(templateConfig.terms ?? entityConfig.invoiceTerms ?? templateConfig.footer ?? entityConfig.invoiceFooter, "");
      const halfWidth = (width - 22) / 2;
      const termsHeight = terms ? doc.heightOfString(terms, { width: halfWidth, font: fontName, fontSize: 7.5 }) : 0;
      if (bankLines.length || terms) {
        ensure(Math.max(58, termsHeight + 30));
        doc.moveDown(0.6);
        rule(doc.y, accent);
        doc.moveDown(0.45);
        const footerY = doc.y;
        const rightFooterX = left + halfWidth + 22;
        if (bankLines.length) {
          doc.font(fontName).fontSize(8).fillColor(accent).text("BENEFICIARY / BANK DETAILS", left, footerY, { width: halfWidth });
          body(7.5).text(bankLines.join("\n"), left, footerY + 14, { width: halfWidth, lineGap: 2 });
        }
        if (terms) {
          doc.font(fontName).fontSize(8).fillColor(accent).text("TERMS & CONDITIONS", rightFooterX, footerY, { width: halfWidth });
          body(7.5).text(terms, rightFooterX, footerY + 14, { width: halfWidth, lineGap: 2 });
        }
        doc.y = Math.max(doc.y, footerY + Math.max(52, termsHeight + 18));
      }
      if (snapshot.sourceType === "INVOICE") {
        ensure(64);
        doc.moveDown(0.45);
        const signY = doc.y;
        doc.font(fontName).fontSize(9).fillColor("#1C252A").text("For " + issuer, left, signY, { width: width * 0.6 });
        doc.save().strokeColor("#AAB2B7").lineWidth(0.7).moveTo(right - 164, signY + 34).lineTo(right, signY + 34).stroke().restore();
        doc.font(fontName).fontSize(7.5).fillColor("#68747A").text("Authorized signatory", right - 164, signY + 39, { width: 164, align: "center" });
      }
      if (snapshot.configurationSha256) {
        ensure(16); doc.moveDown(0.3);
        doc.font(fontName).fontSize(5.5).fillColor("#8B9499").text("Configuration snapshot SHA-256: " + snapshot.configurationSha256, left, doc.y, { width });
      }
      const pages = doc.bufferedPageRange();
      for (let p = pages.start; p < pages.start + pages.count; p++) {
        doc.switchToPage(p);
        const y = doc.page.height - 34;
        doc.save().strokeColor("#D8DEE2").lineWidth(0.5).moveTo(left, y - 6).lineTo(right, y - 6).stroke().restore();
        doc.font(fontName).fontSize(6.5).fillColor("#7B858A").text("Falchion Xeniaa · Generated from an immutable document snapshot", left, y, { width: width * 0.78 });
        doc.font(fontName).fontSize(6.5).fillColor("#7B858A").text("Page " + (p + 1) + " of " + pages.count, right - width * 0.2, y, { width: width * 0.2, align: "right" });
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
