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
  buildUpdateItems,
  readQQNotificationState,
  requireUpdateApiToken,
  withApiCors,
  writeQQNotificationSignatures,
} from "../../../_updates";

type Payload = Record<string, unknown>;

async function parsePayload(request: Request): Promise<Payload> {
  const raw = await request.text();
  if (!raw.trim()) throw new Error("请求体不能为空");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("请求体必须是 JSON 对象");
  }
  return parsed as Payload;
}

function parseSignatures(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("signatures 必须是作品 ID 到章节 ID 的对象");
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()),
  );
  if (!entries.length) throw new Error("signatures 不能为空");
  return Object.fromEntries(entries.map(([seriesId, chapterId]) => [seriesId, chapterId.trim()]));
}

export const onRequestPost: PagesHandler = async (context) => {
  const env = context.env as Env;
  const authError = requireUpdateApiToken(context.request, env);
  if (authError) return withApiCors(authError);
  const bucketError = requireBucket(env);
  if (bucketError) return withApiCors(bucketError);

  let payload: Payload;
  let requested: Record<string, string>;
  try {
    payload = await parsePayload(context.request);
    requested = parseSignatures(payload.signatures);
  } catch (error) {
    return withApiCors(
      errorResponse(
        error instanceof Error ? error.message : "ACK 请求无效",
        400,
        "INVALID_ACK",
      ),
    );
  }

  try {
    const library = await readLibrary(env.MANGA_BUCKET);
    const currentItems = buildUpdateItems(library, env, context.request.url);
    const currentSignatures = Object.fromEntries(
      currentItems.map((item) => [item.seriesId, item.latestChapter.id]),
    ) as Record<string, string>;
    const state = await readQQNotificationState(env.MANGA_BUCKET);
    const nextSignatures = Object.fromEntries(
      Object.entries(state?.signatures || {}).filter(([seriesId]) =>
        Boolean(currentSignatures[seriesId]),
      ),
    ) as Record<string, string>;
    const acked: Record<string, string> = {};
    const ignored: Array<{ seriesId: string; reason: string }> = [];

    for (const [seriesId, chapterId] of Object.entries(requested)) {
      if (!currentSignatures[seriesId]) {
        ignored.push({ seriesId, reason: "series-not-found" });
      } else if (currentSignatures[seriesId] !== chapterId) {
        ignored.push({ seriesId, reason: "chapter-changed" });
      } else {
        nextSignatures[seriesId] = chapterId;
        acked[seriesId] = chapterId;
      }
    }

    const ackedCount = Object.keys(acked).length;
    if (ackedCount > 0) {
      await writeQQNotificationSignatures(env.MANGA_BUCKET, nextSignatures);
    }

    return apiJson({
      ok: true,
      acked,
      ignored,
      ackedCount,
      message:
        ackedCount > 0
          ? "通知状态已确认，后续 pull 不会重复返回这些章节。"
          : "没有可确认的章节；最新章节可能已在拉取后再次变化。",
    });
  } catch (error) {
    return withApiCors(
      errorResponse(
        "确认 QQ 更新失败",
        500,
        "QQ_ACK_FAILED",
        error instanceof Error ? error.message : "Unknown error",
      ),
    );
  }
};

export const onRequestOptions: PagesHandler = () => apiOptions();
