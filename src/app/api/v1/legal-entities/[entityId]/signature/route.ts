import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermissionForEntity } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { jsonNoStore, apiError } from "@/lib/http/api-response";
import { captureLegalEntityConfigVersion, loadEntity, recordAudit } from "@/lib/configuration/service";
import { putPrivateAsset } from "@/lib/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ entityId: string }> }) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    await assertCsrf(request);
    const { entityId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(entityId)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "entityId must be a UUID." } }, 400);
    }
    const actor = await requirePermissionForEntity("settings:manage", entityId);
    const form = await request.formData();
    const upload = form.get("signature");
    if (!(upload instanceof File)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Choose a signature image file first." } }, 400);
    }
    if (upload.size <= 0 || upload.size > MAX_UPLOAD_BYTES) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Signature images must be 6 MB or smaller." } }, 413);
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(upload.type.toLowerCase())) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Upload a PNG, JPEG, or WebP signature image." } }, 415);
    }

    const raw = Buffer.from(await upload.arrayBuffer());
    const sharp = await import("sharp");
    let normalized: Buffer;
    try {
      const pipeline = sharp.default(raw, { failOn: "error", limitInputPixels: 8_000_000 });
      const metadata = await pipeline.metadata();
      if (!metadata.width || !metadata.height || metadata.width > 4000 || metadata.height > 2000 ||
          (metadata.pages ?? 1) !== 1 || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) {
        return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Use a single-frame signature image no larger than 4000 × 2000 pixels." } }, 422);
      }
      normalized = await sharp.default(raw, { failOn: "error", limitInputPixels: 8_000_000 })
        .rotate()
        .resize({ width: 1800, height: 900, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "The selected file is not a valid supported signature image." } }, 422);
    }
    if (normalized.length <= 0 || normalized.length > 2 * 1024 * 1024) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "The normalized signature must be 2 MB or smaller." } }, 413);
    }

    const digest = createHash("sha256").update(normalized).digest("hex");
    const reference = "signatures/" + entityId + "/" + randomUUID() + ".png";
    await putPrivateAsset(reference, normalized, digest);

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [current] = await conn.execute<(RowDataPacket & { signature_reference: string | null; is_active: number })[]>(
      "SELECT signature_reference,is_active FROM legal_entities WHERE id=? LIMIT 1 FOR UPDATE", [entityId],
    );
    if (!current.length || !current[0].is_active) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Active legal entity not found in your assigned scope." } }, 404);
    }
    const previous = current[0].signature_reference;
    await conn.execute("UPDATE legal_entities SET signature_reference=? WHERE id=?", [reference, entityId]);
    const entity = await loadEntity(conn, entityId);
    if (!entity) throw new Error("The legal entity could not be reloaded after saving the signature.");
    const version = await captureLegalEntityConfigVersion(conn, entity, actor.userId, "Invoice signature uploaded");
    await recordAudit(conn, actor.userId, "legal_entity.signature_uploaded", "legal_entity", entityId,
      "Invoice signature uploaded",
      { signatureConfigured: Boolean(previous) },
      { signatureConfigured: true, configVersion: version.versionNumber, assetSha256: digest });
    await conn.commit();
    return jsonNoStore({ data: { legalEntityId: entityId, signatureConfigured: true, configVersion: version.versionNumber } }, 201);
  } catch (error) {
    if (conn) await conn.rollback().catch(() => undefined);
    return apiError(error);
  } finally {
    conn?.release();
  }
}
