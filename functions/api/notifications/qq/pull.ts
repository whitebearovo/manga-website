import {
  errorResponse,
  readLibrary,
  requireBucket,
  type Env,
  type PagesHandler,
} from "../../../_lib";
import {
  apiJson,
  apiOptions,
  buildQQUpdateBatch,
  buildUpdateItems,
  filterUpdatesSince,
  parseSince,
  readQQNotificationState,
  requireUpdateApiToken,
  signaturesOf,
  withApiCors,
  writeQQNotificationState,
} from "../../../_updates";

type Payload = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown) {
  return value === true || value === "true" || value === "1";
}

async function parsePayload(request: Request): Promise<Payload> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("请求体必须是 JSON 对象");
  }
  return parsed as Payload;
}

export const onRequestPost: PagesHandler = async (context) => {
  const env = context.env as Env;
  const authError = requireUpdateApiToken(context.request, env);
  if (authError) return withApiCors(authError);
  const bucketError = requireBucket(env);
  if (bucketError) return withApiCors(bucketError);

  let payload: Payload;
  try {
    payload = await parsePayload(context.request);
  } catch (error) {
    return withApiCors(
      errorResponse(
        error instanceof Error ? error.message : "请求体解析失败",
        400,
        "INVALID_JSON",
      ),
    );
  }

  let since: string | null;
  try {
    since = parseSince(payload.since);
  } catch (error) {
    return withApiCors(
      errorResponse(
        error instanceof Error ? error.message : "since 参数无效",
        422,
        "INVALID_SINCE",
      ),
    );
  }

  const seriesId = text(payload.seriesId);
  const force = bool(payload.force);

  try {
    const library = await readLibrary(env.MANGA_BUCKET);
    const allItems = buildUpdateItems(library, env, context.request.url);
    const currentItems = allItems.filter((item) => !seriesId || item.seriesId === seriesId);
    const state = await readQQNotificationState(env.MANGA_BUCKET);

    if (!state && !since && !force) {
      await writeQQNotificationState(env.MANGA_BUCKET, allItems);
      return apiJson({
        ok: true,
        hasUpdates: false,
        reason: "baseline-created",
        stateUpdated: true,
        checkedSeries: currentItems.length,
        message: "已建立首次通知基准，后续最新章节变化会由 pull 接口返回。",
      });
    }

    let updates = currentItems;
    if (since) {
      updates = filterUpdatesSince(currentItems, since);
    } else if (!force && state) {
      updates = currentItems.filter(
        (item) => state.signatures[item.seriesId] !== item.latestChapter.id,
      );
    }

    if (!updates.length) {
      return apiJson({
        ok: true,
        hasUpdates: false,
        reason: "no-updates",
        checkedSeries: currentItems.length,
        since,
        force,
      });
    }

    const batch = buildQQUpdateBatch(updates, env, context.request.url);
    return apiJson({
      ok: true,
      hasUpdates: true,
      requiresAck: true,
      checkedSeries: currentItems.length,
      batch,
      signatures: signaturesOf(updates),
      message: "请先通过 QQ WebSocket 发送 batch.text，成功后再调用 ack 接口。",
    });
  } catch (error) {
    return withApiCors(
      errorResponse(
        "拉取 QQ 更新批次失败",
        500,
        "QQ_PULL_FAILED",
        error instanceof Error ? error.message : "Unknown error",
      ),
    );
  }
};

export const onRequestOptions: PagesHandler = () => apiOptions();
