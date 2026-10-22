#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const smokePath = "scripts/smoke-deployment.mjs";
const token = "s".repeat(48);

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

async function startMockServer(options = {}) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/login") {
      const headers = {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'self'; object-src 'none'",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
        "cross-origin-opener-policy": "same-origin",
      };
      if (options.missingHeader) delete headers[options.missingHeader];
      response.writeHead(options.loginStatus ?? 200, headers);
      response.end("<!doctype html><title>Smoke test</title>");
      return;
    }
    if (pathname === "/api/health") {
      const healthy = options.healthHealthy !== false;
      sendJson(response, options.healthStatus ?? 200, healthy
        ? { status: "ok", checks: { database: "ok" } }
        : { status: "degraded", checks: { database: "error" } });
      return;
    }
    if (pathname === "/api/v1/auth/csrf") {
      sendJson(response, 200, { data: { csrfToken: token } },
        options.omitCookie ? {} : { "set-cookie": "fx_csrf=synthetic-cookie; Path=/; SameSite=Strict" });
      return;
    }
    if (pathname === "/api/v1/customers") {
      sendJson(response, options.protectedStatus ?? 401, { error: "unauthorized" });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function runProcess(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr, output: stdout + stderr });
    });
  });
}

async function withServer(options, callback) {
  const { server, origin } = await startMockServer(options);
  try { await callback(origin); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function expectFailure(label, options, expected, mode = "deployment") {
  await withServer(options, async (origin) => {
    const result = await runProcess([smokePath], { SMOKE_BASE_URL: origin, SMOKE_MODE: mode });
    assert.notEqual(result.code, 0, label + " must fail: " + result.output);
    assert.match(result.output, expected, label + " error should be actionable");
    console.log("PASS: " + label + " fails closed.");
  });
}

await withServer({}, async (origin) => {
  const full = await runProcess([smokePath], { SMOKE_BASE_URL: origin, SMOKE_MODE: "deployment" });
  assert.equal(full.code, 0, "healthy deployment smoke should pass: " + full.output);
  assert.match(full.output, /Deployment smoke passed \(4 checks\)/);
  const headers = await runProcess([smokePath], { SMOKE_BASE_URL: origin, SMOKE_MODE: "headers" });
  assert.equal(headers.code, 0, "header-only smoke should pass: " + headers.output);
  assert.match(headers.output, /header-only smoke completed/);
  console.log("PASS: healthy deployment and header-only smoke paths.");
});

await expectFailure("missing login CSP", { missingHeader: "content-security-policy" }, /content-security-policy/);
await expectFailure("database degraded response", { healthHealthy: false }, /database readiness/);
await expectFailure("missing CSRF cookie", { omitCookie: true }, /did not set the expected cookie/);
await expectFailure("anonymous protected API unexpectedly accessible", { protectedStatus: 200 }, /must be denied with HTTP 401/);

const invalidOrigin = await runProcess([smokePath], { SMOKE_BASE_URL: "http://example.com", SMOKE_MODE: "deployment" });
assert.equal(invalidOrigin.code, 2);
assert.match(invalidOrigin.output, /HTTP is permitted only for loopback CI tests/);
const nonRootOrigin = await runProcess([smokePath], { SMOKE_BASE_URL: "https://example.invalid/app", SMOKE_MODE: "deployment" });
assert.equal(nonRootOrigin.code, 2);
assert.match(nonRootOrigin.output, /exact HTTPS origin/);
console.log("PASS: non-loopback HTTP and URL paths are rejected before any network request.");

console.log("Pack 9 deployment smoke contract tests passed: 8 scenarios across 6 groups.");
