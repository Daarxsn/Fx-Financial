"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { InlineAlert, StatusBadge } from "@/components/ui";

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
  const body = await response.json();
  if (!response.ok || typeof body?.data?.csrfToken !== "string") {
    throw new Error("Security verification could not be initialized. Refresh and try again.");
  }
  return body.data.csrfToken;
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const csrfToken = await fetchCsrfToken();
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Sign-in failed. Check your credentials and try again.");
      setPassword("");
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card-container">
      {/* Brand Header directly above card matching luxury mockup */}
      <div className="auth-card__brand">
        <span className="auth-card__logo-wrap">
          <Image
            className="auth-card__logo"
            src="/brand/falchion-xeniaa-logo.webp"
            alt="Falchion Xeniaa"
            width={280}
            height={140}
            unoptimized
            priority
          />
        </span>
        <span className="auth-card__brand-caption">INVOICE WORKSPACE</span>
      </div>

      <section className="auth-card" aria-labelledby="login-title">
        <h1 id="login-title" className="auth-card__title">
          Welcome back<span className="sr-only">.</span>
        </h1>
        <p className="auth-card__description">Sign in to your invoice workspace</p>

        {error ? <InlineAlert tone="danger" title="Sign-in was not completed">{error}</InlineAlert> : null}

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-input-group">
            <label className="form-label" htmlFor="login-email">
              Email address <span className="sr-only">Work email</span>
            </label>
            <div className="auth-input-wrapper">
              <span className="auth-input-icon" aria-hidden="true">
                <Icon name="mail" size={17} />
              </span>
              <input
                id="login-email"
                name="email"
                className="form-control auth-input"
                type="email"
                autoComplete="username"
                inputMode="email"
                aria-label="Work email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                maxLength={320}
                placeholder="you@company.com"
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label className="form-label" htmlFor="login-password">
              Password
            </label>
            <div className="auth-input-wrapper">
              <span className="auth-input-icon" aria-hidden="true">
                <Icon name="lock" size={17} />
              </span>
              <input
                id="login-password"
                name="password"
                className="form-control auth-input"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
                maxLength={256}
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <Icon name={showPassword ? "eye-off" : "eye"} size={17} />
              </button>
            </div>
          </div>

          <div className="auth-forgot-row">
            <button
              type="button"
              className="auth-forgot"
              onClick={() => setError("Password reset is managed by your administrator. Contact your company administrator to reset credentials.")}
            >
              Forgot password?
            </button>
          </div>

          <div className="auth-remember-row">
            <label className="auth-remember">
              <span className="auth-checkbox-wrap">
                <input
                  type="checkbox"
                  id="remember-me"
                  className="auth-checkbox-native"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span className={`auth-checkbox-box ${rememberMe ? "auth-checkbox-box--checked" : ""}`} aria-hidden="true">
                  {rememberMe ? (
                    <svg viewBox="0 0 12 10" width="11" height="9" fill="none">
                      <path d="M1.5 5.2L4.5 8.2L10.5 1.8" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
              </span>
              <span>Keep me signed in</span>
            </label>
          </div>

          <button type="submit" disabled={busy} className="auth-submit-gold">
            {busy ? (
              <>
                <span className="button-spinner" aria-hidden="true" /> Signing in…
              </>
            ) : (
              <>
                Sign in <span className="auth-submit__arrow" aria-hidden="true">→</span>
              </>
            )}
          </button>
        </form>

        <div className="auth-divider" role="separator">
          <span>OR</span>
        </div>

        <p className="auth-card__contact">
          Don&apos;t have an account?{" "}
          <a
            href="mailto:admin@falchionxeniaa.com?subject=Account%20Request%20-%20Falchion%20Xeniaa%20Invoice%20Workspace"
            className="auth-admin-link"
          >
            Contact your administrator.
          </a>
        </p>

        <p className="auth-card__invite-link">
          Have an invitation code? <Link href="/activate">Activate your account</Link>
        </p>
      </section>
    </div>
  );
}

export function ActivateForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? "" : "This activation link does not contain a valid invitation token.");
  const [activated, setActivated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (token && window.location.search) {
      window.history.replaceState({}, document.title, "/activate");
    }
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("This activation link is incomplete. Ask your administrator for a new invitation.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setError("Use a password between 12 and 128 characters.");
      return;
    }
    setBusy(true);
    try {
      const csrfToken = await fetchCsrfToken();
      const response = await fetch("/api/v1/auth/activate", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ token, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Account activation failed.");
      setPassword("");
      setConfirmPassword("");
      setActivated(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account activation failed. Ask your administrator for help.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card-container">
      <div className="auth-card__brand">
        <span className="auth-card__logo-wrap">
          <Image className="auth-card__logo" src="/brand/falchion-xeniaa-logo.webp" alt="Falchion Xeniaa brand mark reference" width={280} height={140} unoptimized priority />
        </span>
        <span className="auth-card__brand-caption">INVOICE WORKSPACE</span>
      </div>

      <section className="auth-card" aria-labelledby="activate-title">
        <StatusBadge tone="info" icon="shield">Invitation activation</StatusBadge>
        {activated ? (
          <div className="auth-success">
            <span className="auth-success__icon"><Icon name="check" size={25} /></span>
            <h1 id="activate-title" className="auth-card__title">You’re all set.</h1>
            <p className="auth-card__description">Your account is active. Sign in to open your workspace.</p>
            <button type="button" onClick={() => router.replace("/login")} className="auth-submit-gold">
              Continue to sign in <span className="auth-submit__arrow" aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <>
            <h1 id="activate-title" className="auth-card__title">Set up your account.</h1>
            <p className="auth-card__description">Choose a strong password to activate your invited account.</p>
            {error ? <InlineAlert tone="danger" title="Activation was not completed">{error}</InlineAlert> : null}
            <form className="auth-form" onSubmit={submit}>
              <div className="auth-input-group">
                <label className="form-label" htmlFor="activate-password">New password</label>
                <div className="auth-input-wrapper">
                  <span className="auth-input-icon" aria-hidden="true"><Icon name="lock" size={17} /></span>
                  <input
                    id="activate-password"
                    name="password"
                    className="form-control auth-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    required
                    minLength={12}
                    maxLength={128}
                    placeholder="At least 12 characters"
                  />
                  <button className="auth-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                    <Icon name={showPassword ? "eye-off" : "eye"} size={17} />
                  </button>
                </div>
              </div>
              <div className="auth-input-group">
                <label className="form-label" htmlFor="activate-confirm-password">Confirm password</label>
                <div className="auth-input-wrapper">
                  <span className="auth-input-icon" aria-hidden="true"><Icon name="lock" size={17} /></span>
                  <input
                    id="activate-confirm-password"
                    name="confirmPassword"
                    className="form-control auth-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                    required
                    minLength={12}
                    maxLength={128}
                    placeholder="Re-enter password"
                  />
                </div>
              </div>
              <button type="submit" disabled={busy || !token} className="auth-submit-gold">
                {busy ? <><span className="button-spinner" aria-hidden="true" /> Activating…</> : <>Activate account <span className="auth-submit__arrow" aria-hidden="true">→</span></>}
              </button>
            </form>
          </>
        )}
        <p className="auth-card__footnote"><Link href="/login">Return to sign in</Link></p>
      </section>
    </div>
  );
}
