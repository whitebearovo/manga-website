import {
  contentTypeForKey,
  errorResponse,
  normalizeKey,
  requireBucket,
  type Env,
  type PagesHandler,
} from "../../_lib";

export const onRequestGet: PagesHandler = async (context) => {
  const bucketError = requireBucket(context.env as Env);
  if (bucketError) return bucketError;

  const pathParam = context.params.path;
  const rawPath = Array.isArray(pathParam) ? pathParam.join("/") : String(pathParam || "");
  const key = normalizeKey(decodeURIComponent(rawPath));
  if (!key) return errorResponse("缺少图片路径", 400, "PATH_MISSING");

  const object = await (context.env as Env).MANGA_BUCKET.get(key);
  if (!object) return errorResponse("图片不存在", 404, "IMAGE_NOT_FOUND");

  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType || contentTypeForKey(key));
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("content-disposition", "inline");
  headers.set("content-length", String(object.size));
  return new Response(object.body as unknown as BodyInit, { headers });
};

export const onRequestHead: PagesHandler = async (context) => {
  const bucketError = requireBucket(context.env as Env);
  if (bucketError) return bucketError;

  const pathParam = context.params.path;
  const rawPath = Array.isArray(pathParam) ? pathParam.join("/") : String(pathParam || "");
  const key = normalizeKey(decodeURIComponent(rawPath));
  const object = await (context.env as Env).MANGA_BUCKET.head(key);
  if (!object) return new Response(null, { status: 404 });

  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType || contentTypeForKey(key));
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("content-length", String(object.size));
  return new Response(null, { headers });
};
