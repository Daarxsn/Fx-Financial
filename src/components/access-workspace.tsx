"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, InlineAlert, LoadingState, StatusBadge } from "@/components/ui";

type Entity = { id: string; displayName: string; currency: string; isActive: boolean };
type User = {
  id: string; email: string; displayName: string; accountStatus: string;
  roleKeys: string[]; legalEntityCount: number; createdAt: string; lastLoginAt: string | null;
};
type ApiResult<T> = { data?: T; error?: { message?: string; code?: string }; pagination?: { hasMore?: boolean } };
type RoleOption = { value: string; label: string; description: string };
const ROLE_OPTIONS: RoleOption[] = [
  { value: "finance_admin", label: "Finance Administrator", description: "Full finance workflows, invoice/quotation management, payments and configuration." },
  { value: "invoice_creator", label: "Invoice & Quotation Creator", description: "Create/edit invoice and quotation drafts; cannot issue invoices." },
  { value: "invoice_issuer", label: "Invoice Issuer", description: "View invoices and quotations and issue invoices; cannot create drafts." },
  { value: "payment_recorder", label: "Payment Recorder", description: "View invoices and record payments." },
  { value: "approver", label: "Approver", description: "Review invoice/quotation approval work where approval workflows are enabled." },
  { value: "auditor", label: "Auditor / Read-only", description: "Read approved records and audit information without writing finance data." },
  { value: "system_admin", label: "System Administrator", description: "Manage users and configuration; this role does not itself grant finance-document access." },
];

