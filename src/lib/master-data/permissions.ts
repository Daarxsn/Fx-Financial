import "server-only";

/** Internal catalog descriptions are visible to catalog maintainers and settings administrators only. */
export function canReadCatalogInternal(permissions: string[]): boolean {
  return permissions.includes("catalog:update") || permissions.includes("settings:manage");
}
