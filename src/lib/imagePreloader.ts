const MAX_CACHED_IMAGES = 8;
const imageCache = new Map<string, HTMLImageElement>();

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

export function preloadImages(urls: string[], highPriorityCount = 2) {
  urls.forEach((url, index) => {
    preloadImage(url, index < highPriorityCount ? "high" : "low");
  });
}