async function readJson<T>(path: string, init: RequestInit = {}): Promise<{ response: Response; body: ApiResult<T> }> {
  const response = await fetch(path, {
    ...init, cache: "no-store", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as ApiResult<T>;
  return { response, body };
}

export function AccessWorkspace() {
  const [users, setUsers] = useState<User[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleKey, setRoleKey] = useState("invoice_creator");
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [activationLink, setActivationLink] = useState("");
  const [copied, setCopied] = useState(false);
  const canManageUsers = permissions.includes("users:manage");
  const canManageSettings = permissions.includes("settings:manage");
  const roleOptions = useMemo(() => ROLE_OPTIONS.filter(role => role.value !== "system_admin" || roles.includes("system_admin")), [roles]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const profile = await readJson<{ user?: { permissions?: string[]; roles?: string[] } }>("/api/v1/auth/me");
      if (!profile.response.ok) throw new Error(profile.body.error?.message ?? "Your current account could not be verified.");
      const profilePermissions = profile.body.data?.user?.permissions ?? [];
      const profileRoles = profile.body.data?.user?.roles ?? [];
      setPermissions(profilePermissions);
      setRoles(profileRoles);
      if (!profilePermissions.includes("users:manage")) {
        setUsers([]);
        setEntities([]);
        return;
      }
      const usersResult = await readJson<User[]>("/api/v1/users?limit=100&offset=0");
      if (!usersResult.response.ok) throw new Error(usersResult.body.error?.message ?? "User directory could not be loaded.");
      setUsers(usersResult.body.data ?? []);
      if (profilePermissions.includes("settings:manage")) {
        const entityResult = await readJson<Entity[]>("/api/v1/legal-entities?status=active&limit=100&offset=0");
        if (!entityResult.response.ok) throw new Error(entityResult.body.error?.message ?? "Legal-entity scope options could not be loaded.");
        setEntities(entityResult.body.data ?? []);
      } else {
        setEntities([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access information could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function getCsrfToken() {
    const cookieToken = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("fx_csrf="))?.slice("fx_csrf=".length);
    if (cookieToken) return cookieToken;
    const result = await readJson<{ csrfToken?: string }>("/api/v1/auth/csrf");
    if (!result.response.ok || !result.body.data?.csrfToken) throw new Error("Request verification failed. Refresh the page and retry.");
    return result.body.data.csrfToken;
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setActivationLink("");
    setCopied(false);
    if (!canManageUsers) {
      setError("Your account cannot manage user access.");
      return;
    }
    if (!canManageSettings) {
      setError("Your account can manage users but cannot view legal-entity scopes. A system administrator must configure access.");
      return;
    }
    if (roleKey !== "system_admin" && !entityIds.length) {
      setError("Select at least one active legal entity for this role. Without a scope, the user cannot access finance records.");
      return;
    }
    setSaving(true);
    try {
      const csrfToken = await getCsrfToken();
      const result = await readJson<{ userId: string; email: string; displayName: string; roleKeys: string[]; legalEntityIds: string[]; activationToken: string; expiresInHours: number; delivery: string }>(
        "/api/v1/users/invitations",
        {
          method: "POST",
          headers: { "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ email: email.trim(), displayName: displayName.trim(), roleKeys: [roleKey], legalEntityIds: entityIds }),
        },
      );
      if (!result.response.ok || !result.body.data?.activationToken) throw new Error(result.body.error?.message ?? "Invitation could not be created.");
      const token = result.body.data.activationToken;
      setActivationLink(window.location.origin + "/activate?token=" + encodeURIComponent(token));
      setNotice("Invitation created. The activation link is shown once below and expires in " + result.body.data.expiresInHours + " hours.");
      setEmail("");
      setDisplayName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invitation could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function copyActivationLink() {
    try {
      await navigator.clipboard.writeText(activationLink);
      setCopied(true);
    } catch {
      setError("Clipboard access was blocked. Select and copy the activation link from the field below.");
    }
  }

  function toggleEntity(id: string, checked: boolean) {
    setEntityIds(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id));
  }

  const selectedRole = ROLE_OPTIONS.find(role => role.value === roleKey);
  const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : "Never";

  if (loading) return <LoadingState label="Loading user access and legal-entity scope…" />;

  if (!canManageUsers) {
    return <InlineAlert tone="warning" title="User access administration is restricted">
      This page requires the <code>users:manage</code> permission. A system administrator must manage roles and legal-entity access.
    </InlineAlert>;
  }

  return <div className="access-workspace">
    <div className="section-overview-banner">
      <div className="section-overview-banner__icon" aria-hidden="true">FX</div>
      <div className="section-overview-banner__copy">
        <strong>Permission-first onboarding</strong>
        <p>Invite a separate account with the minimum finance role and only the legal entities it needs. System administration does not automatically grant access to finance documents.</p>
      </div>
      <StatusBadge tone="info">RBAC enforced</StatusBadge>
    </div>

    {error ? <InlineAlert tone="danger" title="Access action needs attention">{error}</InlineAlert> : null}
    {notice ? <InlineAlert tone="success" title="Invitation created">{notice}</InlineAlert> : null}

    {!canManageSettings ? <InlineAlert tone="warning" title="Legal-entity scope administration is unavailable">
      This account can manage users but cannot inspect legal entities. A system administrator with <code>settings:manage</code> must configure scopes before finance users can be invited.
    </InlineAlert> : null}
    {canManageSettings && !entities.length ? <InlineAlert tone="warning" title="Create or assign a legal entity first">
      No active legal entity is available within this administrator’s current scope. Open <Link href="/settings">Company Settings</Link> to create or configure an entity. The creator is automatically assigned scope to the new entity; return here to invite the finance user.
    </InlineAlert> : null}

    <section className="master-data-panel" aria-labelledby="access-invite-title">
      <div className="master-data-panel__heading">
        <div><p className="page-eyebrow">TEAM ONBOARDING</p><h2 id="access-invite-title">Invite a user</h2><p>Invitations use a single-use, 24-hour activation link. No email provider is configured, so deliver the link through an approved secure channel.</p></div>
      </div>
      <form onSubmit={invite}>
        <div className="master-data-form-grid">
          <div className="form-field"><label className="form-label" htmlFor="access-display-name">Full name</label><input className="form-control" id="access-display-name" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={160} autoComplete="name" required /></div>
          <div className="form-field"><label className="form-label" htmlFor="access-email">Work email</label><input className="form-control" id="access-email" type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={320} autoComplete="email" required /></div>
          <div className="form-field form-field--wide"><label className="form-label" htmlFor="access-role">Role</label><select className="form-control" id="access-role" value={roleKey} onChange={event => setRoleKey(event.target.value)}>{roleOptions.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select>
            {selectedRole ? <p className="form-hint">{selectedRole.description}</p> : null}
            {roleKey === "system_admin" ? <p className="form-hint">System Administrator is intentionally not a finance superuser. Choose Finance Administrator or Invoice & Quotation Creator to work with documents.</p> : null}
          </div>
          <fieldset className="master-data-fieldset">
            <legend>Legal-entity scope</legend>
            {entities.length ? <div className="master-data-form-grid">{entities.map(entity => <label className="form-field" key={entity.id} style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="checkbox" checked={entityIds.includes(entity.id)} onChange={event => toggleEntity(entity.id, event.target.checked)} />
              <span>{entity.displayName} · {entity.currency}</span>
            </label>)}</div> : <p className="form-hint">No active legal entities are available in this administrator’s scope.</p>}
            <p className="form-hint">Grant only entities this person needs. Document lists and detail APIs are scoped server-side. A user without a scope cannot read or create scoped finance documents.</p>
          </fieldset>
        </div>
        <div className="master-data-form-actions"><Button type="submit" disabled={saving || !canManageSettings || (!entities.length && roleKey !== "system_admin")}>{saving ? "Creating invitation…" : "Create invitation"}</Button></div>
      </form>
    </section>

    {activationLink ? <section className="master-data-panel" aria-labelledby="activation-link-title">
      <div className="master-data-panel__heading"><div><p className="page-eyebrow">ONE-TIME ACTIVATION</p><h2 id="activation-link-title">Copy the activation link</h2><p>This is a bearer link. Anyone who receives it may activate the invited account, so send it only to the intended person.</p></div></div>
      <div className="form-field"><label className="form-label" htmlFor="activation-link">Activation link</label><input id="activation-link" className="form-control" readOnly value={activationLink} onFocus={event => event.currentTarget.select()} /></div>
      <div className="master-data-form-actions"><Button onClick={() => void copyActivationLink()}>{copied ? "Copied" : "Copy activation link"}</Button><Button variant="secondary" onClick={() => { setActivationLink(""); setCopied(false); }}>Hide link</Button></div>
    </section> : null}

    <section className="master-data-panel" aria-labelledby="access-user-list-title">
      <div className="master-data-panel__heading"><div><p className="page-eyebrow">CURRENT ACCOUNTS</p><h2 id="access-user-list-title">Team access</h2><p>Role changes and access changes revoke existing sessions so new privileges cannot be used by a stale session.</p></div><Button variant="secondary" onClick={() => void load()}>Refresh</Button></div>
      <div className="data-table-scroll"><table className="data-table"><thead><tr><th>User</th><th>Status</th><th>Role</th><th>Legal entities</th><th>Last login</th></tr></thead><tbody>
        {users.map(user => <tr key={user.id}><td><strong>{user.displayName}</strong><div className="invoice-workspace-muted">{user.email}</div></td><td><StatusBadge tone={user.accountStatus === "ACTIVE" ? "success" : user.accountStatus === "INVITED" ? "warning" : "danger"}>{user.accountStatus}</StatusBadge></td><td>{user.roleKeys.map(role => role.replaceAll("_", " ")).join(", ") || "No role"}</td><td>{user.legalEntityCount}</td><td>{formatDate(user.lastLoginAt)}</td></tr>)}
        {!users.length ? <tr><td colSpan={5}><p className="form-hint">No users were returned for the current page.</p></td></tr> : null}
      </tbody></table></div>
    </section>
  </div>;
}
