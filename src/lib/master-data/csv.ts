import "server-only";

export type CsvRow = { rowNumber: number; values: Record<string, string> };
export type CsvParseIssue = { rowNumber: number; field?: string; message: string };
export type CsvParseResult = { headers: string[]; rows: CsvRow[]; errors: CsvParseIssue[] };

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 500;

export function normalizeCsvHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function parseCsv(source: string): CsvParseResult {
  if (Buffer.byteLength(source, "utf8") > MAX_CSV_BYTES) {
    return { headers: [], rows: [], errors: [{ rowNumber: 1, message: "CSV file must be 1 MB or smaller." }] };
  }
  const input = source.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else field += ch;
      continue;
    }
    if (afterQuote && ch !== "," && ch !== "\r" && ch !== "\n" && ch !== " " && ch !== "\t") {
      return { headers: [], rows: [], errors: [{ rowNumber: records.length + 1, message: "Unexpected character after a quoted CSV field." }] };
    }
    if (ch === '"' && field.length === 0 && !afterQuote) { quoted = true; continue; }
    if (ch === "," ) { record.push(field); field = ""; afterQuote = false; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      record.push(field); records.push(record);
      record = []; field = ""; afterQuote = false;
      continue;
    }
    if (afterQuote && (ch === " " || ch === "\t")) continue;
    field += ch;
  }
  if (quoted) return { headers: [], rows: [], errors: [{ rowNumber: records.length + 1, message: "CSV contains an unterminated quoted field." }] };
  if (field.length > 0 || record.length > 0 || afterQuote) { record.push(field); records.push(record); }
  while (records.length && records[records.length - 1].every(value => !value.trim())) records.pop();
  if (!records.length || records[0].every(value => !value.trim())) {
    return { headers: [], rows: [], errors: [{ rowNumber: 1, message: "CSV must include a header row and at least one data row." }] };
  }
  const headers = records[0].map(value => value.trim());
  const normalized = headers.map(normalizeCsvHeader);
  const errors: CsvParseIssue[] = [];
  const seen = new Set<string>();
  normalized.forEach((header, index) => {
    if (!header) errors.push({ rowNumber: 1, field: headers[index] || String(index + 1), message: "Header names cannot be blank." });
    else if (seen.has(header)) errors.push({ rowNumber: 1, field: headers[index], message: "Duplicate header is not allowed." });
    seen.add(header);
  });
  const rows: CsvRow[] = [];
  if (records.length - 1 > MAX_CSV_ROWS) {
    return { headers, rows: [], errors: [{ rowNumber: MAX_CSV_ROWS + 2, message: `CSV may contain at most ${MAX_CSV_ROWS} data rows per import.` }] };
  }
  for (let index = 1; index < records.length; index++) {
    const cells = records[index];
    const rowNumber = index + 1;
    if (cells.every(value => !value.trim())) continue;
    if (cells.length !== headers.length) {
      errors.push({ rowNumber, message: `Expected ${headers.length} columns but found ${cells.length}.` });
      continue;
    }
    const values: Record<string, string> = {};
    normalized.forEach((key, i) => { if (key) values[key] = unescapeCsvCell(cells[i].trim()); });
    rows.push({ rowNumber, values });
  }
  return { headers, rows, errors };
}

// A cell that a spreadsheet could read as a formula (after any leading spaces or apostrophes) is exported
// with one extra leading apostrophe; import removes exactly that one apostrophe. Values such as phone
// numbers ("+91 …") therefore stay inert in a spreadsheet and still round-trip unchanged.
const FORMULA_LEAD = /^[\s']*[=+\-@]/;

export function unescapeCsvCell(value: string): string {
  return value.startsWith("'") && FORMULA_LEAD.test(value.slice(1)) ? value.slice(1) : value;
}

export function csvEscape(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : String(value);
  if (FORMULA_LEAD.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function buildCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [headers.map(csvEscape).join(","), ...rows.map(row => headers.map(header => csvEscape(row[header])).join(","))].join("\r\n") + "\r\n";
}

export function parseJsonCell(value: string | undefined, field: string, rowNumber: number): { value?: unknown; error?: CsvParseIssue } {
  if (!value?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return { error: { rowNumber, field, message: "Must be a JSON object or array matching the import template." } };
    }
    return { value: parsed };
  } catch {
    return { error: { rowNumber, field, message: "Contains invalid JSON." } };
  }
}
