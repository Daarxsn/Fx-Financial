#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

function fail(message) {
  console.error(`OpenAPI validation failed: ${message}`);
  process.exitCode = 1;
}

const file = path.join(process.cwd(), "docs", "openapi.yaml");
let spec;
try {
  spec = yaml.load(fs.readFileSync(file, "utf8"), { json: false });
} catch (error) {
  fail(error instanceof Error ? error.message : "YAML parse error");
  process.exit();
}

if (!spec || spec.openapi !== "3.1.0") fail("openapi must be 3.1.0");
if (!spec.info || !spec.info.title || !spec.info.version) fail("info.title and info.version are required");
if (!spec.paths || typeof spec.paths !== "object") fail("paths object is required");
if (!spec.components || !spec.components.schemas) fail("components.schemas is required");

function resolveLocalRef(ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    fail(`unsupported or non-local reference: ${String(ref)}`);
    return undefined;
  }
  let current = spec;
  for (const token of ref.slice(2).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!current || typeof current !== "object" || !(token in current)) {
      fail(`unresolved reference: ${ref}`);
      return undefined;
    }
    current = current[token];
  }
  return current;
}

const operationIds = new Set();
const implemented = new Set();
const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);

function walk(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) walk(child);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(value, "$ref")) resolveLocalRef(value.$ref);
  for (const child of Object.values(value)) walk(child);
}
walk(spec);

for (const [route, item] of Object.entries(spec.paths || {})) {
  if (!item || typeof item !== "object") {
    fail(`path item must be an object: ${route}`);
    continue;
  }
  const pathParameters = (item.parameters || []).map((parameter) => {
    const resolved = parameter.$ref ? resolveLocalRef(parameter.$ref) : parameter;
    return resolved?.in === "path" ? resolved.name : null;
  }).filter(Boolean);

  for (const [method, operation] of Object.entries(item)) {
    if (!methods.has(method)) continue;
    if (!operation || typeof operation !== "object") {
      fail(`operation must be an object: ${method.toUpperCase()} ${route}`);
      continue;
    }
    if (!operation.operationId) fail(`missing operationId: ${method.toUpperCase()} ${route}`);
    if (operation.operationId) {
      if (operationIds.has(operation.operationId)) fail(`duplicate operationId: ${operation.operationId}`);
      operationIds.add(operation.operationId);
    }
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      fail(`missing responses: ${method.toUpperCase()} ${route}`);
    }
    const status = operation["x-implementation-status"];
    if (!["implemented", "planned"].includes(status)) {
      fail(`x-implementation-status must be implemented or planned: ${method.toUpperCase()} ${route}`);
    } else if (status === "implemented") {
      implemented.add(`${method.toUpperCase()} ${route}`);
    }
    const localParameters = (operation.parameters || []).map((parameter) => {
      const resolved = parameter.$ref ? resolveLocalRef(parameter.$ref) : parameter;
      return resolved?.in === "path" ? resolved.name : null;
    }).filter(Boolean);
    for (const match of route.matchAll(/\{([^}]+)\}/g)) {
      const name = match[1];
      if (![...pathParameters, ...localParameters].includes(name)) {
        fail(`path parameter ${name} has no declaration: ${method.toUpperCase()} ${route}`);
      }
    }
  }
}

const expectedImplemented = new Set([
  "GET /api/health",
  "GET /api/v1/health",
  "GET /api/v1/customers",
  "POST /api/v1/customers",
  "GET /api/v1/customers/{customerId}",
  "PATCH /api/v1/customers/{customerId}",
  "POST /api/v1/customers/{customerId}/archive",
  "GET /api/v1/customers/export",
  "POST /api/v1/customers/import",
  "GET /api/v1/catalog/items",
  "POST /api/v1/catalog/items",
  "GET /api/v1/catalog/items/{itemId}",
  "PATCH /api/v1/catalog/items/{itemId}",
  "POST /api/v1/catalog/items/{itemId}/archive",
  "GET /api/v1/catalog/items/export",
  "POST /api/v1/catalog/items/import",
  "GET /api/v1/invoices",
  "POST /api/v1/invoices",
  "GET /api/v1/invoices/draft-options",
  "GET /api/v1/invoices/{invoiceId}",
  "PATCH /api/v1/invoices/{invoiceId}",
  "GET /api/v1/auth/csrf",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/logout",
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/activate",
  "POST /api/v1/auth/sessions/revoke-all",
  "GET /api/v1/users",
  "POST /api/v1/users/invitations",
  "PATCH /api/v1/users/{userId}",
  "GET /api/v1/legal-entities",
  "POST /api/v1/legal-entities",
  "GET /api/v1/legal-entities/{legalEntityId}",
  "PATCH /api/v1/legal-entities/{legalEntityId}",
  "GET /api/v1/legal-entities/{legalEntityId}/readiness",
  "GET /api/v1/brands",
  "POST /api/v1/brands",
  "GET /api/v1/brands/{brandId}",
  "PATCH /api/v1/brands/{brandId}",
  "GET /api/v1/business-units",
  "POST /api/v1/business-units",
  "GET /api/v1/business-units/{businessUnitId}",
  "PATCH /api/v1/business-units/{businessUnitId}",
  "POST /api/v1/invoices/{invoiceId}/issue",
  "GET /api/v1/policy-decisions",
  "PATCH /api/v1/policy-decisions/{decisionKey}",
  "GET /api/v1/correction-requests",
  "POST /api/v1/correction-requests",
  "POST /api/v1/correction-requests/{requestId}/decision",
  "GET /api/v1/payments/options",
  "GET /api/v1/payments",
  "POST /api/v1/payments",
  "GET /api/v1/payments/{paymentId}",
  "GET /api/v1/invoices/{invoiceId}/payments",
  "POST /api/v1/invoices/{invoiceId}/payments",
  "POST /api/v1/invoices/{invoiceId}/allocations",
  "POST /api/v1/payments/{paymentId}/reverse",
  "GET /api/v1/quotations",
  "POST /api/v1/quotations",
  "GET /api/v1/quotations/draft-options",
  "GET /api/v1/quotations/{quotationId}",
  "PATCH /api/v1/quotations/{quotationId}",
  "POST /api/v1/quotations/{quotationId}/status",
  "POST /api/v1/quotations/{quotationId}/convert",
  "GET /api/v1/documents/{sourceType}/{sourceId}",
  "POST /api/v1/documents/{sourceType}/{sourceId}/generate",
  "GET /api/v1/documents/files/{documentId}",
  "GET /api/v1/email/outbox",
  "POST /api/v1/email/outbox",
  "POST /api/v1/email/outbox/{outboxId}/retry",
  "GET /api/v1/reminders/policies",
  "POST /api/v1/reminders/policies",
  "POST /api/v1/reminders/policies/{policyId}/approve",
  "POST /api/v1/reminders/policies/{policyId}/disable",
]);
for (const endpoint of expectedImplemented) {
  if (!implemented.has(endpoint)) fail(`known implemented route missing or not marked implemented: ${endpoint}`);
}
for (const endpoint of implemented) {
  if (!expectedImplemented.has(endpoint)) fail(`contract says implemented but no matching verified route is registered in validator: ${endpoint}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`PASS: OpenAPI YAML parsed; ${operationIds.size} operations, local references, path parameters, operation IDs and implementation-status markers verified.`);
