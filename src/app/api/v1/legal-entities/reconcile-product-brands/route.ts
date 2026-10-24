import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import {
  BRAND_LOGO_ASSETS,
  isFalchionXeniaaSupplierName,
  isProductBrandLegalEntityName,
} from "@/lib/brand-assets";
import { canonicalJson, recordAudit } from "@/lib/configuration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECONCILIATION_REASON =
  "Reconcile MyFX POS, FX Digitech and FX Coworks to the single Falchion Xeniaa supplier";

type EntityRow = RowDataPacket & {
  id: string; legal_name: string; display_name: string; is_active: number;
  currency: string; tax_setup_status: string;
};
type BrandRow = RowDataPacket & {
  id: string; name: string; code: string; description: string | null;
  logo_reference: string | null; theme_json: unknown; default_template_key: string | null; is_active: number;
};
type MappingRow = RowDataPacket & {
  brand_id: string; legal_entity_id: string; is_default: number;
  effective_from: Date | string | null; effective_until: Date | string | null;
  is_current: number; is_future: number;
};
function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}
function conflict(code: string, message: string) {
  return jsonNoStore({ error: { code, message } }, 409);
}

/**
 * Repairs only product-brand mappings. It never creates/renames/deletes legal entities,
 * moves invoices, or fabricates tax, bank, registration, numbering, or policy approval values.
 */
