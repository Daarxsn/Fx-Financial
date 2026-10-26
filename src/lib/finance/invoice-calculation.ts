/**
 * Invoice calculation policy v1.
 * - Money/quantity use exact decimal strings and BigInt scaled integers, never floating point.
 * - Each line extension, discount and tax amount rounds HALF_UP to 4 decimal places.
 * - Tax rates are percentages (18 means 18%), with up to 6 fractional digits.
 * - Inclusive unit prices include tax. Discounts are entered in the selected price mode.
 * - Subtotal is the net-of-tax base before discounts; discountTotal is net of tax;
 *   taxableValue = subtotal - discountTotal; taxTotal is line tax; grandTotal sums line totals.
 * - Already-rounded line values are summed. Persisted monetary values match DECIMAL(19,4).
 * - Currency conversion is intentionally not performed; the legal entity currency is authoritative.
 */
export type InvoiceLineKind = "ITEM" | "CHARGE";
export type DiscountType = "AMOUNT" | "PERCENT";
export type TaxCalculationMode = "EXCLUSIVE" | "INCLUSIVE";
export type InvoiceCalculationLineInput = {
  lineKind?: InvoiceLineKind; description: string; quantity: string; unitPrice: string;
  discountType?: DiscountType; discountValue?: string; taxRatePercent: string;
  taxCalculationMode: TaxCalculationMode;
};
export type CalculatedInvoiceLine = {
  lineKind: InvoiceLineKind; description: string; quantity: string; unitPrice: string;
  discountType: DiscountType; discountValue: string; taxRatePercent: string;
  taxCalculationMode: TaxCalculationMode; extendedAmount: string; subtotal: string;
  discountAmount: string; taxableValue: string; taxAmount: string; lineTotal: string;
};
export type InvoiceCalculation = {
  policyVersion: "invoice-calculation-v1"; lines: CalculatedInvoiceLine[];
  subtotal: string; discountTotal: string; taxableValue: string; taxTotal: string; grandTotal: string;
};
const MONEY_SCALE = 10_000n;
const DISCOUNT_PERCENT_SCALE = 10_000n;
const TAX_PERCENT_SCALE = 1_000_000n;
const HUNDRED_TAX = 100n * TAX_PERCENT_SCALE;
const MAX_MONEY_UNITS = 9_999_999_999_999_999_999n;
const MONEY_PATTERN = /^(0|[1-9][0-9]{0,14})(?:\.([0-9]{1,4}))?$/;
const QUANTITY_PATTERN = /^(0|[1-9][0-9]{0,14})(?:\.([0-9]{1,4}))?$/;
const RATE_PATTERN = /^(0|[1-9][0-9]{0,14})(?:\.([0-9]{1,4}))?$/;
const TAX_RATE_PATTERN = /^(0|[1-9][0-9]{0,2})(?:\.([0-9]{1,6}))?$/;

function parseScaled(value: string, scaleDigits: number, pattern: RegExp, label: string): bigint {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(label + " must be a non-negative decimal string with supported precision.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * (10n ** BigInt(scaleDigits))
    + BigInt((fraction + "0".repeat(scaleDigits)).slice(0, scaleDigits) || "0");
}
function formatScaled(value: bigint, scaleDigits: number): string {
  if (value < 0n) throw new Error("Calculated values cannot be negative.");
  const scale = 10n ** BigInt(scaleDigits);
  const fraction = (value % scale).toString().padStart(scaleDigits, "0");
  return scaleDigits ? (value / scale).toString() + "." + fraction : (value / scale).toString();
}
function assertMoneyRange(value: bigint, label: string): bigint {
  if (value < 0n || value > MAX_MONEY_UNITS) throw new Error(label + " exceeds the supported DECIMAL(19,4) range.");
  return value;
}
/** Integer division using explicit non-negative ROUND_HALF_UP. */
function roundDivHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("Invalid non-negative rounding operation.");
  const whole = numerator / denominator;
  return whole + ((numerator % denominator) * 2n >= denominator ? 1n : 0n);
}
function multiplyMoney(quantity: bigint, unitPrice: bigint): bigint {
  return assertMoneyRange(roundDivHalfUp(quantity * unitPrice, MONEY_SCALE), "Line extension");
}
function splitInclusiveGross(gross: bigint, rate: bigint): bigint {
  return roundDivHalfUp(gross * HUNDRED_TAX, HUNDRED_TAX + rate);
}
function calculateExclusiveTax(taxable: bigint, rate: bigint): bigint {
  return assertMoneyRange(roundDivHalfUp(taxable * rate, HUNDRED_TAX), "Tax amount");
}
function calculateDiscount(gross: bigint, type: DiscountType, value: bigint, mode: TaxCalculationMode, rate: bigint) {
  let entered: bigint;
  if (type === "PERCENT") {
    if (value > 100n * DISCOUNT_PERCENT_SCALE) throw new Error("Discount percentage must not exceed 100.");
    entered = roundDivHalfUp(gross * value, 100n * DISCOUNT_PERCENT_SCALE);
  } else {
    entered = value;
  }
  if (entered > gross) throw new Error("Discount cannot exceed the extended line amount.");
  return { entered, net: mode === "INCLUSIVE" ? splitInclusiveGross(entered, rate) : entered };
}

