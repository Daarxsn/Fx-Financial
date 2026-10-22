import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";

export class PrivateStorageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "PrivateStorageError"; this.code = code; }
}
export type StoredObjectMetadata = { byteSize: number; sha256: string };
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
type FilesystemConfig = { driver: "filesystem"; root: string };
type S3Config = { driver: "s3"; bucket: string; client: S3Client; encryption: ServerSideEncryption; kmsKeyId?: string };
type StorageConfig = FilesystemConfig | S3Config;
let s3Cache: { signature: string; client: S3Client } | undefined;
let checkedBucket = "";

function failConfig(): PrivateStorageError {
  return new PrivateStorageError("DOCUMENT_STORAGE_NOT_CONFIGURED","Private document storage is not configured correctly.");
}
function validKey(key: string): boolean {
  return key.length > 0 && key.length < 1024 &&
    /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.pdf$/.test(key) &&
    !key.split("/").some(part => part === "." || part === "..");
}
function localTarget(root: string,key: string): string {
  if (!validKey(key)) throw failConfig();
  const full = resolve(root,key);
  const rel = relative(root,full);
  if (!rel || rel === ".." || rel.startsWith(".."+sep) || isAbsolute(rel)) throw failConfig();
  return full;
}
function getConfig(): StorageConfig {
  const driver = process.env.DOCUMENTS_STORAGE_DRIVER ?? (process.env.NODE_ENV === "production" || process.env.VERCEL === "1" ? "s3" : "filesystem");
  if (driver === "filesystem") {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") throw failConfig();
    const root = resolve(process.env.DOCUMENTS_STORAGE_LOCAL_ROOT || join(tmpdir(),"fx-financial-private-documents"));
    return {driver:"filesystem",root};
  }
  if (driver !== "s3") throw failConfig();
  const bucket = process.env.DOCUMENTS_STORAGE_BUCKET?.trim() ?? "";
  const region = process.env.DOCUMENTS_STORAGE_REGION?.trim() ?? "";
  const accessKeyId = process.env.DOCUMENTS_STORAGE_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.DOCUMENTS_STORAGE_SECRET_ACCESS_KEY ?? "";
  const endpoint = process.env.DOCUMENTS_STORAGE_ENDPOINT?.trim() || undefined;
  if (endpoint && process.env.NODE_ENV === "production") {
    let parsedEndpoint: URL;
    try { parsedEndpoint = new URL(endpoint); } catch { throw failConfig(); }
    if (parsedEndpoint.protocol !== "https:" || parsedEndpoint.username || parsedEndpoint.password) throw failConfig();
  }
  if (!bucket || !region || !accessKeyId || !secretAccessKey) throw failConfig();
  const rawEncryption = process.env.DOCUMENTS_STORAGE_SERVER_SIDE_ENCRYPTION?.trim() || "AES256";
  if (rawEncryption !== "AES256" && rawEncryption !== "aws:kms") throw failConfig();
  const encryption = rawEncryption as ServerSideEncryption;
  const kmsKeyId = process.env.DOCUMENTS_STORAGE_KMS_KEY_ID?.trim() || undefined;
  if (encryption === "aws:kms" && !kmsKeyId) throw failConfig();
  const signature = [bucket,region,endpoint??"",accessKeyId,secretAccessKey,encryption,kmsKeyId??""].join("|");
  if (!s3Cache || s3Cache.signature !== signature) {
    s3Cache = {signature,client:new S3Client({
      region,endpoint,
      forcePathStyle:process.env.DOCUMENTS_STORAGE_FORCE_PATH_STYLE === "true" || Boolean(endpoint),
      credentials:{accessKeyId,secretAccessKey},maxAttempts:2,
    })};
    checkedBucket = "";
  }
  return {driver:"s3",bucket,client:s3Cache.client,encryption,kmsKeyId};
}
async function checkBucket(storage: S3Config): Promise<void> {
  if (checkedBucket === storage.bucket) return;
  try { await storage.client.send(new HeadBucketCommand({Bucket:storage.bucket})); checkedBucket=storage.bucket; }
  catch { throw new PrivateStorageError("DOCUMENT_STORAGE_UNAVAILABLE","The configured private document bucket is not reachable."); }
}
function sha(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

export async function putPrivateObject(key: string, bytes: Buffer, expectedSha256: string): Promise<StoredObjectMetadata> {
  if (!validKey(key) || bytes.length <= 0 || bytes.length > MAX_DOCUMENT_BYTES ||
      !/^[0-9a-f]{64}$/.test(expectedSha256) || sha(bytes) !== expectedSha256) {
    throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE","Generated document integrity validation failed.");
  }
  const cfg = getConfig();
  if (cfg.driver === "filesystem") {
    const target = localTarget(cfg.root,key);
    await mkdir(dirname(target),{recursive:true,mode:0o700});
    const temp = target + "." + (await import("node:crypto")).randomUUID() + ".tmp";
    try {
      await writeFile(temp,bytes,{flag:"wx",mode:0o600});
      // A random, single-use key is mandatory: an existing object is never replaced.
      try {
        await writeFile(target,bytes,{flag:"wx",mode:0o600});
        const { unlink } = await import("node:fs/promises");
        await unlink(temp).catch(()=>undefined);
      } catch (error) {
        const { unlink } = await import("node:fs/promises");
        await unlink(temp).catch(()=>undefined);
        throw error;
      }
    } catch {
      throw new PrivateStorageError("DOCUMENT_STORAGE_UNAVAILABLE","The private document could not be stored without overwriting existing evidence.");
    }
    const result = await headPrivateObject(key);
    if (result.byteSize !== bytes.length || result.sha256 !== expectedSha256) {
      throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE","Stored document integrity validation failed.");
    }
    return result;
  }
  await checkBucket(cfg);
  try {
    await cfg.client.send(new PutObjectCommand({
      Bucket:cfg.bucket,Key:key,Body:bytes,ContentLength:bytes.length,ContentType:"application/pdf",
      CacheControl:"private, no-store, max-age=0",Metadata:{sha256:expectedSha256},
      ServerSideEncryption:cfg.encryption,
      ...(cfg.encryption === "aws:kms" && cfg.kmsKeyId ? {SSEKMSKeyId:cfg.kmsKeyId}:{}),
      IfNoneMatch:"*",
    }));
  } catch {
    throw new PrivateStorageError("DOCUMENT_STORAGE_UNAVAILABLE","The private document could not be stored. Existing objects are never replaced.");
  }
  const result = await headPrivateObject(key);
  if (result.byteSize !== bytes.length || result.sha256 !== expectedSha256) {
    throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE","Stored document integrity validation failed.");
  }
  return result;
}

export async function headPrivateObject(key: string): Promise<StoredObjectMetadata> {
  if (!validKey(key)) throw failConfig();
  const cfg = getConfig();
  if (cfg.driver === "filesystem") {
    try {
      const bytes = await readFile(localTarget(cfg.root,key));
      return {byteSize:bytes.length,sha256:sha(bytes)};
    } catch {
      throw new PrivateStorageError("DOCUMENT_STORAGE_UNAVAILABLE","The private document could not be verified.");
    }
  }
  await checkBucket(cfg);
  try {
    const head = await cfg.client.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:key}));
    const byteSize = Number(head.ContentLength ?? 0);
    const digest = head.Metadata?.sha256 ?? "";
    if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_DOCUMENT_BYTES || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE","Stored document metadata is invalid.");
    }
    return {byteSize,sha256:digest};
  } catch (error) {
    if (error instanceof PrivateStorageError) throw error;
    throw new PrivateStorageError("DOCUMENT_STORAGE_UNAVAILABLE","The private document could not be verified.");
  }
}

