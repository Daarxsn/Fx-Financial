"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import { IconButton, LoadingState } from "@/components/ui";

type NavItem = { label: string; href: string; icon: IconName; badge?: string; permission?: string };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { label: "Workspace", items: [{ label: "Overview", href: "/", icon: "overview" }] },
  { label: "Manage", items: [
    { label: "Invoices", href: "/invoices", icon: "invoice" },
    { label: "Quotations", href: "/quotations", icon: "quote" },
    { label: "Customers", href: "/customers", icon: "users" },
    { label: "Items & services", href: "/catalog", icon: "box" },
  ] },
  { label: "Track", items: [
    { label: "Payments", href: "/payments", icon: "wallet" },
    { label: "Reports", href: "/reports", icon: "chart" },
    { label: "Audit trail", href: "/audit", icon: "shield" },
  ] },
  { label: "Configure", items: [{ label: "Settings", href: "/settings", icon: "settings", permission: "settings:manage" }, { label: "Users & access", href: "/access", icon: "users", permission: "users:manage" }] },
];

const navByPath = new Map(navGroups.flatMap((group) => group.items).map((item) => [item.href, item]));
const descriptions: Record<string, string> = {
  "/": "A calm, clear starting point for your finance operations.",
  "/invoices": "Create, issue and follow invoice records from one place.",
  "/quotations": "Prepare proposals and keep their status separate from invoices.",
  "/customers": "Keep customer details organized and ready for future documents.",
  "/catalog": "Manage reusable products, services, units and price defaults.",
  "/payments": "Record receipts and keep allocations distinct from invoice totals.",
  "/reports": "Review financial reporting when verified data sources are connected.",
  "/audit": "A traceable view of changes and important business actions.",
  "/settings": "Configure the company, brands, tax and document numbering.",
  "/access": "Invite users and assign finance roles and legal-entity access.",
};