export type InvoiceTaxComponents = {
  cgstAmount: string; sgstAmount: string; taxTotal: string; grandTotal: string;
};

/** Exact-decimal invoice-level CGST/SGST; issuance must separately validate approved rates. */
export function calculateInvoiceTaxComponents(
  taxableValue: string, cgstEnabled: boolean, cgstRatePercent: string,
  sgstEnabled: boolean, sgstRatePercent: string,
): InvoiceTaxComponents {
  const base = parseScaled(taxableValue, 4, MONEY_PATTERN, "Taxable value");
  const component = (enabled: boolean, rateText: string, label: string): bigint => {
    if (!enabled) return 0n;
    const rate = parseScaled(rateText, 6, TAX_RATE_PATTERN, label + " rate");
    if (rate > HUNDRED_TAX) throw new Error(label + " rate must not exceed 100 percent.");
    return assertMoneyRange(roundDivHalfUp(base * rate, HUNDRED_TAX), label + " amount");
  };
  const cgst = component(cgstEnabled, cgstRatePercent, "CGST");
  const sgst = component(sgstEnabled, sgstRatePercent, "SGST");
  const tax = assertMoneyRange(cgst + sgst, "Invoice tax total");
  const grand = assertMoneyRange(base + tax, "Invoice grand total");
  return { cgstAmount: formatScaled(cgst, 4), sgstAmount: formatScaled(sgst, 4),
    taxTotal: formatScaled(tax, 4), grandTotal: formatScaled(grand, 4) };
}

