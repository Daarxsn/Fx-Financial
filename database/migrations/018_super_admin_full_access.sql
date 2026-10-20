-- Migration 018: elevate the existing system_admin role into the explicit Super Administrator role.
-- Existing databases may already have reference rows and role mappings, so grant every currently
-- registered permission idempotently. Fresh databases seed the same template after migrations.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM app_roles r
 CROSS JOIN app_permissions p
 WHERE r.role_key = 'system_admin';

UPDATE app_roles
   SET display_name = 'Super Administrator',
       description = 'Highest-trust role with every registered application and finance permission. Assign only to the CEO or a specifically approved test administrator.'
 WHERE role_key = 'system_admin';
