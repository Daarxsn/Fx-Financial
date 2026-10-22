#!/usr/bin/env node
const mode = process.env.SMOKE_MODE || "deployment";
const rawOrigin = (process.env.SMOKE_BASE_URL || "").trim();

if (!["headers", "deployment"].includes(mode)) {
  console.error("SMOKE_MODE must be headers or deployment");
  process.exit(2);
}
if (!rawOrigin) {
  console.error("SMOKE_BASE_URL is required");
  process.exit(2);
}

let base;
try {
  base = new URL(rawOrigin);
} catch {
  console.error("SMOKE_BASE_URL must be a valid origin URL");
  process.exit(2);
}
const loopback = ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
if (base.origin !== rawOrigin || base.pathname !== "/" || base.search || base.hash ||
    !["https:", "http:"].includes(base.protocol) || (base.protocol === "http:" && !loopback)) {
  console.error("SMOKE_BASE_URL must be an exact HTTPS origin; HTTP is permitted only for loopback CI tests");
  process.exit(2);
}

const passed = [];
function pass(message) {
  passed.push(message);
  console.log("PASS: " + message);
}
async function get(path) {
  return fetch(new URL(path, base.origin), {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
}
function requireHeader(headers, name, expected) {
  const actual = headers.get(name) || "";
  if (!actual.toLowerCase().includes(expected.toLowerCase())) {
    throw new Error("Required HTTP response header is missing or incorrect: " + name);
  }
}

async function main() {
  const login = await get("/login");
  if (login.status !== 200) throw new Error("Login page did not return HTTP 200");
  if (!(login.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
    throw new Error("Login route did not return HTML");
  }
  requireHeader(login.headers, "content-security-policy", "default-src");
  requireHeader(login.headers, "x-frame-options", "deny");
  requireHeader(login.headers, "x-content-type-options", "nosniff");
  requireHeader(login.headers, "referrer-policy", "no-referrer");
  requireHeader(login.headers, "permissions-policy", "camera=()");
  requireHeader(login.headers, "cross-origin-opener-policy", "same-origin");
  if (login.headers.has("x-powered-by")) throw new Error("X-Powered-By must not be exposed");
  if (base.protocol === "https:") requireHeader(login.headers, "strict-transport-security", "max-age=31536000");
  pass("login page and security headers");

  if (mode === "headers") {
    console.log("PASS: header-only smoke completed (" + passed.length + " check).");
    return;
  }

  const health = await get("/api/health");
  if (health.status !== 200) throw new Error("Health endpoint did not return HTTP 200");
  const healthBody = await health.json();
  if (healthBody.status !== "ok" || healthBody.checks?.database !== "ok") {
    throw new Error("Health endpoint did not confirm database readiness");
  }
  pass("database health endpoint");

  const csrf = await get("/api/v1/auth/csrf");
  if (csrf.status !== 200) throw new Error("Anonymous CSRF bootstrap did not return HTTP 200");
  const csrfBody = await csrf.json();
  if (typeof csrfBody.data?.csrfToken !== "string" || csrfBody.data.csrfToken.length < 32) {
    throw new Error("Anonymous CSRF bootstrap did not return a sufficiently sized token");
  }
  if (!(csrf.headers.get("set-cookie") || "").includes("fx_csrf=")) {
    throw new Error("Anonymous CSRF bootstrap did not set the expected cookie");
  }
  pass("CSRF bootstrap response and cookie");

  const protectedResponse = await get("/api/v1/customers");
  if (protectedResponse.status !== 401) {
    throw new Error("Anonymous request to a protected customer API must be denied with HTTP 401");
  }
  pass("anonymous protected API denial");
  console.log("Deployment smoke passed (" + passed.length + " checks).");
}

main().catch((error) => {
  console.error("FAIL: deployment smoke could not be completed: " +
    (error instanceof Error ? error.message : "unexpected error"));
  process.exitCode = 1;
});
