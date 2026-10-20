import "server-only";
import { AuthorizationError } from "@/lib/auth/authorize";
import type { SessionPrincipal } from "@/lib/auth/session";

/** Financial configuration requires finance_admin or the explicitly elevated Super Administrator.
 * Ordinary settings access still does not approve tax registrations/rates or activate number series.
 */
export function requireFinanceConfigurationApprover(actor: SessionPrincipal): SessionPrincipal {
  if (!actor.roles.includes("finance_admin") && !actor.roles.includes("system_admin")) {
    throw new AuthorizationError("FORBIDDEN");
  }
  return actor;
}