export async function POST(request: NextRequest) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    await assertCsrf(request);
    const actor = await requirePermission("settings:manage");
    if (!actor.roles.includes("system_admin")) {
      return jsonNoStore({
        error: { code: "FORBIDDEN", message: "Only a Super Administrator can reconcile product-brand mappings." },
      }, 403);
    }

    const productAssets = BRAND_LOGO_ASSETS.filter((asset) => asset.audience === "Product");
    const productCodes = productAssets.map((asset) => asset.code);
    if (productAssets.length !== 3) {
      return conflict("CONFIGURATION_CONFLICT", "The application does not contain exactly three product-brand identities.");
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Lock brand records first to match the brand API's locking order.
    const codePlaceholders = productCodes.map(() => "?").join(",");
    const [brandRows] = await conn.query<BrandRow[]>(
      `SELECT id,name,code,description,logo_reference,theme_json,default_template_key,is_active
         FROM brands WHERE code IN (${codePlaceholders}) ORDER BY code FOR UPDATE`,
      productCodes,
    );
    if (brandRows.length !== productAssets.length) {
      await conn.rollback();
      return conflict(
        "PRODUCT_BRANDS_INCOMPLETE",
        "All three existing product brands must be present before reconciliation. The repair will not create replacement brands or guess which records to use.",
      );
    }
    const brandsByCode = new Map(brandRows.map((brand) => [brand.code, brand]));
    for (const asset of productAssets) {
      const brand = brandsByCode.get(asset.code);
      if (!brand || !brand.is_active || brand.name !== asset.name) {
        await conn.rollback();
        return conflict(
          "PRODUCT_BRAND_IDENTITY_MISMATCH",
          "The database identity for " + asset.name + " does not match the approved product-brand record. Resolve that mismatch before remapping.",
        );
      }
    }

    // Lock all entities and accept only exactly named active supplier candidates.
    const [entityRows] = await conn.query<EntityRow[]>(
      `SELECT id,legal_name,display_name,is_active,currency,tax_setup_status
         FROM legal_entities ORDER BY id FOR UPDATE`,
    );
    const activeEntities = entityRows.filter((entity) => Boolean(entity.is_active));
    const canonicalCandidates = activeEntities.filter((entity) =>
      isFalchionXeniaaSupplierName(entity.legal_name) ||
      isFalchionXeniaaSupplierName(entity.display_name)
    );
    if (canonicalCandidates.length === 0) {
      await conn.rollback();
      return conflict(
        "CANONICAL_SUPPLIER_NOT_FOUND",
        "No active legal entity clearly identifies Falchion Xeniaa. Save the genuine supplier profile first using its registered legal name (for example, Falchion Xeniaa Pvt Ltd) and real business details, then retry. Do not use MyFX POS, FX Digitech or FX Coworks as the legal-entity name. Nothing has been changed.",
      );
    }
    if (canonicalCandidates.length > 1) {
      await conn.rollback();
      return conflict(
        "CANONICAL_SUPPLIER_AMBIGUOUS",
        "More than one active legal entity matches Falchion Xeniaa. Resolve the duplicate supplier identities in Settings before retrying. No mappings or financial records have been changed.",
      );
    }
    const canonical = canonicalCandidates[0];
    if (!actor.legalEntityIds.includes(canonical.id)) {
      await conn.rollback();
      return jsonNoStore({
        error: { code: "FORBIDDEN", message: "The canonical supplier is outside the administrator's current entity scope." },
      }, 403);
    }

    const brandIds = productAssets.map((asset) => brandsByCode.get(asset.code)!.id);
    const brandPlaceholders = brandIds.map(() => "?").join(",");
    const [mappingRows] = await conn.query<MappingRow[]>(
      `SELECT brand_id,legal_entity_id,is_default,effective_from,effective_until,
              (effective_from <= NOW(3) AND (effective_until IS NULL OR effective_until > NOW(3))) AS is_current,
              (effective_from > NOW(3) AND (effective_until IS NULL OR effective_until > NOW(3))) AS is_future
         FROM brand_legal_entities
        WHERE brand_id IN (${brandPlaceholders})
        ORDER BY brand_id,legal_entity_id
        FOR UPDATE`,
      brandIds,
    );
    if (mappingRows.some((mapping) => Boolean(mapping.is_future))) {
      await conn.rollback();
      return conflict(
        "FUTURE_BRAND_MAPPING_EXISTS",
        "A future-dated product-brand mapping exists. Review it in Advanced Settings before retrying; no data has been changed.",
      );
    }

    const rowsByBrand = new Map<string, MappingRow[]>();
    for (const row of mappingRows) {
      const bucket = rowsByBrand.get(row.brand_id) ?? [];
      bucket.push(row);
      rowsByBrand.set(row.brand_id, bucket);
    }

    const changedBrands: { id: string; name: string; code: string; configVersion: number }[] = [];
    for (const asset of productAssets) {
      const brand = brandsByCode.get(asset.code)!;
      const allMappings = rowsByBrand.get(brand.id) ?? [];
      const activeMappings = allMappings.filter((mapping) => Boolean(mapping.is_current));
      const currentCanonical = activeMappings.find((mapping) => mapping.legal_entity_id === canonical.id);
      const needsChange = activeMappings.length !== 1 || !currentCanonical || !Boolean(currentCanonical.is_default);
      if (!needsChange) continue;

      const beforeMappings = allMappings.map((mapping) => ({
        legalEntityId: mapping.legal_entity_id,
        isDefault: Boolean(mapping.is_default),
        effectiveFrom: mapping.effective_from,
        effectiveUntil: mapping.effective_until,
        current: Boolean(mapping.is_current),
      }));
      await conn.execute<ResultSetHeader>(
        `UPDATE brand_legal_entities
            SET effective_until = NOW(3), is_default = FALSE
          WHERE brand_id = ? AND legal_entity_id <> ?
            AND effective_from <= NOW(3)
            AND (effective_until IS NULL OR effective_until > NOW(3))`,
        [brand.id, canonical.id],
      );

      const canonicalMapping = allMappings.find((mapping) => mapping.legal_entity_id === canonical.id);
      if (!canonicalMapping) {
        await conn.execute<ResultSetHeader>(
          `INSERT INTO brand_legal_entities
             (brand_id,legal_entity_id,is_default,effective_from,effective_until)
           VALUES (?,?,TRUE,NOW(3),NULL)`,
          [brand.id, canonical.id],
        );
      } else if (Boolean(canonicalMapping.is_current)) {
        await conn.execute<ResultSetHeader>(
          `UPDATE brand_legal_entities SET is_default = TRUE, effective_until = NULL
            WHERE brand_id = ? AND legal_entity_id = ?`,
          [brand.id, canonical.id],
        );
      } else {
        // The composite PK permits one relationship row per brand/entity pair. The audit before-image
        // and a new brand config version preserve evidence of the reactivation.
        await conn.execute<ResultSetHeader>(
          `UPDATE brand_legal_entities SET effective_from = NOW(3), effective_until = NULL, is_default = TRUE
            WHERE brand_id = ? AND legal_entity_id = ?`,
          [brand.id, canonical.id],
        );
      }

      const [versions] = await conn.execute<(RowDataPacket & { version_number: number })[]>(
        "SELECT version_number FROM brand_config_versions WHERE brand_id = ? ORDER BY version_number DESC LIMIT 1 FOR UPDATE",
        [brand.id],
      );
      const versionNumber = Number(versions[0]?.version_number ?? 0) + 1;
      const snapshot = {
        schemaVersion: 1, brandId: brand.id, name: brand.name, code: brand.code,
        description: brand.description, logoReference: brand.logo_reference,
        theme: jsonValue(brand.theme_json), defaultTemplateKey: brand.default_template_key,
        isActive: Boolean(brand.is_active), legalEntityIds: [canonical.id],
      };
      await conn.execute<ResultSetHeader>(
        `INSERT INTO brand_config_versions
           (id,brand_id,version_number,effective_from,config_snapshot,change_reason,changed_by)
         VALUES (?,?,?,NOW(3),?,?,?)`,
        [randomUUID(), brand.id, versionNumber, canonicalJson(snapshot), RECONCILIATION_REASON, actor.userId],
      );
      await recordAudit(
        conn, actor.userId, "brand.product_entity_reconciled", "brand", brand.id, RECONCILIATION_REASON,
        { mappings: beforeMappings },
        { mappings: [{ legalEntityId: canonical.id, isDefault: true }], configVersion: versionNumber },
      );
      changedBrands.push({ id: brand.id, name: brand.name, code: brand.code, configVersion: versionNumber });
    }

    const [existingAccess] = await conn.execute<(RowDataPacket & { user_id: string })[]>(
      "SELECT user_id FROM user_legal_entity_access WHERE user_id = ? AND legal_entity_id = ? FOR UPDATE",
      [actor.userId, canonical.id],
    );
    if (!existingAccess.length) {
      await conn.execute<ResultSetHeader>(
        "INSERT INTO user_legal_entity_access (user_id,legal_entity_id,granted_by) VALUES (?,?,?)",
        [actor.userId, canonical.id, actor.userId],
      );
      await recordAudit(conn, actor.userId, "legal_entity.reconciliation_scope_granted", "legal_entity", canonical.id,
        RECONCILIATION_REASON, null, { userId: actor.userId, legalEntityId: canonical.id });
    }

    // Preserve old brand-named legal entities. Never delete, merge, rename, deactivate, or reassign invoices automatically.
    const preservedLegacyEntities = entityRows
      .filter((entity) => entity.id !== canonical.id &&
        (isProductBrandLegalEntityName(entity.legal_name) || isProductBrandLegalEntityName(entity.display_name)))
      .map((entity) => ({
        id: entity.id, legalName: entity.legal_name, displayName: entity.display_name,
        isActive: Boolean(entity.is_active), action: "preserved_for_history_review",
      }));

    await conn.commit();
    return jsonNoStore({
      data: {
        canonicalSupplier: {
          id: canonical.id, legalName: canonical.legal_name, displayName: canonical.display_name,
          currency: canonical.currency, taxSetupStatus: canonical.tax_setup_status,
        },
        brands: productAssets.map((asset) => ({
          id: brandsByCode.get(asset.code)!.id, name: asset.name, code: asset.code,
          legalEntityId: canonical.id, legalEntityName: canonical.display_name,
        })),
        changedBrands,
        idempotent: changedBrands.length === 0 && existingAccess.length > 0,
        preservedLegacyEntities,
        message: preservedLegacyEntities.length
          ? "All three product brands now use the Falchion Xeniaa supplier. Brand-named legal-entity records were preserved, not merged or deleted; review them separately before deactivation."
          : "All three product brands now use the Falchion Xeniaa supplier.",
      },
    });
  } catch (error) {
    if (conn) { try { await conn.rollback(); } catch { /* preserve original failure */ } }
    return apiError(error);
  } finally {
    conn?.release();
  }
}
