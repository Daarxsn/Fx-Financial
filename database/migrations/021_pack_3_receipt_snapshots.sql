-- Pack 3: preserve receipt party and issuing-entity identity at record time.
-- Existing records are backfilled from current master data as best-effort only; new receipt writes
-- must set both snapshots within the payment transaction.
ALTER TABLE payments
  ADD COLUMN customer_snapshot JSON NULL AFTER customer_id,
  ADD COLUMN legal_entity_snapshot JSON NULL AFTER customer_snapshot;

UPDATE payments p
JOIN customers c ON c.id = p.customer_id
   SET p.customer_snapshot = JSON_OBJECT(
     'customerId', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone,
     'billingAddress', c.billing_address_json, 'taxIdentifier', c.tax_identifier
   )
 WHERE p.customer_snapshot IS NULL;

UPDATE payments p
JOIN legal_entities le ON le.id = p.legal_entity_id
   SET p.legal_entity_snapshot = JSON_OBJECT(
     'legalName', le.legal_name, 'displayName', le.display_name, 'address', le.address_json,
     'countryCode', le.country_code, 'currency', le.currency, 'timeZone', le.time_zone,
     'invoiceEmail', le.invoice_email, 'invoicePhone', le.invoice_phone
   )
 WHERE p.legal_entity_id IS NOT NULL AND p.legal_entity_snapshot IS NULL;
