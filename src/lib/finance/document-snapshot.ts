/** Extract the customer name captured at document issue time without exposing the full snapshot. */
export function customerNameFromSnapshot(value: unknown): string | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed) as unknown; } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const name = (parsed as Record<string, unknown>).name;
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}