export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; displayName: string; roles: string[]; permissions: string[] } | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authPath, setAuthPath] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const mobileWasOpen = useRef(false);
  const selected = navByPath.get(pathname) ?? navGroups.flatMap((group) => group.items).find((item) => item.href !== "/" && pathname.startsWith(item.href));
  const sectionTitle = pathname === "/" ? "Overview" : selected?.label ?? "Workspace";
  const pageDescription = descriptions[pathname] ?? "Your finance workspace, organized and ready to grow.";

  useEffect(() => {
    if (pathname === "/login" || pathname === "/activate") return;
    let active = true;
    fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (!active) return;
        setCurrentUser(body?.data?.user ?? null);
        setAuthPath(pathname);
        setAuthLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setCurrentUser(null);
        setAuthPath(pathname);
        setAuthLoaded(true);
      });
    return () => { active = false; };
  }, [pathname]);

  const authCheckedForPath = authLoaded && authPath === pathname;

  useEffect(() => {
    if (pathname === "/login" || pathname === "/activate" || !authCheckedForPath || currentUser) return;
    router.replace("/login");
  }, [authCheckedForPath, currentUser, pathname, router]);

  const signOut = useCallback(async () => {
    let csrfToken = "";
    for (const part of document.cookie.split(";")) {
      const separator = part.indexOf("=");
      if (part.slice(0, separator).trim() === "fx_csrf") csrfToken = part.slice(separator + 1).trim();
    }
    setAuthBusy(true);
    setAuthMessage("");
    try {
      if (!csrfToken) {
        const bootstrap = await fetch("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
        const payload = await bootstrap.json();
        csrfToken = payload?.data?.csrfToken ?? "";
      }
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken },
        body: "{}",
      });
      if (!response.ok) {
        setAuthMessage("Sign-out could not be completed. Please try again.");
        return;
      }
      setCurrentUser(null);
      router.replace("/login");
      router.refresh();
    } catch {
      setAuthMessage("Sign-out could not be completed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }, [router]);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("fx-theme");
    } catch {
      // Theme preference storage may be blocked; keep the workspace usable with light mode.
    }
    const nextTheme = stored === "dark" || stored === "light" ? stored : "light";
    // This one-time state sync hydrates the persisted preference after SSR, avoiding hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("fx-theme", next);
    } catch {
      // The active theme still changes for this session when storage is unavailable.
    }
  }, [theme]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);


  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 901px)");
    const onViewportChange = () => {
      if (desktopQuery.matches) setMobileOpen(false);
    };
    desktopQuery.addEventListener("change", onViewportChange);
    return () => desktopQuery.removeEventListener("change", onViewportChange);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      mobileWasOpen.current = true;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      window.requestAnimationFrame(() => document.querySelector<HTMLAnchorElement>("#primary-navigation a")?.focus());
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          closeMobile();
          return;
        }
        if (event.key !== "Tab") return;
        const drawer = document.getElementById("primary-navigation");
        const focusable = drawer?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", onKeyDown);
      return () => {
        document.body.style.overflow = previousOverflow;
        document.removeEventListener("keydown", onKeyDown);
      };
    }
    if (mobileWasOpen.current) {
      document.querySelector<HTMLButtonElement>(".mobile-menu-button")?.focus();
    }
    mobileWasOpen.current = mobileOpen;
    return;
  }, [mobileOpen, closeMobile]);

  const activeGroup = useMemo(
    () => navGroups.find((group) => group.items.some((item) => item.href === pathname || (item.href !== "/" && pathname.startsWith(item.href)))),
    [pathname],
  );

  if (pathname === "/login" || pathname === "/activate") {
    return (
      <div className="auth-shell">
        <main id="main-content" className="auth-shell__main">{children}</main>
        <footer className="auth-shell__footer">
          <span>Falchion Xeniaa · Internal finance workspace</span>
          <span><Icon name="shield" size={14} /> Protected account access</span>
        </footer>
      </div>
    );
  }

  if (!authCheckedForPath || !currentUser) {
    return (
      <div className="app-shell app-shell--auth-check">
        <main className="main-content" role="status" aria-live="polite">
          <LoadingState label={authCheckedForPath ? "Redirecting to sign in…" : "Verifying your session…"} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {mobileOpen ? <button className="mobile-scrim" type="button" aria-label="Close navigation menu" onClick={closeMobile} /> : null}

      <aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`} id="primary-navigation" aria-label="Primary navigation">
        <Link className="sidebar-brand" href="/" aria-label="Falchion Xeniaa Finance home">
          <span className="sidebar-brand__logo-wrap">
            <Image className="sidebar-brand__logo" src="/brand/falchion-xeniaa-logo.webp" alt="Falchion Xeniaa" width={300} height={150} priority />
          </span>
          <span className="sidebar-brand__caption">FINANCE WORKSPACE</span>
        </Link>

        <div className="workspace-switcher">
          <span className="workspace-switcher__symbol"><Icon name="building" size={17} /></span>
          <span><strong>Falchion Xeniaa</strong><small>Workspace foundation</small></span>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter((item) => !item.permission || currentUser?.permissions.includes(item.permission));
            if (!visibleItems.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <p className="nav-group__label">{group.label}</p>
                {visibleItems.map((item) => {
                  const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`nav-item ${active ? "nav-item--active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={closeMobile}
                    >
                      <Icon name={item.icon} size={19} />
                      <span>{item.label}</span>
                      {active ? <span className="nav-item__indicator" aria-hidden="true" /> : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="security-note">
            <span className="security-note__icon"><Icon name="lock" size={18} /></span>
            <div><strong>Built for careful work</strong><p>Access-controlled workflows are being prepared.</p></div>
          </div>
          <div className="sidebar-footer">
            <div className="avatar" aria-hidden="true">FX</div>
            <div className="sidebar-footer__identity"><strong>Falchion workspace</strong><span>Foundation environment</span></div>
            <span className="environment-indicator" aria-label="Foundation environment" title="Foundation environment" />
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar__left">
            <IconButton className="mobile-menu-button" icon="menu" label="Open navigation menu" expanded={mobileOpen} onClick={() => setMobileOpen(true)} />
            <div className="topbar__context">
              <span className="topbar__section">{activeGroup?.label ?? "Workspace"}</span>
              <Icon name="chevron-right" size={14} />
              <span className="topbar__current">{sectionTitle}</span>
            </div>
          </div>
          <div className="topbar__right">
            <span className="environment-pill"><span /> Foundation</span>
            <span className="topbar__divider" aria-hidden="true" />
            {currentUser ? (
              <>
                <span className="topbar-user" title={currentUser.email}>
                  <span className="topbar-user__avatar" aria-hidden="true">{currentUser.displayName.trim().split(/\\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "FX"}</span>
                  <span className="topbar-user__text"><strong>{currentUser.displayName}</strong><small>{currentUser.roles.includes("system_admin") ? "Super Administrator" : currentUser.roles[0]?.replaceAll("_", " ") ?? "Signed in"}</small></span>
                </span>
                <button className="topbar-signout" type="button" onClick={() => void signOut()} disabled={authBusy}>
                  {authBusy ? "Signing out…" : "Sign out"}
                </button>
              </>
            ) : (
              <Link className="topbar-signin" href="/login">{authLoaded ? "Sign in" : "Account"}</Link>
            )}
            <IconButton
              icon={theme === "light" ? "moon" : "sun"}
              label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              pressed={theme === "dark"}
              onClick={toggleTheme}
            />
          </div>
          {authMessage ? <p className="topbar-auth-message" role="alert">{authMessage}</p> : null}
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          {pathname !== "/" ? (
            <div className="route-context">
              <span className="route-context__icon">{selected ? <Icon name={selected.icon} size={16} /> : <Icon name="overview" size={16} />}</span>
              <div>
                <span className="route-context__title">{sectionTitle}</span>
                <span className="route-context__description">{pageDescription}</span>
              </div>
            </div>
          ) : null}
          {children}
        </main>
        <footer className="app-footer">
          <span>Falchion Xeniaa <span aria-hidden="true">·</span> Internal finance workspace</span>
          <span><span className="footer-status-dot" /> Foundation environment</span>
        </footer>
      </div>
    </div>
  );
}
