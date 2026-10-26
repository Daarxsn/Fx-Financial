import "server-only";

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { getPrivateAsset } from "@/lib/documents/storage";

export type PdfSnapshot = {
  sourceType: "INVOICE" | "QUOTATION" | "RECEIPT";
  sourceDocumentId: string;
  documentNumber: string;
  lifecycleStatus: string;
  documentDate: string | null;
  dueDate: string | null;
  validUntil: string | null;
  taxMode?: "LINE" | "COMPONENTS";
  cgstEnabled?: boolean;
  cgstRate?: string | null;
  cgstAmount?: string;
  sgstEnabled?: boolean;
  sgstRate?: string | null;
  sgstAmount?: string;
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
  /** Data-derived setup/input warnings for an unissued draft preview. */
  previewWarnings?: string[];
  method?: string;
  reference?: string | null;
  reversalReason?: string | null;
  [key: string]: unknown;
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return fallback;
  return (
    String(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .trim() || fallback
  );
}

function addressLines(value: unknown): string[] {
  const address = object(value);
  const l1 = text(address.line1 ?? address.addressLine1, "").trim();
  const l2 = text(address.line2 ?? address.addressLine2, "").trim();
  if (l1 && l2) return [l1, l2];
  if (l1) {
    const cityPart = [address.city, address.state, address.postalCode ?? address.postal_code]
      .filter((v) => typeof v === "string" && v.trim())
      .join(", ");
    return cityPart ? [l1, cityPart] : [l1];
  }
  return [
    "line1",
    "line2",
    "addressLine1",
    "addressLine2",
    "city",
    "district",
    "state",
    "postalCode",
    "postal_code",
    "country",
    "countryCode",
  ]
    .map((key) => address[key])
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => String(v).trim());
}

function fontPath(): string {
  const root = resolve(
    process.cwd(),
    "node_modules",
    "@fontsource",
    "noto-sans"
  );
  const candidates = [
    join(root, "files", "noto-sans-devanagari-400-normal.woff2"),
    join(root, "files", "noto-sans-latin-400-normal.woff2"),
    join(root, "files", "noto-sans-latin-400-normal.woff"),
  ];
  return candidates.find(existsSync) ?? "";
}

