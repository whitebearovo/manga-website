export type MangaStatus = "连载中" | "已完结" | "休载中";

export interface Chapter {
  id: string;
  number: number;
  title: string;
  directory: string;
  pages: string[];
  publishedAt: string;
}

export interface MangaSeries {
  id: string;
  title: string;
  originalTitle?: string;
  author: string;
  artist?: string;
  description: string;
  status: MangaStatus;
  genres: string[];
  coverKey: string;
  accent: string;
  createdAt: string;
  updatedAt: string;
  chapters: Chapter[];
}

export interface LibraryData {
  version: number;
  updatedAt: string;
  series: MangaSeries[];
  assetBaseUrl?: string;
  mode?: "r2" | "demo";
}

export interface ReadingProgress {
  seriesId: string;
  chapterId: string;
  chapterNumber: number;
  pageIndex: number;
  totalPages: number;
  updatedAt: string;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: string;
}
