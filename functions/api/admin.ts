import type { Chapter, MangaSeries } from "../../src/types";
import {
  deleteKeys,
  enrichLibrary,
  errorResponse,
  extensionOf,
  isImageKey,
  json,
  listImageKeys,
  normalizeKey,
  readLibrary,
  requireAdmin,
  requireBucket,
  safeDirectory,
  safeFilename,
  sortChapters,
  sortSeries,
  writeLibrary,
  type Env,
  type PagesHandler,
} from "../_lib";

type Payload = Record<string, unknown>;

interface ParsedBody {
  action: string;
  payload: Payload;
  form: FormData | null;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function bool(value: unknown) {
  return value === true || value === "true" || value === "1";
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseChapterNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getFile(form: FormData | null, name: string) {
  const value = form?.get(name);
  return value && typeof value !== "string" ? value : null;
}

async function parseBody(request: Request): Promise<ParsedBody> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const action = text(form.get("action"));
    let payload: Payload = {};
    const rawPayload = form.get("payload");
    if (typeof rawPayload === "string" && rawPayload) {
      payload = JSON.parse(rawPayload) as Payload;
    }
    return { action: action || text(payload.action), payload, form };
  }
  const raw = (await request.json().catch(() => ({}))) as Payload;
  return { action: text(raw.action), payload: raw, form: null };
}

function seriesById(library: Awaited<ReturnType<typeof readLibrary>>, id: string) {
  return library.series.find((series) => series.id === id);
}

async function session(env: Env) {
  const library = await readLibrary(env.MANGA_BUCKET);
  return json({
    ok: true,
    library: enrichLibrary(library, env),
    stats: {
      series: library.series.length,
      chapters: library.series.reduce((sum, series) => sum + series.chapters.length, 0),
      pages: library.series.reduce(
        (sum, series) =>
          sum + series.chapters.reduce((chapterSum, chapter) => chapterSum + chapter.pages.length, 0),
        0,
      ),
    },
  });
}