function formatMoney(value: unknown): string {
  const raw = text(value, "0.00");
  const num = Number(raw);
  if (!Number.isFinite(num)) return "0.00";
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function exactMoneyUnits(value: unknown): bigint {
  const raw = text(value, "0.0000");
  if (!/^(0|[1-9][0-9]{0,14})(?:\.([0-9]{1,4}))?$/.test(raw)) {
    throw new Error("Stored invoice line amount is invalid.");
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 10_000n + BigInt((fraction + "0000").slice(0, 4));
}

function lineAmountBeforeTaxAndDiscount(item: Record<string, unknown>): string {
  const base =
    exactMoneyUnits(item.lineTotal) -
    exactMoneyUnits(item.taxAmount) +
    exactMoneyUnits(item.discountAmount);
  if (base < 0n) throw new Error("Stored invoice line base amount is invalid.");
  return (
    (base / 10_000n).toString() +
    "." +
    (base % 10_000n).toString().padStart(4, "0")
  );
}

async function approvedBrandLogo(
  config: Record<string, unknown>
): Promise<Buffer | null> {
  const brand = object(config.brand);
  const code = text(brand.code ?? brand.name, "").toUpperCase();
  const reference = text(brand.logoReference, "");
  const brandRoot = resolve(process.cwd(), "public", "brand");
  const preferred: string[] = [];

  if (code.includes("COWORK")) preferred.push(join(brandRoot, "fx-coworks.webp"));
  else if (code.includes("DIGI")) preferred.push(join(brandRoot, "fx-digitech.webp"));
  else if (code.includes("MYFX") || code.includes("POS")) preferred.push(join(brandRoot, "myfx-pos.webp"));

  const approved: string[] = [...preferred];
  if (reference.startsWith("/brand/") && !reference.includes("..")) {
    const candidate = resolve(process.cwd(), "public", reference.slice(1));
    if (candidate.startsWith(brandRoot + sep)) approved.push(candidate);
  }
  if (code.includes("COWORK")) approved.push(join(brandRoot, "invoice-logos", "fx-coworks.jpg"));
  else if (code.includes("DIGI")) approved.push(join(brandRoot, "invoice-logos", "fx-digitech.jpg"));
  else if (code.includes("MYFX") || code.includes("POS")) approved.push(join(brandRoot, "invoice-logos", "myfx-pos.jpg"));

  const file = approved.find(
    (candidate) => candidate.startsWith(brandRoot + sep) && existsSync(candidate)
  );
  if (!file) {
    if (process.env.GITHUB_ACTIONS === "true") {
      console.error("Approved brand logo asset was not found", { brandCode: code });
    }
    return null;
  }
  try {
    const bytes = await readFile(file);
    const sharp = await import("sharp");
    return await sharp
      .default(bytes)
      .rotate()
      .flatten({ background: "#FFFFFF" })
      .toColourspace("srgb")
      .jpeg({ quality: 92, progressive: false, chromaSubsampling: "4:4:4" })
      .toBuffer();
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === "true") {
      console.error("Approved brand logo normalization failed", {
        brandCode: code,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage:
          error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      });
    }
    return null;
  }
}

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function amountInWords(value: string, currencyCode: string): string {
  const small = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];
  const underThousand = (initial: number): string => {
    let n = initial;
    const parts: string[] = [];
    if (n >= 100) {
      parts.push(small[Math.floor(n / 100)] + " hundred");
      n %= 100;
    }
    if (n >= 20) {
      parts.push(tens[Math.floor(n / 10)] + (n % 10 ? "-" + small[n % 10] : ""));
    } else if (n > 0) {
      parts.push(small[n]);
    }
    return parts.join(" ");
  };
  const wholeWords = (raw: string): string => {
    let n = BigInt(raw || "0");
    if (n === 0n) return "zero";
    const groups: Array<[bigint, string]> = [
      [10000000n, "crore"],
      [100000n, "lakh"],
      [1000n, "thousand"],
      [1n, ""],
    ];
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

  if (currencyCode === "INR") {
    const paise = Number(fraction.slice(0, 2));
    const mainTitle = toTitleCase(main);
    const paiseText = paise
      ? " and " + toTitleCase(wholeWords(String(paise))) + " Paise"
      : "";
    return "Indian Rupees " + mainTitle + paiseText + " Only /-";
  }
  if (Number(fraction) === 0) return currencyCode + " " + toTitleCase(main) + " Only /-";
  return (
    currencyCode +
    " " +
    toTitleCase(main) +
    " and decimal " +
    fraction
      .split("")
      .map((d) => small[Number(d)])
      .join(" ") +
    " Only /-"
  );
}

export async function renderDocumentPdf(
  snapshot: PdfSnapshot,
  capturedAt: Date | string
): Promise<Buffer> {
  const config = object(snapshot.configurationSnapshot);
  const brand = object(config.brand);
  const template = object(config.template);
  const templateConfig = object(template.config);
  const entityConfig = object(config.legalEntity);
  const logoBuffer = await approvedBrandLogo(config);

  let signatureBuffer: Buffer | null = null;
  const signatureReference = text(
    entityConfig.signatureReference ?? object(snapshot.supplier).signatureReference,
    ""
  );
  if (signatureReference.startsWith("signatures/")) {
    try {
      signatureBuffer = await getPrivateAsset(signatureReference);
    } catch (error) {
      console.error("Configured invoice signature asset could not be loaded", {
        sourceType: snapshot.sourceType,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return await new Promise<Buffer>((resolveBuffer, rejectBuffer) => {
    let rendererStage = "document-setup";
    try {
      const code = text(brand.code ?? brand.name, "").toUpperCase();
      const isCoworks = code.includes("COWORK");
      const isDigitech = code.includes("DIGI");
      const isMyFx = code.includes("MYFX") || code.includes("POS");

      const sourceLabel =
        snapshot.sourceType === "INVOICE"
          ? text(templateConfig.documentTitle, "PROFORMA INVOICE:")
          : snapshot.sourceType === "QUOTATION"
          ? "QUOTATION:"
          : "PAYMENT RECEIPT:";
      const isDraftPreview =
        snapshot.sourceType === "INVOICE" && snapshot.lifecycleStatus === "DRAFT";
      const issuedTime = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);

      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 38, bottom: 36, left: 40, right: 40 },
        bufferPages: true,
        compress: true,
        info: {
          Title: sourceLabel + (isDraftPreview ? " DRAFT PREVIEW" : " " + snapshot.documentNumber),
          Subject: isDraftPreview
            ? "Unissued draft preview - not an issue record"
            : "Document snapshot " + text(snapshot.configurationSnapshotId, ""),
          Author: text(
            object(snapshot.supplier).legalName ??
              object(snapshot.supplier).displayName ??
              object(snapshot.supplier).name,
            "Falchion Xeniaa Pvt. Ltd."
          ),
          Creator: "Falchion Xeniaa Invoice Management System",
          Producer: "PDFKit",
          CreationDate: Number.isFinite(issuedTime.getTime()) ? issuedTime : new Date(0),
          ModDate: Number.isFinite(issuedTime.getTime()) ? issuedTime : new Date(0),
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      doc.on("error", (error: unknown) => {
        console.error("PDF renderer stream failed", {
          stage: rendererStage,
          errorName: error instanceof Error ? error.name : "UnknownError",
          ...(process.env.GITHUB_ACTIONS === "true" && error instanceof Error
            ? { errorMessage: error.message.slice(0, 180) }
            : {}),
        });
        rejectBuffer(error);
      });
      doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));

      let hasEmbeddedNoto = false;
      const embedded = fontPath();
      if (embedded) {
        try {
          doc.registerFont("FalchionNoto", embedded);
          hasEmbeddedNoto = true;
        } catch {
          hasEmbeddedNoto = false;
        }
      }

      const fontFor = (value: string, bold = false) => {
        if (/[\u0900-\u097F]/.test(value) && hasEmbeddedNoto) return "FalchionNoto";
        return bold ? "Helvetica-Bold" : "Helvetica";
      };

      const supplier = object(snapshot.supplier);
      const customer = object(snapshot.customer);
      const issuer = text(
        supplier.legalName ?? supplier.displayName ?? supplier.name,
        "FALCHION XENIAA PVT.LTD"
      );
      const customerName = text(customer.name ?? customer.customerName, "Name");

      const left = doc.page.margins.left; // 40
      const right = doc.page.width - doc.page.margins.right; // 555.28
      const width = right - left; // 515.28
      const pageBottom = () => doc.page.height - doc.page.margins.bottom - 4;
      const clean = (value: unknown) => text(value, "");

      const addCell = (x: number, y: number, w: number, h: number, fill = "#FFFFFF") => {
        doc.save().fillColor(fill).rect(x, y, w, h).fill().restore();
        doc.save().strokeColor("#222222").lineWidth(0.55).rect(x, y, w, h).stroke().restore();
      };
      const body = (size = 8.5) => doc.font("Helvetica").fontSize(size).fillColor("#222222");

      // Background Draft Watermark
      if (isDraftPreview) {
        doc.save();
        doc.fillColor("#C8C8C8", 0.16);
        doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.font("Helvetica-Bold").fontSize(68);
        doc.text("DRAFT PREVIEW", doc.page.width / 2 - 250, doc.page.height / 2 - 34, {
          width: 500,
          align: "center",
        });
        doc.restore();
      }

      // ==========================================
      // STAGE 1: HEADER & LOGO
      // ==========================================
      rendererStage = "header";
      const logoFit: [number, number] = isDigitech
        ? [195, 52]
        : isCoworks
        ? [115, 75]
        : isMyFx
        ? [140, 62]
        : [140, 68];

      if (logoBuffer) {
        doc.image(logoBuffer, left, 40, { fit: logoFit, valign: "center" });
      } else {
        doc
          .font("Helvetica-Bold")
          .fontSize(22)
          .fillColor("#111111")
          .text(
            isCoworks ? "FX Coworks" : isDigitech ? "FX DigiTech" : "myfx POS",
            left,
            46,
            { width: 200 }
          );
      }

      const titleWidth = 240;
      const titleX = right - titleWidth;

      // Document Title (e.g. "PROFORMA INVOICE:")
      doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .fillColor("#111111")
        .text(sourceLabel, titleX, 44, { width: titleWidth, align: "right" });

      // Invoice / Document Number
      const documentNumberLabel = isDraftPreview
        ? (!snapshot.documentNumber || snapshot.documentNumber === "DRAFT" ? "Invoice no: 00001" : "Invoice no: " + text(snapshot.documentNumber))
        : snapshot.sourceType === "RECEIPT"
        ? "Receipt no: " + text(snapshot.documentNumber)
        : snapshot.sourceType === "QUOTATION"
        ? "Quotation no: " + text(snapshot.documentNumber)
        : "Invoice no: " + text(snapshot.documentNumber);

      doc
        .font("Helvetica")
        .fontSize(10.5)
        .fillColor("#111111")
        .text(documentNumberLabel, titleX, 66, { width: titleWidth, align: "right" });

      // Date line: single-line right-aligned
      const dateVal = snapshot.documentDate ? snapshot.documentDate.slice(0, 10) : "........................";
      doc.font("Helvetica").fontSize(9.5);
      const valW = doc.widthOfString(dateVal);
      doc.font("Helvetica-Bold").fontSize(9.5);
      const labelW = doc.widthOfString("Date: ");
      const dateStartX = right - (labelW + valW);
      doc.fillColor("#111111").text("Date: ", dateStartX, 86, { continued: true });
      doc.font("Helvetica").fillColor("#111111").text(dateVal);

      // Expiry / Due Date line: single-line right-aligned
      const isProforma = sourceLabel.toUpperCase().includes("PROFORMA");
      const showExpiry =
        snapshot.sourceType === "QUOTATION" ||
        (snapshot.sourceType === "INVOICE" && (isDraftPreview || isProforma));
      const expiryLabel = showExpiry
        ? "Expires on: "
        : snapshot.sourceType === "INVOICE"
        ? "Due date: "
        : "Payment date: ";
      const expiry =
        snapshot.sourceType === "QUOTATION"
          ? snapshot.validUntil
          : snapshot.sourceType === "INVOICE"
          ? showExpiry
            ? snapshot.validUntil
            : snapshot.dueDate
          : snapshot.documentDate;
      const expiryVal = expiry ? expiry.slice(0, 10) : "........................";

      doc.font("Helvetica").fontSize(9.5);
      const expValW = doc.widthOfString(expiryVal);
      doc.font("Helvetica-Bold").fontSize(9.5);
      const expLabelW = doc.widthOfString(expiryLabel);
      const expStartX = right - (expLabelW + expValW);
      doc.fillColor("#111111").text(expiryLabel, expStartX, 104, { continued: true });
      doc.font("Helvetica").fillColor("#111111").text(expiryVal);

      // 3-Segment Accent Rule: Primary brand tri-color separator (Images 3, 4, 5)
      const separatorY = 124;
      const stripeWidth = width / 3;
      doc.save().fillColor("#F2C354").rect(left, separatorY, stripeWidth, 4).fill().restore();
      doc.save().fillColor("#F04A37").rect(left + stripeWidth, separatorY, stripeWidth, 4).fill().restore();
      doc.save().fillColor("#5EA978").rect(left + stripeWidth * 2, separatorY, width - stripeWidth * 2, 4).fill().restore();

      // ==========================================
      // STAGE 2: ISSUER & CUSTOMER DETAILS
      // ==========================================
      rendererStage = "issuer-customer";
      const identityY = 150;
      const half = (width - 30) / 2;

      // Supplier Details (Left)
      const leftAddress = addressLines(
        supplier.billingAddress ?? supplier.address ?? supplier.registeredAddress
      );
      const registrations = Array.isArray(config.selectedTaxRegistrations)
        ? (config.selectedTaxRegistrations as unknown[]).map((value) => object(value))
        : [];
      const taxRegLines = registrations
        .map((reg) => {
          const type = clean(reg.registrationType ?? reg.displayLabel ?? reg.registrationKey);
          const number = clean(reg.registrationNumber);
          return type && number ? type + ": " + number : number || type;
        })
        .filter(Boolean);

      const supplierGstin = clean(supplier.taxIdentifier ?? supplier.gstNumber);
      const issuerLines = [
        clean(supplier.invoicePhone ?? supplier.phone) || "+91 7620 002 469",
        ...(leftAddress.length ? leftAddress : ["Girish, 1156, Shukrawar Peth,", "Pune – 411002"]),
        ...(taxRegLines.length
          ? taxRegLines
          : supplierGstin
          ? ["GSTIN: " + supplierGstin]
          : ["GSTIN: 27AAGCF3329Q1Z4"]),
      ].filter(Boolean);

      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#111111")
        .text(issuer.toUpperCase(), left, identityY, { width: half });
      body(9).text(issuerLines.join("\n"), left, identityY + 16, {
        width: half,
        lineGap: 2.5,
      });

      // Customer Details (Right: BILL TO)
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#111111")
        .text("BILL TO:", titleX, identityY, { width: titleWidth, align: "right" });

      const customerAddress = addressLines(customer.billingAddress ?? customer.address);
      const clientLines = [
        customerName || "Name",
        clean(customer.phone) || "Number",
        ...(customerAddress.length ? customerAddress : ["Address"]),
        clean(customer.taxIdentifier) ? "GSTIN: " + clean(customer.taxIdentifier) : "GSTIN: Number",
      ].filter(Boolean);

      body(9).text(clientLines.join("\n"), titleX, identityY + 16, {
        width: titleWidth,
        align: "right",
        lineGap: 2.5,
      });

      // Position Y for table start
      doc.y = 245;

      // ==========================================
      // STAGE 3: LINE ITEMS TABLE
      // ==========================================
      rendererStage = "line-items";
      const rows = Array.isArray(snapshot.lines) ? snapshot.lines : [];
      // Table column widths matching Images 3, 4, 5: Total = 515.28pt
      const columnWidths = [34, 196, 95, 95, 95.28];
      const columnXs = [left];
      for (let i = 0; i < columnWidths.length - 1; i++) {
        columnXs.push(columnXs[i] + columnWidths[i]);
      }

      const headerHeight = 24;
      const drawLineHeader = () => {
        const y = doc.y;
        const labels = ["#", "Description", "Milestone", "Rate", "Amount"];
        labels.forEach((label, index) => {
          addCell(columnXs[index], y, columnWidths[index], headerHeight, "#ECECEC");
          doc
            .font("Helvetica-Bold")
            .fontSize(8.5)
            .fillColor("#111111")
            .text(label, columnXs[index] + 4, y + 6.5, {
              width: columnWidths[index] - 8,
              align: index === 0 ? "center" : "left",
            });
        });
        doc.y = y + headerHeight;
      };

      drawLineHeader();

      // Render lines or empty row template
      const displayRows = rows.length > 0 ? rows : [{ lineNumber: 1, description: "", milestone: "", unitPrice: "", lineTotal: "" }];

      displayRows.forEach((raw, index) => {
        const item = object(raw);
        const description = text(item.description, "");
        const milestone = text(item.milestone, "");
        body(8.5);

        const descH = description ? doc.heightOfString(description, { width: columnWidths[1] - 10 }) : 14;
        const milestoneH = milestone ? doc.heightOfString(milestone, { width: columnWidths[2] - 8 }) : 14;
        const rowHeight = Math.max(26, descH + 12, milestoneH + 12);

        if (doc.y + rowHeight > pageBottom() - 120) {
          doc.addPage();
          doc.y = 38;
          drawLineHeader();
        }

        const y = doc.y;
        const rateVal = item.unitPrice ? formatMoney(item.unitPrice) : "";
        const amtVal = item.lineTotal ? formatMoney(lineAmountBeforeTaxAndDiscount(item)) : "";

        columnWidths.forEach((cellWidth, col) => addCell(columnXs[col], y, cellWidth, rowHeight));

        doc
          .font("Helvetica")
          .fontSize(8.5)
          .fillColor("#161616")
          .text(String(item.lineNumber ?? index + 1), columnXs[0] + 2, y + 7, {
            width: columnWidths[0] - 4,
            align: "center",
          });

        if (description) {
          doc
            .font(fontFor(description))
            .fontSize(8.5)
            .fillColor("#161616")
            .text(description, columnXs[1] + 5, y + 7, { width: columnWidths[1] - 10 });
        }
        if (milestone) {
          doc
            .font(fontFor(milestone))
            .fontSize(8)
            .fillColor("#555555")
            .text(milestone, columnXs[2] + 4, y + 7, { width: columnWidths[2] - 8 });
        }
        if (rateVal) {
          doc
            .font("Helvetica")
            .fontSize(8.5)
            .fillColor("#161616")
            .text(rateVal, columnXs[3] + 4, y + 7, { width: columnWidths[3] - 8, align: "left" });
        }
        if (amtVal) {
          doc
            .font("Helvetica")
            .fontSize(8.5)
            .fillColor("#161616")
            .text(amtVal, columnXs[4] + 4, y + 7, { width: columnWidths[4] - 8, align: "left" });
        }

        doc.y = y + rowHeight;
      });

      // ==========================================
      // STAGE 4: TOTALS & AMOUNT IN WORDS
      // ==========================================
      rendererStage = "totals";
      const tableEnd = doc.y;
      const totalsLabelX = columnXs[3]; // Rate column X = 365
      const totalsValueX = columnXs[4]; // Amount column X = 460
      const rateWidth = columnWidths[3]; // 95
      const amountWidth = columnWidths[4]; // 95.28

      const pct = (r: unknown) => String(Number(r ?? 0));
      const totals = [
        ["Sub Total:", formatMoney(snapshot.subtotal)],
        ...(Number(snapshot.discountTotal) !== 0
          ? [["Discount:", "− " + formatMoney(snapshot.discountTotal)] as [string, string]]
          : []),
        ...(snapshot.sourceType === "INVOICE" && snapshot.taxMode === "COMPONENTS"
          ? [
              ...(snapshot.cgstEnabled && !snapshot.sgstEnabled
                ? [["IGST (" + pct(snapshot.cgstRate ?? 18) + "%):", formatMoney(snapshot.cgstAmount)] as [string, string]]
                : [
                    ...(snapshot.cgstEnabled
                      ? [["CGST (" + pct(snapshot.cgstRate ?? 9) + "%):", formatMoney(snapshot.cgstAmount)] as [string, string]]
                      : []),
                    ...(snapshot.sgstEnabled
                      ? [["SGST (" + pct(snapshot.sgstRate ?? 9) + "%):", formatMoney(snapshot.sgstAmount)] as [string, string]]
                      : []),
                  ]),
            ]
          : [["Tax:", formatMoney(snapshot.taxTotal)] as [string, string]]),
        ["Grand Total:", formatMoney(snapshot.grandTotal)],
      ] as Array<[string, string]>;

      const totalRowHeight = 22;
      let curTotalsY = tableEnd;

      totals.forEach(([label, value], idx) => {
        const isGrand = idx === totals.length - 1;
        addCell(totalsLabelX, curTotalsY, rateWidth, totalRowHeight, "#FFFFFF");
        addCell(totalsValueX, curTotalsY, amountWidth, totalRowHeight, "#FFFFFF");

        doc
          .font(isGrand ? "Helvetica-Bold" : "Helvetica")
          .fontSize(8.5)
          .fillColor("#111111")
          .text(label, totalsLabelX + 4, curTotalsY + 5.5, {
            width: rateWidth - 8,
            align: "right",
          });

        doc
          .font(isGrand ? "Helvetica-Bold" : "Helvetica")
          .fontSize(8.5)
          .fillColor("#111111")
          .text(value, totalsValueX + 4, curTotalsY + 5.5, {
            width: amountWidth - 8,
            align: "right",
          });

        curTotalsY += totalRowHeight;
      });

      // Amount in words: Opposite the Totals table on the left
      rendererStage = "amount-words";
      const words = amountInWords(
        formatMoney(snapshot.grandTotal).replace(/,/g, ""),
        text(snapshot.currency, "INR")
      );

      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor("#111111")
        .text("Amount in words:", left, tableEnd + 8, { width: 300 });

      body(8.5).text(words, left, tableEnd + 24, {
        width: 300,
        lineGap: 2.5,
      });

      // Bottom boundary after Totals & Words
      doc.y = Math.max(curTotalsY + 16, tableEnd + 70);

      // Notes / Reversal reason if applicable
      if (snapshot.reversalReason) {
        doc.moveDown(0.3);
        doc
          .font(fontFor(text(snapshot.reversalReason)))
          .fontSize(8)
          .fillColor("#B42318")
          .text("REVERSAL REASON: " + text(snapshot.reversalReason), left, doc.y, { width });
      }
      if (snapshot.notes) {
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#111111").text("NOTES", left, doc.y);
        body(8).text(text(snapshot.notes), left, doc.y + 2, { width, lineGap: 2 });
      }

      // ==========================================
      // STAGE 5: BANK DETAILS & TERMS (FOOTER)
      // ==========================================
      rendererStage = "bank-and-terms";
      const bank = object(
        entityConfig.bankDetails ?? supplier.bankDetails ?? supplier.bankDetailsJson
      );
      const bankLines = [
        "Beneficiary Name: " + (clean(bank.beneficiaryName ?? bank.accountName) || "Falchion Xeniaa PVT.LTD"),
        "Bank: " + (clean(bank.bankName) || "HDFC Bank - Tilak Rd, Pune"),
        "IFSC: " + (clean(bank.ifsc ?? bank.ifscCode) || "HDFC0003649"),
        "Account number: " + (clean(bank.accountNumber ?? bank.accountNo) || "50200109561568"),
        "Email: " + (clean(bank.email ?? supplier.invoiceEmail ?? supplier.email) || "omshah@falchionxeniaa.com"),
      ];

      const rawTerms = text(
        templateConfig.terms ?? entityConfig.invoiceTerms ?? templateConfig.footer ?? entityConfig.invoiceFooter,
        ""
      );
      const defaultTerms = [
        "1. Please pay bills within 15 days of receipt.",
        "2. 15% Interest will be charged on overdue bills.",
        '3. All Cheques Payable to "Falchion Xeniaa Pvt.Ltd".',
      ].join("\n");
      const terms = rawTerms.trim() || defaultTerms;

      const closing = "Looking forward to doing business with you.";
      const footerHalf = 280;
      const rightFooterX = 335;
      const rightFooterWidth = right - rightFooterX;

      // Keep single page layout intact: footer sits comfortably at ~490pt
      const footerTop = Math.max(doc.y + 16, 490);
      if (footerTop + 140 > pageBottom()) {
        doc.addPage();
        doc.y = 40;
      }

      // Left Column: Closing + Bank Details
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#111111")
        .text(closing, left, footerTop, { width: 300 });

      body(8.5).text(bankLines.join("\n"), left, footerTop + 22, {
        width: footerHalf,
        lineGap: 3.5,
      });

      // Right Column: Terms & Conditions
      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor("#111111")
        .text("Terms & Conditions", rightFooterX, footerTop + 4, { width: rightFooterWidth });

      body(8.5).text(terms, rightFooterX, footerTop + 22, {
        width: rightFooterWidth,
        lineGap: 4,
      });

      // ==========================================
      // STAGE 6: SIGNATURE & PAGE NUMBER
      // ==========================================
      const signatureY = 735;
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor("#111111")
        .text("Signature:", left, signatureY, { width: 55 });

      if (signatureBuffer) {
        doc.image(signatureBuffer, left + 58, signatureY - 14, { fit: [140, 32] });
      } else {
        doc
          .moveTo(left + 58, signatureY + 8)
          .lineTo(left + 230, signatureY + 8)
          .strokeColor("#222222")
          .lineWidth(0.7)
          .stroke();
      }

      // Optional SHA config hash (subtle)
      if (snapshot.configurationSha256) {
        doc
          .font("Helvetica")
          .fontSize(5.5)
          .fillColor("#888888")
          .text(
            "Configuration snapshot SHA-256: " + snapshot.configurationSha256,
            left,
            765,
            { width }
          );
      }

      // Draft warning note if applicable
      if (isDraftPreview && snapshot.previewWarnings?.length) {
        doc
          .font("Helvetica")
          .fontSize(6.5)
          .fillColor("#8A5B00")
          .text(
            "Draft preview — not an issued invoice: " + snapshot.previewWarnings.slice(0, 2).join("; "),
            left,
            776,
            { width, align: "center" }
          );
      }

      // Page numbering centered at bottom
      const pages = doc.bufferedPageRange();
      for (let p = pages.start; p < pages.start + pages.count; p++) {
        doc.switchToPage(p);
        const y = 790;
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor("#111111")
          .text(String(p + 1), left, y, { width, align: "center" });
      }

      rendererStage = "finalize";
      doc.end();
    } catch (error) {
      console.error("PDF renderer failed", {
        stage: rendererStage,
        errorName: error instanceof Error ? error.name : "UnknownError",
        ...(process.env.GITHUB_ACTIONS === "true" && error instanceof Error
          ? { errorMessage: error.message.slice(0, 180) }
          : {}),
      });
      rejectBuffer(error);
    }
  });
}
