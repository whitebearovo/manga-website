const MAX_CACHED_IMAGES = 8;
const imageCache = new Map<string, HTMLImageElement>();

export type ImagePreloadProgress = {
  completed: number;
  total: number;
  failed: number;
};

function touch(url: string, image: HTMLImageElement) {
  imageCache.delete(url);
  imageCache.set(url, image);
}

function trimCache() {
  while (imageCache.size > MAX_CACHED_IMAGES) {
    const oldest = imageCache.keys().next().value;
    if (!oldest) break;
    imageCache.delete(oldest);
  }
}

export function preloadImage(url: string, priority: "high" | "low" = "low") {
  if (!url) return null;

  const cached = imageCache.get(url);
  if (cached) {
    touch(url, cached);
    return cached;
  }

  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = priority;
  image.onload = () => {
    if (typeof image.decode === "function") {
      void image.decode().catch(() => undefined);
    }
  };
  image.onerror = () => {
    if (imageCache.get(url) === image) imageCache.delete(url);
  };
  image.src = url;

  // R2 responses are immutable, so evicted entries stay in the browser HTTP cache.
  imageCache.set(url, image);
  trimCache();
  return image;
}

export function getCachedImage(url: string) {
  const image = imageCache.get(url);
  if (!image) return null;
  touch(url, image);
  return image;
}

function waitForImage(image: HTMLImageElement) {
  return new Promise<boolean>((resolve) => {
    if (image.complete) {
      resolve(image.naturalWidth > 0);
      return;
    }

    const settle = (loaded: boolean) => {
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      resolve(loaded);
    };
    const onLoad = () => settle(true);
    const onError = () => settle(false);

    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
  });
}

export function preloadImages(
  urls: string[],
  highPriorityCount = 2,
  onProgress?: (progress: ImagePreloadProgress) => void,
) {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  const total = uniqueUrls.length;
  let completed = 0;
  let failed = 0;

  onProgress?.({ completed, total, failed });
  if (!total) return Promise.resolve({ completed, total, failed });

  const tasks = uniqueUrls.map((url, index) => {
    const image = preloadImage(url, index < highPriorityCount ? "high" : "low");
    if (!image) {
      completed += 1;
      failed += 1;
      onProgress?.({ completed, total, failed });
      return Promise.resolve(false);
    }

    return waitForImage(image).then((loaded) => {
      completed += 1;
      if (!loaded) failed += 1;
      onProgress?.({ completed, total, failed });
      return loaded;
    });
  });

  return Promise.all(tasks).then(() => ({ completed, total, failed }));
}
