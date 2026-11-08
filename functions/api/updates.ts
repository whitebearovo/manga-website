import {
  errorResponse,
  readLibrary,
  requireBucket,
  type Env,
  type PagesHandler,
} from "../_lib";
import {
  apiJson,
  apiOptions,
  buildUpdateItems,
  filterUpdatesSince,
  parseSince,
  withApiCors,
} from "../_updates";

export const onRequestGet: PagesHandler = async (context) => {
  const env = context.env as Env;
  const bucketError = requireBucket(env);
  if (bucketError) return withApiCors(bucketError);

  const url = new URL(context.request.url);
  let since: string | null;
  try {
    since = parseSince(url.searchParams.get("since"));
  } catch (error) {
    return withApiCors(
      errorResponse(
        error instanceof Error ? error.message : "since 参数无效",
        422,
        "INVALID_SINCE",
      ),
    );
  }

  const seriesId = (url.searchParams.get("seriesId") || "").trim();
  const requestedAt = new Date().toISOString();
  try {
    const library = await readLibrary(env.MANGA_BUCKET);
    const allUpdates = buildUpdateItems(library, env, context.request.url).filter(
      (item) => !seriesId || item.seriesId === seriesId,
    );
    const updates = filterUpdatesSince(allUpdates, since);
    const generatedAt = new Date().toISOString();
    const latestUpdateAt = allUpdates[0]?.updatedAt || library.updatedAt;
    const candidateCursor =
      new Date(latestUpdateAt).getTime() > new Date(library.updatedAt).getTime()
        ? latestUpdateAt
        : library.updatedAt;
    const candidateTime = new Date(candidateCursor).getTime();
    const cursor =
      Number.isNaN(candidateTime) || candidateTime > new Date(requestedAt).getTime()
        ? requestedAt
        : candidateCursor;

    return apiJson({
      ok: true,
      generatedAt,
      cursor,
      libraryUpdatedAt: library.updatedAt,
      since,
      seriesId: seriesId || null,
      hasUpdates: updates.length > 0,
      summary: {
        series: library.series.length,
        chapters: library.series.reduce((sum, series) => sum + series.chapters.length, 0),
        matchedSeries: updates.length,
      },
      updates,
    });
  } catch (error) {
    return withApiCors(
      errorResponse(
        "读取漫画更新状态失败",
        500,
        "UPDATE_STATUS_FAILED",
        error instanceof Error ? error.message : "Unknown R2 error",
      ),
    );
  }
};

export const onRequestOptions: PagesHandler = () => apiOptions();
