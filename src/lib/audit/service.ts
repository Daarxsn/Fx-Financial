import "server-only";

import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { parseReportFilters, scopedEntityIds, type ReportFilters } from "@/lib/reports/service";

const RESOURCE_TYPES = new Set([
  "invoice", "quotation", "payment", "customer", "catalog_item", "legal_entity", "brand",
  "tax_rule", "invoice_numbering_config", "invoice_document_template", "business_policy_decision",
  "invoice_correction_request", "report_export", "generated_document", "email_outbox", "reminder_policy",
]);

export type AuditFilters = Pick<ReportFilters, "from" | "to" | "limit" | "offset" | "query" | "legalEntityId"> & {
  resourceType?: string;
};
export type AuditFilterParse = { filters?: AuditFilters; error?: string };

export function parseAuditFilters(params: URLSearchParams): AuditFilterParse {
  const parsed = parseReportFilters(params);
  if (!parsed.filters) return { error: parsed.error ?? "Invalid audit filters." };
  const resourceType = params.get("resourceType")?.trim().toLowerCase() || undefined;
  if (resourceType && !RESOURCE_TYPES.has(resourceType)) return { error: "Unsupported audit resource type." };
  return { filters: { ...parsed.filters, resourceType } };
}

function likePattern(query: string): string {
  return "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
}

type AuditRow = RowDataPacket & {
  id: string;
  record_source: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: string;
  actor_name: string | null;
  reason: string | null;
  created_at: Date | string;
};

const scopedResourceSql = [
  "SELECT 'invoice' AS entity_type,id AS entity_id FROM invoices WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'quotation',id FROM quotations WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'payment',id FROM payments WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'legal_entity',id FROM allowed_entities",
  "SELECT 'brand',b.id FROM brands b JOIN brand_legal_entities ble ON ble.brand_id=b.id WHERE ble.legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'tax_rule',id FROM tax_rules WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'invoice_numbering_config',id FROM invoice_numbering_configs WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'invoice_document_template',id FROM invoice_document_templates WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'business_policy_decision',id FROM business_policy_decisions WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'invoice_correction_request',id FROM invoice_correction_requests WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'report_export',id FROM allowed_entities",
  "SELECT 'generated_document',id FROM generated_documents WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'email_outbox',id FROM email_outbox WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'reminder_policy',id FROM overdue_reminder_policies WHERE legal_entity_id IN (SELECT id FROM allowed_entities)",
  "SELECT 'customer',c.id FROM customers c WHERE EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id=c.id AND i.legal_entity_id IN (SELECT id FROM allowed_entities)) OR EXISTS (SELECT 1 FROM quotations q WHERE q.customer_id=c.id AND q.legal_entity_id IN (SELECT id FROM allowed_entities))",
  "SELECT 'catalog_item',ci.id FROM catalog_items ci WHERE EXISTS (SELECT 1 FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id WHERE il.catalog_item_id=ci.id AND i.legal_entity_id IN (SELECT id FROM allowed_entities)) OR EXISTS (SELECT 1 FROM quotation_lines ql JOIN quotations q ON q.id=ql.quotation_id WHERE ql.catalog_item_id=ci.id AND q.legal_entity_id IN (SELECT id FROM allowed_entities))",
].join(" UNION ");