export async function getPrivateObject(key: string): Promise<Buffer> {
  if (!validKey(key)) throw failConfig();
  const cfg = getConfig();
  if (cfg.driver === "filesystem") {
    try {
      const bytes = await readFile(localTarget(cfg.root,key));
      if (bytes.length <= 0 || bytes.length > MAX_DOCUMENT_BYTES) throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE","Stored document size is invalid.");
      return bytes;
    } catch (error) {
      if (error instanceof PrivateStorageError) throw error;
      throw new PrivateStorageError("DOCUMENT_STORAGE_UNAVAILABLE","The private document could not be retrieved.");
    }
  }
  await checkBucket(cfg);
  try {
    const object = await cfg.client.send(new GetObjectCommand({Bucket:cfg.bucket,Key:key}));
    const size = Number(object.ContentLength ?? 0);
    if (!object.Body || !Number.isSafeInteger(size) || size <= 0 || size > MAX_DOCUMENT_BYTES) {
      throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE","Stored document size is invalid.");
    }
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (bytes.length !== size) throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE","Stored document size is invalid.");
    return bytes;
  } catch (error) {
    if (error instanceof PrivateStorageError) throw error;
    throw new PrivateStorageError("DOCUMENT_STORAGE_UNAVAILABLE","The private document could not be retrieved.");
  }
}