async function saveSeries(env: Env, payload: Payload, form: FormData | null) {
  const library = await readLibrary(env.MANGA_BUCKET);
  const id = text(payload.id) || crypto.randomUUID();
  const existing = seriesById(library, id);
  const title = text(payload.title, existing?.title || "");
  if (!title) return errorResponse("请填写作品名称", 422, "TITLE_REQUIRED");

  const now = new Date().toISOString();
  let coverKey = text(payload.coverKey, existing?.coverKey || "");
  const cover = getFile(form, "cover");
  if (cover) {
    if (!cover.type.startsWith("image/")) {
      return errorResponse("封面必须是图片文件", 422, "INVALID_COVER");
    }
    if (cover.size > 8 * 1024 * 1024) {
      return errorResponse("封面图片不能超过 8MB", 413, "COVER_TOO_LARGE");
    }
    const coverPath = `covers/${id}/${Date.now()}-${safeFilename(cover.name, "cover.png")}`;
    await env.MANGA_BUCKET.put(coverPath, await cover.arrayBuffer(), {
      httpMetadata: {
        contentType: cover.type || "image/png",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    coverKey = coverPath;
    if (existing?.coverKey.startsWith(`covers/${id}/`) && existing.coverKey !== coverKey) {
      await env.MANGA_BUCKET.delete(existing.coverKey);
    }
  }

  const chapters = sortChapters(existing?.chapters || []);
  if (!coverKey && chapters.length) {
    const latest = chapters[chapters.length - 1];
    coverKey = latest.pages[0] || "";
  }

  const rawGenres = Array.isArray(payload.genres)
    ? payload.genres
    : String(payload.genres || "").split(/[,，/]/);
  const genres = rawGenres.map((genre) => text(genre)).filter(Boolean).slice(0, 8);
  const status = text(payload.status, existing?.status || "连载中");
  const accent = /^#[0-9a-f]{6}$/i.test(text(payload.accent))
    ? text(payload.accent)
    : existing?.accent || "#76583d";

  const series: MangaSeries = {
    id,
    title,
    originalTitle: text(payload.originalTitle, existing?.originalTitle || ""),
    author: text(payload.author, existing?.author || "未署名"),
    artist: text(payload.artist, existing?.artist || ""),
    description: text(payload.description, existing?.description || ""),
    status: ["连载中", "已完结", "休载中"].includes(status)
      ? (status as MangaSeries["status"])
      : "连载中",
    genres,
    coverKey,
    accent,
    chapters,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const nextSeries = existing
    ? library.series.map((item) => (item.id === id ? series : item))
    : [series, ...library.series];
  const nextLibrary = await writeLibrary(env.MANGA_BUCKET, {
    ...library,
    series: sortSeries(nextSeries),
  });
  return json({
    ok: true,
    series,
    library: enrichLibrary(nextLibrary, env),
  });
}

async function uploadChapter(env: Env, payload: Payload, form: FormData | null) {
  const library = await readLibrary(env.MANGA_BUCKET);
  const seriesId = text(payload.seriesId);
  const series = seriesById(library, seriesId);
  if (!series) return errorResponse("作品不存在", 404, "SERIES_NOT_FOUND");

  const number = parseChapterNumber(payload.number);
  if (number === null) return errorResponse("请填写有效的章节号", 422, "INVALID_CHAPTER_NUMBER");
  const directory = safeDirectory(payload.directory || String(number));
  if (!directory) return errorResponse("章节目录无效", 422, "INVALID_DIRECTORY");

  const files = (form?.getAll("files") || [])
    .filter((item): item is File => typeof item !== "string")
    .filter((file) => file.type.startsWith("image/") || isImageKey(file.name));
  if (!files.length) return errorResponse("请选择至少一张漫画图片", 422, "FILES_REQUIRED");

  const existing = series.chapters.find((chapter) => chapter.number === number);
  if (existing && !bool(payload.overwrite)) {
    return errorResponse("该章节号已经存在，请开启覆盖或换一个章节号", 409, "CHAPTER_EXISTS");
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 90 * 1024 * 1024) {
    return errorResponse("单次上传不能超过 90MB，请拆分章节", 413, "UPLOAD_TOO_LARGE");
  }

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  files.sort((a, b) => collator.compare(a.name, b.name));
  const renumber = payload.renumber === undefined ? true : bool(payload.renumber);
  const pageStart = Math.max(1, integer(payload.pageStart, 1));
  const usedKeys = new Set<string>();
  const pages: string[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const ext = extensionOf(file.name);
    const fileName = renumber
      ? `${pageStart + index}${ext}`
      : safeFilename(file.name, `page-${index + 1}${ext}`);
    let key = normalizeKey(`${directory}/${fileName}`);
    if (usedKeys.has(key)) key = normalizeKey(`${directory}/${pageStart + index}-${fileName}`);
    usedKeys.add(key);
    await env.MANGA_BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || (ext === ".png" ? "image/png" : "application/octet-stream"),
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    pages.push(key);
  }

  const now = new Date().toISOString();
  const chapter: Chapter = {
    id: existing?.id || crypto.randomUUID(),
    number,
    title: text(payload.title, existing?.title || `第 ${number} 话`),
    directory,
    pages,
    publishedAt: text(payload.publishedAt, existing?.publishedAt || now),
  };
  const chapters = sortChapters([
    ...series.chapters.filter((item) => item.number !== number),
    chapter,
  ]);
  const updatedSeries: MangaSeries = {
    ...series,
    coverKey: series.coverKey || pages[0] || "",
    chapters,
    updatedAt: now,
  };
  const nextLibrary = await writeLibrary(env.MANGA_BUCKET, {
    ...library,
    series: library.series.map((item) => (item.id === series.id ? updatedSeries : item)),
  });

  return json({
    ok: true,
    chapter: { ...chapter, pageCount: pages.length },
    library: enrichLibrary(nextLibrary, env),
  });
}

async function importChapter(env: Env, payload: Payload) {
  const library = await readLibrary(env.MANGA_BUCKET);
  const series = seriesById(library, text(payload.seriesId));
  if (!series) return errorResponse("作品不存在", 404, "SERIES_NOT_FOUND");

  const number = parseChapterNumber(payload.number);
  if (number === null) return errorResponse("请填写有效的章节号", 422, "INVALID_CHAPTER_NUMBER");
  const directory = safeDirectory(payload.directory || String(number));
  if (!directory) return errorResponse("章节目录无效", 422, "INVALID_DIRECTORY");
  const pages = await listImageKeys(env.MANGA_BUCKET, `${directory}/`);
  if (!pages.length) {
    return errorResponse(
      `R2 目录 ${directory}/ 中没有找到图片`,
      404,
      "NO_IMAGES",
      "请确认目录名，以及图片扩展名为 png、jpg、jpeg、webp、avif 或 gif。",
    );
  }

  const existing = series.chapters.find((chapter) => chapter.number === number);
  if (existing && !bool(payload.overwrite)) {
    return errorResponse("该章节号已经存在，请开启覆盖或换一个章节号", 409, "CHAPTER_EXISTS");
  }

  const now = new Date().toISOString();
  const chapter: Chapter = {
    id: existing?.id || crypto.randomUUID(),
    number,
    title: text(payload.title, existing?.title || `第 ${number} 话`),
    directory,
    pages,
    publishedAt: text(payload.publishedAt, existing?.publishedAt || now),
  };
  const chapters = sortChapters([
    ...series.chapters.filter((item) => item.number !== number),
    chapter,
  ]);
  const updatedSeries: MangaSeries = {
    ...series,
    coverKey: series.coverKey || pages[0],
    chapters,
    updatedAt: now,
  };
  const nextLibrary = await writeLibrary(env.MANGA_BUCKET, {
    ...library,
    series: library.series.map((item) => (item.id === series.id ? updatedSeries : item)),
  });

  return json({
    ok: true,
    chapter: { ...chapter, pageCount: pages.length },
    library: enrichLibrary(nextLibrary, env),
  });
}

async function deleteChapter(env: Env, payload: Payload) {
  const library = await readLibrary(env.MANGA_BUCKET);
  const series = seriesById(library, text(payload.seriesId));
  if (!series) return errorResponse("作品不存在", 404, "SERIES_NOT_FOUND");
  const chapter = series.chapters.find((item) => item.id === text(payload.chapterId));
  if (!chapter) return errorResponse("章节不存在", 404, "CHAPTER_NOT_FOUND");

  const chapters = series.chapters.filter((item) => item.id !== chapter.id);
  const nextCover =
    series.coverKey && chapter.pages.includes(series.coverKey)
      ? chapters.flatMap((item) => item.pages)[0] || ""
      : series.coverKey;
  const updatedSeries: MangaSeries = {
    ...series,
    coverKey: nextCover,
    chapters,
    updatedAt: new Date().toISOString(),
  };
  const nextLibrary = await writeLibrary(env.MANGA_BUCKET, {
    ...library,
    series: library.series.map((item) => (item.id === series.id ? updatedSeries : item)),
  });
  if (bool(payload.deleteObjects)) {
    await deleteKeys(env.MANGA_BUCKET, chapter.pages);
  }

  return json({ ok: true, library: enrichLibrary(nextLibrary, env) });
}

async function deleteSeries(env: Env, payload: Payload) {
  const library = await readLibrary(env.MANGA_BUCKET);
  const series = seriesById(library, text(payload.seriesId));
  if (!series) return errorResponse("作品不存在", 404, "SERIES_NOT_FOUND");

  const nextLibrary = await writeLibrary(env.MANGA_BUCKET, {
    ...library,
    series: library.series.filter((item) => item.id !== series.id),
  });
  if (bool(payload.deleteObjects)) {
    const keys = series.chapters.flatMap((chapter) => chapter.pages);
    if (series.coverKey) keys.push(series.coverKey);
    await deleteKeys(env.MANGA_BUCKET, [...new Set(keys)]);
  }

  return json({ ok: true, library: enrichLibrary(nextLibrary, env) });
}

async function handlePost(request: Request, env: Env) {
  const authError = requireAdmin(request, env);
  if (authError) return authError;
  const bucketError = requireBucket(env);
  if (bucketError) return bucketError;

  const body = await parseBody(request);
  switch (body.action) {
    case "session":
      return session(env);
    case "save-series":
      return saveSeries(env, body.payload, body.form);
    case "upload-chapter":
      return uploadChapter(env, body.payload, body.form);
    case "import-chapter":
      return importChapter(env, body.payload);
    case "delete-chapter":
      return deleteChapter(env, body.payload);
    case "delete-series":
      return deleteSeries(env, body.payload);
    default:
      return errorResponse("未知的管理操作", 400, "UNKNOWN_ACTION");
  }
}

export const onRequestPost: PagesHandler = async (context) => {
  try {
    return await handlePost(context.request, context.env as Env);
  } catch (error) {
    return errorResponse(
      "管理操作失败",
      500,
      "ADMIN_ACTION_FAILED",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
};

export const onRequestGet: PagesHandler = async (context) => {
  const authError = requireAdmin(context.request, context.env as Env);
  if (authError) return authError;
  const bucketError = requireBucket(context.env as Env);
  if (bucketError) return bucketError;
  try {
    return await session(context.env as Env);
  } catch (error) {
    return errorResponse(
      "无法读取管理数据",
      500,
      "SESSION_FAILED",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
};