const auditEventSql = [
  "SELECT ae.id,'audit_events' AS record_source,ae.action,ae.entity_type AS resource_type,ae.entity_id AS resource_id,ae.outcome,ae.actor_id,ae.change_reason AS reason,ae.created_at FROM audit_events ae JOIN scoped_audit_resources sr ON sr.entity_type=ae.entity_type AND sr.entity_id=ae.entity_id",
  "SELECT gde.id,'document_events',CONCAT('document.',gde.event_type),'generated_document',gd.id,CASE WHEN gde.event_type IN ('FAILED','INTEGRITY_FAILURE') THEN 'FAILURE' ELSE 'SUCCESS' END,gde.actor_id,gde.reason,gde.created_at FROM generated_document_events gde JOIN generated_documents gd ON gd.id=gde.generated_document_id JOIN scoped_audit_resources sr ON sr.entity_type='generated_document' AND sr.entity_id=gd.id",
  "SELECT eoe.id,'email_events',CONCAT('email.',eoe.event_type),'email_outbox',eo.id,CASE WHEN eoe.new_status IN ('BOUNCED','COMPLAINED','FAILED','REQUIRES_REVIEW') THEN 'FAILURE' ELSE 'SUCCESS' END,eoe.actor_id,eoe.reason_code,eoe.created_at FROM email_outbox_events eoe JOIN email_outbox eo ON eo.id=eoe.email_outbox_id JOIN scoped_audit_resources sr ON sr.entity_type='email_outbox' AND sr.entity_id=eo.id",
  "SELECT rpe.id,'reminder_policy_events',CONCAT('reminder_policy.',rpe.event_type),'reminder_policy',rp.id,CASE WHEN rpe.event_type LIKE '%FAILED%' THEN 'FAILURE' ELSE 'SUCCESS' END,rpe.actor_id,rpe.reason,rpe.created_at FROM reminder_policy_events rpe JOIN overdue_reminder_policies rp ON rp.id=rpe.reminder_policy_id JOIN scoped_audit_resources sr ON sr.entity_type='reminder_policy' AND sr.entity_id=rp.id",
  "SELECT bde.id,'business_policy_decision_events',CONCAT('policy_decision.',bde.new_status),'business_policy_decision',bpd.id,CASE WHEN bde.new_status='BLOCKED' THEN 'FAILURE' ELSE 'SUCCESS' END,bde.recorded_by,LEFT(bde.rationale,500),bde.created_at FROM business_policy_decision_events bde JOIN business_policy_decisions bpd ON bpd.id=bde.policy_decision_id JOIN scoped_audit_resources sr ON sr.entity_type='business_policy_decision' AND sr.entity_id=bpd.id",
  "SELECT ice.id,'invoice_correction_request_events',CONCAT('invoice_correction.',ice.event_type),'invoice_correction_request',icr.id,CASE WHEN ice.event_type='REJECTED' THEN 'FAILURE' ELSE 'SUCCESS' END,ice.actor_id,LEFT(ice.reason,500),ice.created_at FROM invoice_correction_request_events ice JOIN invoice_correction_requests icr ON icr.id=ice.request_id JOIN scoped_audit_resources sr ON sr.entity_type='invoice_correction_request' AND sr.entity_id=icr.id",
  "SELECT pre.id,'payment_reversal_events','payment.reversed','payment',p.id,'SUCCESS',pre.reversed_by,LEFT(pre.reason,500),pre.reversed_at FROM payment_reversal_events pre JOIN payments p ON p.id=pre.payment_id JOIN scoped_audit_resources sr ON sr.entity_type='payment' AND sr.entity_id=p.id",
].join(" UNION ALL ");

function makeCte(scope: string[], filters: AuditFilters) {
  const marks = scope.map(() => "?").join(",");
  const params: unknown[] = [...scope, filters.from, filters.to];
  const where = ["ev.created_at >= ?", "ev.created_at < DATE_ADD(?, INTERVAL 1 DAY)"];
  if (filters.resourceType) {
    where.push("ev.resource_type=?");
    params.push(filters.resourceType);
  }
  if (filters.query) {
    const pattern = likePattern(filters.query);
    where.push("(ev.action LIKE ? OR ev.resource_type LIKE ? OR ev.resource_id LIKE ? OR COALESCE(actor.display_name,'') LIKE ?)");
    params.push(pattern, pattern, pattern, pattern);
  }
  const sql =
    "WITH allowed_entities AS (SELECT id FROM legal_entities WHERE id IN (" + marks + ")), " +
    "scoped_audit_resources AS (" + scopedResourceSql + "), " +
    "all_events AS (" + auditEventSql + "), " +
    "filtered_events AS (" +
      "SELECT ev.id,ev.record_source,ev.action,ev.resource_type,ev.resource_id,ev.outcome," +
      "actor.display_name AS actor_name,LEFT(ev.reason,500) AS reason,ev.created_at " +
      "FROM all_events ev LEFT JOIN app_users actor ON actor.id=ev.actor_id WHERE " + where.join(" AND ") +
    ") ";
  return { sql, params };
}

export async function getAuditEvents(scope: string[], filters: AuditFilters) {
  const narrowed = scopedEntityIds(scope, filters.legalEntityId);
  if (narrowed.forbidden || !narrowed.ids.length) {
    return { data: [], pagination: { limit: filters.limit, offset: filters.offset, total: 0, hasMore: false } };
  }
  const { sql, params } = makeCte(narrowed.ids, filters);
  const dataSql = sql +
    "SELECT id,record_source,action,resource_type,resource_id,outcome,actor_name,reason,created_at " +
    "FROM filtered_events ORDER BY created_at DESC,id DESC,record_source ASC LIMIT ? OFFSET ?";
  const countSql = sql + "SELECT COUNT(*) AS total FROM filtered_events";
  const [[rows], [countRows]] = await Promise.all([
    pool.query<AuditRow[]>(dataSql, [...params, filters.limit, filters.offset]),
    pool.query<(RowDataPacket & { total: string | number })[]>(countSql, params),
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  return {
    data: rows.map(row => ({
      id: row.id,
      source: row.record_source,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      actorDisplayName: row.actor_name,
      reason: row.reason,
      createdAt: row.created_at,
    })),
    pagination: { limit: filters.limit, offset: filters.offset, total, hasMore: filters.offset + rows.length < total },
  };
}
