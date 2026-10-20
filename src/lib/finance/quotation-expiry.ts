import { calendarDateInTimeZone } from "@/lib/configuration/service";

/**
 * A quotation remains valid through its validUntil calendar day in the issuing
 * legal entity's business timezone. Return null when the configured timezone
 * is invalid so callers do not silently substitute the server's UTC date.
 */
export function isQuotationExpired(
  validUntil: string | null,
  timeZone: string | null,
  now = new Date(),
): boolean | null {
  if (validUntil === null) return false;
  const businessDate = calendarDateInTimeZone(timeZone, now);
  if (businessDate === null) return null;
  return validUntil < businessDate;
}
