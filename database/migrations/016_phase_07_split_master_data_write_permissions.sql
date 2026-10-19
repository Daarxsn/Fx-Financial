-- Phase 07: split the coarse customers:write / catalog:write permissions into create and update.
-- Every role that held the old :write permission receives both replacements, so no existing
-- access is lost and no role gains anything it could not already do. :read and :archive are unchanged.
-- The old :write keys are removed afterwards: no route checks them any more, and leaving them
-- grantable would let an administrator assign a permission that silently does nothing.
-- On a fresh database (before the reference seed) the role grants below match no rows and the
-- seed applies the split templates itself.

INSERT INTO app_permissions (id, permission_key, description)
SELECT UUID(), new_permissions.permission_key, new_permissions.description
  FROM (
    SELECT 'customers:create' AS permission_key, 'Create customer records' AS description
    UNION ALL SELECT 'customers:update', 'Update customer records'
    UNION ALL SELECT 'catalog:create', 'Create catalog items'
    UNION ALL SELECT 'catalog:update', 'Update catalog items'
  ) AS new_permissions
 WHERE NOT EXISTS (
   SELECT 1 FROM app_permissions existing WHERE existing.permission_key = new_permissions.permission_key
 );

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, replacement.id
  FROM role_permissions rp
  JOIN app_permissions old_permission ON old_permission.id = rp.permission_id
  JOIN app_permissions replacement
    ON (old_permission.permission_key = 'customers:write' AND replacement.permission_key IN ('customers:create', 'customers:update'))
    OR (old_permission.permission_key = 'catalog:write' AND replacement.permission_key IN ('catalog:create', 'catalog:update'));

DELETE rp FROM role_permissions rp
  JOIN app_permissions old_permission ON old_permission.id = rp.permission_id
 WHERE old_permission.permission_key IN ('customers:write', 'catalog:write');

DELETE FROM app_permissions WHERE permission_key IN ('customers:write', 'catalog:write');
