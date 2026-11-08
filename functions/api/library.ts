import {
  enrichLibrary,
  errorResponse,
  json,
  readLibrary,
  requireBucket,
  type Env,
  type PagesHandler,
} from "../_lib";

export const onRequestGet: PagesHandler = async (context) => {
  const env = context.env as Env;
  const bucketError = requireBucket(env);
  if (bucketError) return bucketError;

  try {
    const library = await readLibrary(env.MANGA_BUCKET);
    return json(enrichLibrary(library, env));
  } catch (error) {
    return errorResponse(
      "读取漫画索引失败",
      500,
      "LIBRARY_READ_FAILED",
      error instanceof Error ? error.message : "Unknown R2 error",
    );
  }
};
