import {
  constantTimeEqual,
  errorResponse,
  readLibrary,
  requireBucket,
  type Env,
  type PagesHandler,
} from "../../_lib";
import {
  apiJson,
  apiOptions,
  buildQQEvent,
  buildUpdateItems,
  parseSince,
  readQQNotificationState,
  signaturesOf,
  withApiCors,
  writeQQNotificationState,
} from "../../_updates";

type Payload = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown) {
  return value === true || value === "true" || value === "1";
}

function requireUpdateToken(request: Request, env: Env) {
  const expected = text(env.UPDATE_API_TOKEN) || text(env.ADMIN_TOKEN);
  if (!expected) {
    return errorResponse(
      "服务端尚未设置 UPDATE_API_TOKEN 或 ADMIN_TOKEN",
      503,
      "UPDATE_TOKEN_MISSING",
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const provided = bearer || (request.headers.get("x-webhook-token") || "").trim();
  if (!provided || !constantTimeEqual(provided, expected)) {
    return errorResponse("更新推送口令不正确", 401, "UNAUTHORIZED");
  }
  return null;
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

function validWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export const onRequestPost: PagesHandler = async (context) => {
  const env = context.env as Env;
  const authError = requireUpdateToken(context.request, env);
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
  const dryRun = bool(payload.dryRun);

  try {
    const library = await readLibrary(env.MANGA_BUCKET);
    const allItems = buildUpdateItems(library, env, context.request.url);
    const currentItems = allItems.filter((item) => !seriesId || item.seriesId === seriesId);
    const state = await readQQNotificationState(env.MANGA_BUCKET);
    let updates = currentItems;

    if (since) {
      updates = currentItems.filter(
        (item) => new Date(item.updatedAt).getTime() > new Date(since).getTime(),
      );
    } else if (!force) {
      if (!state) {
        const stateUpdated = !dryRun;
        if (stateUpdated) await writeQQNotificationState(env.MANGA_BUCKET, allItems);
        return apiJson({
          ok: true,
          sent: false,
          reason: "baseline-created",
          stateUpdated,
          checkedSeries: currentItems.length,
          message: stateUpdated
            ? "已建立首次通知基准，后续章节更新才会推送。"
            : "当前尚无通知基准；dryRun 未写入 R2。",
        });
      }

      updates = currentItems.filter(
        (item) => state.signatures[item.seriesId] !== item.latestChapter.id,
      );
    }

    if (!updates.length) {
      return apiJson({
        ok: true,
        sent: false,
        reason: "no-updates",
        checkedSeries: currentItems.length,
        since,
        force,
      });
    }

    const event = buildQQEvent(updates, env, context.request.url);
    if (dryRun) {
      return apiJson({
        ok: true,
        sent: false,
        dryRun: true,
        stateUpdated: false,
        event,
      });
    }

    if (!text(env.QQ_BOT_WEBHOOK_URL)) {
      return withApiCors(
        errorResponse(
          "服务端尚未设置 QQ_BOT_WEBHOOK_URL",
          503,
          "QQ_WEBHOOK_MISSING",
        ),
      );
    }
    const webhookUrl = validWebhookUrl(text(env.QQ_BOT_WEBHOOK_URL));
    if (!webhookUrl) {
      return withApiCors(
        errorResponse(
          "QQ_BOT_WEBHOOK_URL 必须是有效的 http 或 https 地址",
          503,
          "QQ_WEBHOOK_INVALID",
        ),
      );
    }

    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "user-agent": "Yoru-Manga-Notifier/1.0",
      "x-yoru-event": event.event,
    });
    const webhookToken = text(env.QQ_BOT_WEBHOOK_TOKEN);
    if (webhookToken) headers.set("authorization", `Bearer ${webhookToken}`);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      return withApiCors(
        errorResponse(
          "QQ Bot Webhook 推送失败",
          502,
          "QQ_WEBHOOK_FAILED",
          `HTTP ${response.status}${details ? `: ${details}` : ""}`,
        ),
      );
    }

    const stateUpdated = await writeQQNotificationState(
      env.MANGA_BUCKET,
      allItems,
    );
    return apiJson({
      ok: true,
      sent: true,
      webhookStatus: response.status,
      notifiedAt: stateUpdated.notifiedAt,
      checkedSeries: currentItems.length,
      notifiedSeries: updates.length,
      signatures: signaturesOf(updates),
      event,
    });
  } catch (error) {
    return withApiCors(
      errorResponse(
        "QQ Bot 更新提醒失败",
        500,
        "QQ_NOTIFY_FAILED",
        error instanceof Error ? error.message : "Unknown error",
      ),
    );
  }
};

export const onRequestOptions: PagesHandler = () => apiOptions();
