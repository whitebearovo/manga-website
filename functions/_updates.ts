import type { R2Bucket } from "@cloudflare/workers-types";
import type { LibraryData, MangaSeries } from "../src/types";
import {
  constantTimeEqual,
  errorResponse,
  getAssetBase,
  json,
  sortChapters,
  type Env,
} from "./_lib";

export const QQ_NOTIFICATION_STATE_KEY = "notifications/qq-state.json";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
};

export interface LatestChapterStatus {
  id: string;
  number: number;
  title: string;
  publishedAt: string;
  pageCount: number;
  url: string;
}

export interface MangaUpdateStatus {
  seriesId: string;
  title: string;
  author: string;
  status: MangaSeries["status"];
  updatedAt: string;
  coverUrl: string;
  seriesUrl: string;
  latestChapter: LatestChapterStatus;
}

export interface QQNotificationState {
  version: 1;
  signatures: Record<string, string>;
  notifiedAt: string;
}

export interface QQUpdateBatch {
  event: "manga.update";
  version: 1;
  createdAt: string;
  siteUrl: string;
  text: string;
  updates: MangaUpdateStatus[];
}

export function withApiCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function apiJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return json(data, { ...init, headers });
}

export function apiOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function requireUpdateApiToken(request: Request, env: Env) {
  const expected = String(env.UPDATE_API_TOKEN || env.ADMIN_TOKEN || "").trim();
  if (!expected) {
    return errorResponse(
      "服务端尚未设置 UPDATE_API_TOKEN 或 ADMIN_TOKEN",
      503,
      "UPDATE_TOKEN_MISSING",
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const provided = bearer;
  if (!provided || !constantTimeEqual(provided, expected)) {
    return errorResponse("更新 API 口令不正确", 401, "UNAUTHORIZED");
  }
  return null;
}

export function parseSince(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const numeric = Number(raw);
  const parsed = /^\d+$/.test(raw)
    ? new Date(raw.length <= 10 ? numeric * 1000 : numeric)
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("since 必须是 ISO 时间或 Unix 时间戳");
  }
  return parsed.toISOString();
}

export function filterUpdatesSince(updates: MangaUpdateStatus[], since: string | null) {
  if (!since) return updates;
  const threshold = new Date(since).getTime();
  return updates.filter((item) => new Date(item.updatedAt).getTime() > threshold);
}

export function buildUpdateItems(
  library: LibraryData,
  env: Env,
  requestUrl: string,
): MangaUpdateStatus[] {
  const siteUrl = getSiteUrl(env, requestUrl);
  return library.series
    .map((series) => buildSeriesStatus(series, env, siteUrl))
    .filter((item): item is MangaUpdateStatus => Boolean(item))
    .sort((left, right) => {
      const timeDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      return timeDiff || left.title.localeCompare(right.title, "zh-CN");
    });
}

export function getSiteUrl(env: Env, requestUrl: string) {
  const configured = String(env.SITE_URL || "").trim();
  if (!configured) return new URL(requestUrl).origin;
  return configured.replace(/\/+$/, "");
}

export function buildQQUpdateBatch(
  updates: MangaUpdateStatus[],
  env: Env,
  requestUrl: string,
): QQUpdateBatch {
  return {
    event: "manga.update",
    version: 1,
    createdAt: new Date().toISOString(),
    siteUrl: getSiteUrl(env, requestUrl),
    text: buildQQMessage(updates),
    updates,
  };
}

export function buildQQMessage(updates: MangaUpdateStatus[]) {
  const lines = ["【夜页漫画更新】"];
  for (const item of updates) {
    const chapter = item.latestChapter;
    lines.push(
      `《${item.title}》更新至第 ${chapter.number} 话「${chapter.title}」`,
      `${chapter.url}（${chapter.pageCount} 页）`,
    );
  }
  return lines.join("\n");
}

export function signaturesOf(updates: MangaUpdateStatus[]) {
  return Object.fromEntries(
    updates.map((item) => [item.seriesId, item.latestChapter.id]),
  ) as Record<string, string>;
}

export async function readQQNotificationState(bucket: R2Bucket) {
  const object = await bucket.get(QQ_NOTIFICATION_STATE_KEY);
  if (!object) return null;
  try {
    const raw = await object.json<Partial<QQNotificationState>>();
    if (!raw?.signatures || typeof raw.signatures !== "object") return null;
    const signatures = Object.fromEntries(
      Object.entries(raw.signatures).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    return {
      version: 1 as const,
      signatures,
      notifiedAt: typeof raw.notifiedAt === "string" ? raw.notifiedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function writeQQNotificationState(bucket: R2Bucket, updates: MangaUpdateStatus[]) {
  return writeQQNotificationSignatures(bucket, signaturesOf(updates));
}

export async function writeQQNotificationSignatures(
  bucket: R2Bucket,
  signatures: Record<string, string>,
) {
  const state: QQNotificationState = {
    version: 1,
    signatures,
    notifiedAt: new Date().toISOString(),
  };
  await bucket.put(QQ_NOTIFICATION_STATE_KEY, JSON.stringify(state, null, 2), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    },
    customMetadata: {
      updatedBy: "yoru-qq-notifier",
    },
  });
  return state;
}

function buildSeriesStatus(series: MangaSeries, env: Env, siteUrl: string) {
  const chapters = sortChapters(series.chapters);
  const latest = chapters.at(-1);
  if (!latest) return null;

  const publishedAt = validIso(latest.publishedAt) || validIso(series.updatedAt) || new Date(0).toISOString();
  const updatedAt = latestIso(publishedAt, series.updatedAt);
  const coverKey = series.coverKey || latest.pages[0] || "";

  return {
    seriesId: series.id,
    title: series.title,
    author: series.author,
    status: series.status,
    updatedAt,
    coverUrl: coverKey ? absoluteAssetUrl(coverKey, env, siteUrl) : "",
    seriesUrl: `${siteUrl}/series/${encodeURIComponent(series.id)}`,
    latestChapter: {
      id: latest.id,
      number: latest.number,
      title: latest.title,
      publishedAt,
      pageCount: latest.pages.length,
      url: `${siteUrl}/read/${encodeURIComponent(series.id)}/${encodeURIComponent(String(latest.number))}`,
    },
  } satisfies MangaUpdateStatus;
}

function absoluteAssetUrl(key: string, env: Env, siteUrl: string) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const base = getAssetBase(env).replace(/\/$/, "");
  if (/^https?:\/\//i.test(base)) return `${base}/${encodedKey}`;
  const relativeBase = base.startsWith("/") ? base : `/${base}`;
  return new URL(`${relativeBase}/${encodedKey}`, siteUrl).toString();
}

function validIso(value: string | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function latestIso(left: string, right: string) {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(rightTime)) return validIso(left) || new Date(0).toISOString();
  return rightTime > leftTime ? new Date(rightTime).toISOString() : left;
}
