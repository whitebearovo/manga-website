import type { Chapter, LibraryData, MangaSeries, ReadingProgress } from "../types";

const PROGRESS_PREFIX = "yoru:progress:";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function formatChapter(number: number) {
  return String(number).padStart(2, "0");
}

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options,
  }).format(date);
}

export function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = Date.now() - date.getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return formatDate(value, { year: undefined });
}

export function getLatestChapter(series: MangaSeries): Chapter | undefined {
  return [...series.chapters].sort((a, b) => b.number - a.number)[0];
}

export function getSortedChapters(series: MangaSeries) {
  return [...series.chapters].sort((a, b) => a.number - b.number);
}

export function totalPages(series: MangaSeries) {
  return series.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0);
}

export function assetUrl(path: string, baseUrl?: string) {
  if (!path) return "";
  if (/^(https?:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  const base = (baseUrl || "").replace(/\/$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return `${base}/${cleanPath.split("/").map(encodeURIComponent).join("/")}`;
}

export function normalizeLibrary(input: LibraryData): LibraryData {
  return {
    ...input,
    series: [...(input.series || [])]
      .map((series) => ({
        ...series,
        genres: series.genres || [],
        accent: series.accent || "#d94b35",
        chapters: [...(series.chapters || [])]
          .map((chapter) => ({
            ...chapter,
            pages: [...(chapter.pages || [])],
          }))
          .sort((a, b) => a.number - b.number),
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  };
}

export function readProgress(seriesId: string): ReadingProgress | null {
  try {
    const raw = localStorage.getItem(`${PROGRESS_PREFIX}${seriesId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReadingProgress;
    if (!parsed.chapterId || typeof parsed.pageIndex !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeProgress(progress: ReadingProgress) {
  try {
    localStorage.setItem(`${PROGRESS_PREFIX}${progress.seriesId}`, JSON.stringify(progress));
    window.dispatchEvent(new CustomEvent("yoru:progress", { detail: progress }));
  } catch {
    // Reading still works when storage is unavailable.
  }
}

export function readingPercent(progress: ReadingProgress | null) {
  if (!progress || !progress.totalPages) return 0;
  return Math.min(100, Math.round(((progress.pageIndex + 1) / progress.totalPages) * 100));
}

export function displayAuthor(series: MangaSeries) {
  if (series.artist && series.artist !== series.author) {
    return `${series.author} / ${series.artist}`;
  }
  return series.author || "未署名";
}