export function calculateInvoice(lines: InvoiceCalculationLineInput[]): InvoiceCalculation {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 500) {
    throw new Error("An invoice must contain between 1 and 500 lines.");
  }
  let subtotal = 0n, discountTotal = 0n, taxableValue = 0n, taxTotal = 0n, grandTotal = 0n;
  const calculatedLines = lines.map((line, index): CalculatedInvoiceLine => {
    const label = "Line " + (index + 1);
    if (!line || typeof line.description !== "string" || !line.description.trim()) throw new Error(label + " requires a description.");
    if (line.taxCalculationMode !== "EXCLUSIVE" && line.taxCalculationMode !== "INCLUSIVE") throw new Error(label + " has an unsupported tax calculation mode.");
    const lineKind = line.lineKind ?? "ITEM";
    if (lineKind !== "ITEM" && lineKind !== "CHARGE") throw new Error(label + " has an unsupported line kind.");
    const discountType = line.discountType ?? "AMOUNT";
    if (discountType !== "AMOUNT" && discountType !== "PERCENT") throw new Error(label + " has an unsupported discount type.");
    const quantity = parseScaled(line.quantity, 4, QUANTITY_PATTERN, "Quantity");
    if (quantity <= 0n) throw new Error(label + " quantity must be greater than zero.");
    const unitPrice = parseScaled(line.unitPrice, 4, MONEY_PATTERN, "Unit price");
    const discountValue = parseScaled(line.discountValue ?? "0", 4, RATE_PATTERN, "Discount");
    const taxRate = parseScaled(line.taxRatePercent, 6, TAX_RATE_PATTERN, "Tax rate");
    if (taxRate > HUNDRED_TAX) throw new Error("Tax rate must not exceed 100 percent.");
    const extended = multiplyMoney(quantity, unitPrice);
    const discount = calculateDiscount(extended, discountType, discountValue, line.taxCalculationMode, taxRate);
    const lineSubtotal = line.taxCalculationMode === "INCLUSIVE" ? splitInclusiveGross(extended, taxRate) : extended;
    const lineTaxable = assertMoneyRange(lineSubtotal - discount.net, "Taxable value");
    const postDiscountGross = extended - discount.entered;
    const lineTax = line.taxCalculationMode === "INCLUSIVE"
      ? assertMoneyRange(postDiscountGross - lineTaxable, "Tax amount")
      : calculateExclusiveTax(lineTaxable, taxRate);
    const lineTotal = assertMoneyRange(lineTaxable + lineTax, "Line total");
    subtotal = assertMoneyRange(subtotal + lineSubtotal, "Invoice subtotal");
    discountTotal = assertMoneyRange(discountTotal + discount.net, "Invoice discount total");
    taxableValue = assertMoneyRange(taxableValue + lineTaxable, "Invoice taxable value");
    taxTotal = assertMoneyRange(taxTotal + lineTax, "Invoice tax total");
    grandTotal = assertMoneyRange(grandTotal + lineTotal, "Invoice total");
    return {
      lineKind, description: line.description.trim(), quantity: formatScaled(quantity, 4),
      unitPrice: formatScaled(unitPrice, 4), discountType, discountValue: formatScaled(discountValue, 4),
      taxRatePercent: formatScaled(taxRate, 6), taxCalculationMode: line.taxCalculationMode,
      extendedAmount: formatScaled(extended, 4), subtotal: formatScaled(lineSubtotal, 4),
      discountAmount: formatScaled(discount.net, 4), taxableValue: formatScaled(lineTaxable, 4),
      taxAmount: formatScaled(lineTax, 4), lineTotal: formatScaled(lineTotal, 4),
    };
  });
  return {
    policyVersion: "invoice-calculation-v1", lines: calculatedLines,
    subtotal: formatScaled(subtotal, 4), discountTotal: formatScaled(discountTotal, 4),
    taxableValue: formatScaled(taxableValue, 4), taxTotal: formatScaled(taxTotal, 4),
    grandTotal: formatScaled(grandTotal, 4),
  };
}
export function normalizeMoney(value: string | number): string {
  return formatScaled(parseScaled(String(value), 4, MONEY_PATTERN, "Money value"), 4);
}
export function calculateOutstandingBalance(
  grandTotal: string | number,
  allocatedPayments: string | number,
): { outstandingBalance: string; creditBalance: string } {
  const total = parseScaled(String(grandTotal), 4, MONEY_PATTERN, "Invoice total");
  const paid = parseScaled(String(allocatedPayments), 4, MONEY_PATTERN, "Allocated payments");
  if (paid > total) {
    return {
      outstandingBalance: "0.0000",
      creditBalance: formatScaled(paid - total, 4),
    };
  }
  return {
    outstandingBalance: formatScaled(total - paid, 4),
    creditBalance: "0.0000",
  };
}

export function outstandingBalance(grandTotal: string | number, allocatedPayments: string | number): string {
  return calculateOutstandingBalance(grandTotal, allocatedPayments).outstandingBalance;
}
export function defaultDueDate(invoiceDate: string, paymentTermsDays: number): string {
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) throw new Error("Payment terms must be an integer from 0 to 3650 days.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) throw new Error("Invoice date must use YYYY-MM-DD.");
  const date = new Date(invoiceDate + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== invoiceDate) throw new Error("Invoice date must be a real calendar date.");
  date.setUTCDate(date.getUTCDate() + paymentTermsDays);
  return date.toISOString().slice(0, 10);
}
export function assertValidDueDate(invoiceDate: string, dueDate: string): void {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(invoiceDate) || !validDate(dueDate)) throw new Error("Invoice and due dates must be real calendar dates.");
  if (dueDate < invoiceDate) throw new Error("Due date cannot be earlier than invoice date.");
}

/** Exact decimal subtraction for already-normalized DECIMAL(19,4) values, clamped at zero. */
export function subtractMoney(totalValue: string | number, partValue: string | number): string {
  const total=parseScaled(String(totalValue),4,MONEY_PATTERN,"Money value");
  const part=parseScaled(String(partValue),4,MONEY_PATTERN,"Money value");
  return formatScaled(total>part?total-part:0n,4);
}
