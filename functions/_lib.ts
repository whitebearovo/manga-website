import type { R2Bucket, PagesFunction } from "@cloudflare/workers-types";
import type { Chapter, LibraryData, MangaSeries } from "../src/types";

export interface Env {
  MANGA_BUCKET: R2Bucket;
  ADMIN_TOKEN?: string;
  R2_PUBLIC_BASE_URL?: string;
}

export const LIBRARY_KEY = "library.json";
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"]);

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(
  message: string,
  status = 400,
  code?: string,
  details?: string,
) {
  return json({ error: message, code, details }, { status });
}

export function getAssetBase(env: Env) {
  return (env.R2_PUBLIC_BASE_URL || "/api/media").replace(/\/$/, "");
}

export function enrichLibrary(library: LibraryData, env: Env): LibraryData {
  return {
    ...library,
    assetBaseUrl: getAssetBase(env),
    mode: "r2",
  };
}

export function sortKeys(values: string[]) {
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  return [...values].sort((a, b) => collator.compare(a, b));
}

export function normalizeKey(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

export function safeDirectory(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "-")
    .replace(/\//g, "-")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "-")
    .replace(/^\.+$/, "")
    .slice(0, 80);
}

export function extensionOf(name: string) {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || ".png";
}

export function safeFilename(name: string, fallback = "page.png") {
  const base = name.split(/[\\/]/).pop() || fallback;
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-");
  return cleaned.slice(0, 180) || fallback;
}

export function contentTypeForKey(key: string) {
  const ext = extensionOf(key);
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
  };
  return types[ext] || "application/octet-stream";
}

export function isImageKey(key: string) {
  return IMAGE_EXTENSIONS.has(extensionOf(key));
}

export async function readLibrary(bucket: R2Bucket): Promise<LibraryData> {
  const object = await bucket.get(LIBRARY_KEY);
  if (!object) {
    return { version: 1, updatedAt: new Date().toISOString(), series: [] };
  }
  const raw = await object.json<Partial<LibraryData>>();
  if (!raw || !Array.isArray(raw.series)) {
    throw new Error("R2 中的 library.json 格式无效");
  }
  return {
    version: Number(raw.version) || 1,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    series: raw.series as MangaSeries[],
  };
}

export async function writeLibrary(bucket: R2Bucket, library: LibraryData) {
  const next: LibraryData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    series: sortSeries(library.series),
  };
  await bucket.put(LIBRARY_KEY, JSON.stringify(next, null, 2), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    },
    customMetadata: {
      updatedBy: "yoru-admin",
    },
  });
  return next;
}

export function sortSeries(series: MangaSeries[]) {
  return [...series].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function sortChapters(chapters: Chapter[]) {
  return [...chapters].sort((a, b) => a.number - b.number);
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function requireAdmin(request: Request, env: Env): Response | null {
  if (!env.ADMIN_TOKEN) {
    return errorResponse(
      "服务端尚未设置 ADMIN_TOKEN",
      503,
      "ADMIN_TOKEN_MISSING",
      "在 Cloudflare Pages 的环境变量中设置 ADMIN_TOKEN 后重新部署。",
    );
  }
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !constantTimeEqual(token, env.ADMIN_TOKEN)) {
    return errorResponse("管理口令不正确", 401, "UNAUTHORIZED");
  }
  return null;
}

export function requireBucket(env: Env): Response | null {
  if (!env.MANGA_BUCKET) {
    return errorResponse(
      "未绑定 R2 存储桶",
      503,
      "R2_BINDING_MISSING",
      "在 Cloudflare Pages 中把 R2 存储桶绑定为 MANGA_BUCKET。",
    );
  }
  return null;
}

export async function listImageKeys(bucket: R2Bucket, prefix: string) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) {
      if (object.key !== prefix && isImageKey(object.key)) keys.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return sortKeys(keys);
}

export async function deleteKeys(bucket: R2Bucket, keys: string[]) {
  for (let index = 0; index < keys.length; index += 1000) {
    await bucket.delete(keys.slice(index, index + 1000));
  }
}

export interface PageContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

export type PagesHandler = (context: PageContext) => Response | Promise<Response>;
