import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { catalogItemCreateSchema } from "@/lib/validation/master-data";

function duplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requirePermission("catalog:read");
    const query = (request.nextUrl.searchParams.get("query") ?? "").trim().slice(0, 100);
    const status = request.nextUrl.searchParams.get("status") ?? "active";
    if (!["active", "archived", "all"].includes(status)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "status must be active, archived, or all" } }, 400);
    }
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "limit must be 1–100 and offset must be between 0 and 1000000" } }, 400);
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status !== "all") {
      clauses.push("is_active = ?");
      params.push(status === "active" ? 1 : 0);
    }
    if (query) {
      clauses.push("(name LIKE ? OR item_code LIKE ?)");
      const escaped = query.replace(/[\\%_]/g, "\\$&");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.query<(RowDataPacket & {
      id: string; item_code: string | null; item_type: string; name: string;
      customer_description: string; unit_code: string; default_unit_price: string;
      currency: string; default_tax_code: string | null; is_active: number; record_version: number; archived_at: Date | null;
      created_at: Date; updated_at: Date;
    })[]>(
      `SELECT id, item_code, item_type, name, customer_description, unit_code,
              default_unit_price, currency, default_tax_code, is_active, record_version, archived_at, created_at, updated_at
       FROM catalog_items ${where} ORDER BY name ASC, id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [[countRow]] = await pool.query<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM catalog_items ${where}`, params,
    );
    return jsonNoStore({
      data: rows.map((row) => ({
        id: row.id,
        itemCode: row.item_code,
        itemType: row.item_type,
        name: row.name,
        customerDescription: row.customer_description,
        unitCode: row.unit_code,
        defaultUnitPrice: row.default_unit_price,
        currency: row.currency,
        defaultTaxCode: row.default_tax_code,
        isActive: Boolean(row.is_active),
        recordVersion: Number(row.record_version),
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: { limit, offset, total: Number(countRow.total), hasMore: offset + rows.length < Number(countRow.total) },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertCsrf(request);
    const actor = await requirePermission("catalog:create");
    const parsed = catalogItemCreateSchema.parse(await request.json());
    const id = randomUUID();
    const itemCode = parsed.itemCode?.trim() || null;
    if (itemCode) {
      const [sameCode] = await pool.execute<(RowDataPacket & { id: string })[]>("SELECT id FROM catalog_items WHERE item_code=? LIMIT 1", [itemCode]);
      if (sameCode.length) return jsonNoStore({ error: { code: "DUPLICATE_RECORD", message: "This item/service code is already in use." } }, 409);
    }
    const [similarRows] = await pool.execute<(RowDataPacket & { id: string; name: string; item_code: string | null; item_type: string })[]>(
      "SELECT id,name,item_code,item_type FROM catalog_items WHERE LOWER(name)=LOWER(?) AND item_type=? ORDER BY name,id LIMIT 8", [parsed.name, parsed.itemType]);
    const duplicateWarnings = similarRows.map(row => ({ id: row.id, name: row.name, itemCode: row.item_code, itemType: row.item_type, matchOn: ["name", "itemType"] }));
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.execute<ResultSetHeader>(
        `INSERT INTO catalog_items
          (id, item_code, item_type, name, customer_description, internal_description,
           unit_code, default_unit_price, currency, default_tax_code, is_active, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
        [
          id, itemCode, parsed.itemType, parsed.name,
          parsed.customerDescription, parsed.internalDescription ?? null,
          parsed.unitCode, parsed.defaultUnitPrice, parsed.currency,
          parsed.defaultTaxCode ?? null, actor.userId, actor.userId,
        ],
      );
      await connection.execute(
        `INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, outcome, after_json)
         VALUES (?, ?, 'catalog_item.created', 'catalog_item', ?, 'SUCCESS', ?)`,
        [randomUUID(), actor.userId, id, JSON.stringify({
          itemCode: parsed.itemCode || null,
          itemType: parsed.itemType,
          name: parsed.name,
          currency: parsed.currency,
          defaultUnitPrice: parsed.defaultUnitPrice,
        })],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (duplicateEntry(error)) return jsonNoStore({ error: { code: "DUPLICATE_RECORD", message: "This item/service code is already in use." } }, 409);
      throw error;
    } finally {
      connection.release();
    }

    return jsonNoStore({
      data: {
        id,
        itemCode,
        itemType: parsed.itemType,
        name: parsed.name,
        customerDescription: parsed.customerDescription,
        internalDescription: parsed.internalDescription ?? null,
        unitCode: parsed.unitCode,
        defaultUnitPrice: parsed.defaultUnitPrice,
        currency: parsed.currency,
        defaultTaxCode: parsed.defaultTaxCode ?? null,
        isActive: true,
        recordVersion: 1,
      },
      duplicateWarnings,
    }, 201);
  } catch (error) {
    return apiError(error);
  }
}
