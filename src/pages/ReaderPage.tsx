import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Columns2,
  Expand,
  List,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Rows3,
  Settings2,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorState, LoadingState } from "../components/LoadingState";
import { useLibrary } from "../hooks/useLibrary";
import { preloadImages } from "../lib/imagePreloader";
import type { ImagePreloadProgress } from "../lib/imagePreloader";
import {
  assetUrl,
  cn,
  getSortedChapters,
  readProgress,
  writeProgress,
} from "../lib/utils";
import type { Chapter, LibraryData, MangaSeries } from "../types";

type ReaderMode = "single" | "continuous";
type FitMode = "height" | "width";

type PreloadProgressState = ImagePreloadProgress & {
  status: "loading" | "done";
};

type NetworkInformationLike = {
  saveData?: boolean;
  effectiveType?: string;
};

function getPreloadPlan() {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (connection?.saveData) return { behind: 0, ahead: 1, adjacentChapter: 0 };
  if (connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") {
    return { behind: 0, ahead: 2, adjacentChapter: 1 };
  }
  if (deviceMemory && deviceMemory <= 4) return { behind: 1, ahead: 3, adjacentChapter: 1 };
  return { behind: 1, ahead: 6, adjacentChapter: 2 };
}

export function ReaderPage() {
  const { seriesId, chapterNumber } = useParams();
  const { library, loading, error, reload } = useLibrary();

  if (loading) return <LoadingState label="正在准备这一话" />;
  if (error || !library) {
    return (
      <div className="reader-error-wrap">
        <ErrorState message={error || "无法读取漫画数据"} retry={() => void reload()} />
      </div>
    );
  }

  const series = library.series.find((item) => item.id === seriesId);
  const requestedChapterNumber = chapterNumber?.trim() ? Number(chapterNumber) : Number.NaN;
  const chapter = Number.isFinite(requestedChapterNumber)
    ? series?.chapters.find((item) => item.number === requestedChapterNumber)
    : undefined;
  if (!series || !chapter) {
    return (
      <div className="reader-missing">
        <span>CHAPTER NOT FOUND</span>
        <h1>这一话还没有装订进来。</h1>
        <Link className="button button--paper" to={series ? `/series/${series.id}` : "/"}>
          返回章节列表
        </Link>
      </div>
    );
  }

  return <ReaderExperience library={library} series={series} chapter={chapter} />;
}

function ReaderExperience({
  library,
  series,
  chapter,
}: {
  library: LibraryData;
  series: MangaSeries;
  chapter: Chapter;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const chapters = useMemo(() => getSortedChapters(series), [series]);
  const chapterIndex = chapters.findIndex((item) => item.id === chapter.id);
  const previousChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null;
  const nextChapter = chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : null;
  const initialProgress = readProgress(series.id);
  const requestedPage = Number(searchParams.get("page") || "1") - 1;
  const initialPage =
    Number.isFinite(requestedPage) && requestedPage >= 0
      ? Math.min(requestedPage, chapter.pages.length - 1)
      : initialProgress?.chapterId === chapter.id
        ? Math.min(initialProgress.pageIndex, chapter.pages.length - 1)
        : 0;

  const [pageIndex, setPageIndex] = useState(initialPage);
  const [mode, setMode] = useState<ReaderMode>(() => {
    const saved = localStorage.getItem("yoru:reader-mode");
    return saved === "continuous" ? "continuous" : "single";
  });
  const [fitMode, setFitMode] = useState<FitMode>(() => {
    const saved = localStorage.getItem("yoru:reader-fit");
    return saved === "width" ? "width" : "height";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [continuousTarget, setContinuousTarget] = useState<number | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState<PreloadProgressState | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [endCardVisible, setEndCardVisible] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const continuousObserver = useRef<IntersectionObserver | null>(null);
  const pendingScrollIndex = useRef<number | null>(null);

  const pageUrl = assetUrl(chapter.pages[pageIndex] || "", library.assetBaseUrl);
  const pageLabel = `${chapter.pages.length} 页`;
  const preloadPercent = preloadProgress?.total
    ? Math.round((preloadProgress.completed / preloadProgress.total) * 100)
    : 0;

  const goToPage = useCallback(
    (nextPage: number, replace = true) => {
      const clamped = Math.max(0, Math.min(nextPage, chapter.pages.length - 1));
      setPageIndex(clamped);
      setImageLoading(true);
      setImageFailed(false);
      setSearchParams({ page: String(clamped + 1) }, { replace });
    },
    [chapter.pages.length, setSearchParams],
  );

  useEffect(() => {
    setPageIndex(initialPage);
    setImageLoading(true);
    setImageFailed(false);
    setEndCardVisible(false);
  }, [chapter.id, initialPage]);

  useEffect(() => {
    if (mode !== "single") return;
    const current = imageRef.current;
    if (current?.complete && current.naturalWidth) setImageLoading(false);
  }, [chapter.pages, library.assetBaseUrl, mode, pageIndex]);

  useEffect(() => {
    const plan = getPreloadPlan();
    const urls: string[] = [];
    const start = Math.max(0, pageIndex - plan.behind);
    const end = Math.min(chapter.pages.length - 1, pageIndex + plan.ahead);

    for (let index = start; index <= end; index += 1) {
      if (index !== pageIndex) urls.push(assetUrl(chapter.pages[index], library.assetBaseUrl));
    }

    if (plan.adjacentChapter && nextChapter && pageIndex >= chapter.pages.length - 3) {
      urls.push(
        ...nextChapter.pages
          .slice(0, plan.adjacentChapter)
          .map((key) => assetUrl(key, library.assetBaseUrl)),
      );
    }
    if (plan.adjacentChapter && previousChapter && pageIndex <= 1) {
      urls.push(
        ...previousChapter.pages
          .slice(-plan.adjacentChapter)
          .map((key) => assetUrl(key, library.assetBaseUrl)),
      );
    }

    const uniqueUrls = [...new Set(urls)];
    let cancelled = false;
    setPreloadProgress(
      uniqueUrls.length
        ? { completed: 0, total: uniqueUrls.length, failed: 0, status: "loading" }
        : null,
    );

    const timer = window.setTimeout(() => {
      void preloadImages(uniqueUrls, Math.min(2, plan.ahead), (progress) => {
        if (cancelled) return;
        setPreloadProgress({
          ...progress,
          status: progress.completed >= progress.total ? "done" : "loading",
        });
      });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    chapter.id,
    chapter.pages,
    library.assetBaseUrl,
    nextChapter,
    pageIndex,
    previousChapter,
  ]);

  useEffect(() => {
    if (!chapter.pages.length) return;
    writeProgress({
      seriesId: series.id,
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      pageIndex,
      totalPages: chapter.pages.length,
      updatedAt: new Date().toISOString(),
    });
  }, [chapter.id, chapter.number, chapter.pages.length, pageIndex, series.id]);

  useEffect(() => {
    if (preloadProgress?.status !== "done") return;
    const timer = window.setTimeout(() => setPreloadProgress(null), 2400);
    return () => window.clearTimeout(timer);
  }, [preloadProgress?.status]);

  useEffect(() => {
    if (mode !== "continuous") return;
    continuousObserver.current?.disconnect();
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reader-page]"));
    continuousObserver.current = new IntersectionObserver(
      (entries) => {
        if (pendingScrollIndex.current !== null) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const index = Number((visible.target as HTMLElement).dataset.readerPage);
          if (Number.isFinite(index)) {
            setPageIndex(index);
            setSearchParams({ page: String(index + 1) }, { replace: true });
          }
        }
      },
      { threshold: [0.18, 0.45, 0.7], rootMargin: "-20% 0px -50% 0px" },
    );
    nodes.forEach((node) => continuousObserver.current?.observe(node));
    return () => continuousObserver.current?.disconnect();
  }, [mode, chapter.id, setSearchParams]);

  useEffect(() => {
    if (mode !== "continuous" || continuousTarget === null) return;
    let cancelled = false;
    let timeoutId = 0;
    const images = Array.from(document.querySelectorAll<HTMLImageElement>("[data-reader-page] img"))
      .slice(0, continuousTarget + 1);
    const imageReady = images.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    });
    const imagesSettled = Promise.all(imageReady);
    const fallback = new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(resolve, 1800);
    });
    void Promise.race([imagesSettled, fallback]).then(() => {
      if (cancelled) return;
      document
        .querySelector<HTMLElement>(`[data-reader-page="${continuousTarget}"]`)
        ?.scrollIntoView({ block: "start" });
      setPageIndex(continuousTarget);
      setSearchParams({ page: String(continuousTarget + 1) }, { replace: true });
      pendingScrollIndex.current = null;
      setContinuousTarget(null);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [chapter.id, continuousTarget, mode, setSearchParams]);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen is optional and may be blocked by the browser.
    }
  }, []);

  const changeMode = useCallback((nextMode: ReaderMode) => {
    pendingScrollIndex.current = nextMode === "continuous" ? pageIndex : null;
    setMode(nextMode);
    setContinuousTarget(nextMode === "continuous" ? pageIndex : null);
    localStorage.setItem("yoru:reader-mode", nextMode);
  }, [pageIndex]);

  const changeFit = useCallback((nextFit: FitMode) => {
    setFitMode(nextFit);
    localStorage.setItem("yoru:reader-fit", nextFit);
  }, []);

  const moveNext = useCallback(() => {
    if (pageIndex < chapter.pages.length - 1) goToPage(pageIndex + 1);
    else if (nextChapter) {
      navigate(`/read/${series.id}/${nextChapter.number}`);
      window.scrollTo(0, 0);
    }
  }, [chapter.pages.length, goToPage, navigate, nextChapter, pageIndex, series.id]);

  const movePrevious = useCallback(() => {
    if (pageIndex > 0) goToPage(pageIndex - 1);
    else if (previousChapter) {
      navigate(`/read/${series.id}/${previousChapter.number}?page=${previousChapter.pages.length}`);
    }
  }, [goToPage, navigate, pageIndex, previousChapter, series.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select, button")) return;
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        moveNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        movePrevious();
      } else if (event.key === "Home") {
        event.preventDefault();
        goToPage(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goToPage(chapter.pages.length - 1);
      } else if (event.key.toLowerCase() === "f") {
        void toggleFullscreen();
      } else if (event.key.toLowerCase() === "v") {
        changeMode(mode === "single" ? "continuous" : "single");
      } else if (event.key === "Escape" && !document.fullscreenElement) {
        navigate(`/series/${series.id}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    chapter.pages.length,
    changeMode,
    goToPage,
    mode,
    moveNext,
    movePrevious,
    navigate,
    series.id,
    toggleFullscreen,
  ]);

  return (
    <div className={cn("reader-shell", mode === "continuous" && "reader-shell--continuous")}>
      <header className="reader-toolbar">
        <div className="reader-toolbar__left">
          <Link className="reader-icon-button" to={`/series/${series.id}`} aria-label="返回作品详情">
            <ArrowLeft size={19} />
          </Link>
          <div className="reader-title">
            <strong>{series.title}</strong>
            <span>第 {String(chapter.number).padStart(2, "0")} 话 · {chapter.title}</span>
          </div>
        </div>

        <div className="reader-toolbar__center">
          <div className="reader-mode-switch" role="group" aria-label="阅读模式">
            <button
              type="button"
              className={cn(mode === "single" && "is-active")}
              onClick={() => changeMode("single")}
              title="单页模式"
            >
              <Columns2 size={16} /> <span>单页</span>
            </button>
            <button
              type="button"
              className={cn(mode === "continuous" && "is-active")}
              onClick={() => changeMode("continuous")}
              title="条漫模式"
            >
              <Rows3 size={16} /> <span>条漫</span>
            </button>
          </div>
        </div>

        <div className="reader-toolbar__right">
          <div className="reader-chapter-select">
            <select
              value={chapter.number}
              aria-label="切换章节"
              onChange={(event) => navigate(`/read/${series.id}/${event.target.value}`)}
            >
              {chapters.map((item) => (
                <option key={item.id} value={item.number}>
                  第 {String(item.number).padStart(2, "0")} 话 · {item.title}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <button
            type="button"
            className="reader-icon-button reader-settings-trigger"
            onClick={() => setSettingsOpen((value) => !value)}
            aria-label="阅读设置"
            aria-expanded={settingsOpen}
          >
            <Settings2 size={18} />
          </button>
          <button
            type="button"
            className="reader-icon-button reader-fullscreen-button"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? "退出全屏" : "全屏阅读"}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </header>

      {settingsOpen && (
        <aside className="reader-settings">
          <div className="reader-settings__head">
            <strong>阅读设置</strong>
            <button type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">
              <X size={17} />
            </button>
          </div>
          <div className="reader-settings__group">
            <span>阅读模式</span>
            <div className="setting-segments">
              <button
                type="button"
                className={cn(mode === "single" && "is-active")}
                onClick={() => {
                  changeMode("single");
                  setSettingsOpen(false);
                }}
              >
                <Columns2 size={15} /> 单页
              </button>
              <button
                type="button"
                className={cn(mode === "continuous" && "is-active")}
                onClick={() => {
                  changeMode("continuous");
                  setSettingsOpen(false);
                }}
              >
                <Rows3 size={15} /> 条漫
              </button>
            </div>
          </div>
          <div className="reader-settings__group">
            <span>画面适配</span>
            <div className="setting-segments">
              <button
                type="button"
                className={cn(fitMode === "height" && "is-active")}
                onClick={() => changeFit("height")}
              >
                <Expand size={15} /> 适合高度
              </button>
              <button
                type="button"
                className={cn(fitMode === "width" && "is-active")}
                onClick={() => changeFit("width")}
              >
                <Columns2 size={15} /> 适合宽度
              </button>
            </div>
          </div>
          <div className="reader-settings__hint">
            <span><kbd>←</kbd><kbd>→</kbd> 翻页</span>
            <span><kbd>V</kbd> 切换模式</span>
            <span><kbd>F</kbd> 全屏</span>
          </div>
        </aside>
      )}

      {preloadProgress && preloadProgress.total > 0 && (
        <div
          className={cn(
            "reader-preload-progress",
            preloadProgress.status === "done" && "is-complete",
          )}
          role="status"
          aria-live="polite"
        >
          <div className="reader-preload-progress__label">
            <span>
              {preloadProgress.status === "done"
                ? preloadProgress.failed > 0
                  ? `预载结束 · ${preloadProgress.failed} 页失败`
                  : "后续页面已就绪"
                : "正在预载后续页面"}
            </span>
            <strong>{preloadProgress.completed} / {preloadProgress.total}</strong>
          </div>
          <div
            className="reader-preload-progress__track"
            role="progressbar"
            aria-label="后续页面预载进度"
            aria-valuemin={0}
            aria-valuemax={preloadProgress.total}
            aria-valuenow={preloadProgress.completed}
            aria-valuetext={`已处理 ${preloadProgress.completed} / ${preloadProgress.total} 页`}
          >
            <span style={{ width: `${preloadPercent}%` }} />
          </div>
        </div>
      )}

      {mode === "single" ? (
        <main
          className={cn("single-reader", fitMode === "width" && "single-reader--fit-width")}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button, a, .reader-controls")) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX - bounds.left > bounds.width / 2) moveNext();
            else movePrevious();
          }}
        >
          <div className="reader-page-stage">
            {imageLoading && !imageFailed && (
              <div className="reader-image-loader" role="status" aria-live="polite">
                <div className="reader-image-loader__label">
                  <LoaderCircle size={21} />
                  <span>正在载入第 {pageIndex + 1} 页</span>
                </div>
                <div className="reader-image-loader__track" aria-hidden="true">
                  <span />
                </div>
              </div>
            )}
            {imageFailed ? (
              <div className="reader-image-error">
                <span>IMAGE NOT FOUND</span>
                <h2>这一页暂时无法载入。</h2>
                <p>{chapter.pages[pageIndex]}</p>
                <button type="button" className="button button--ghost-light" onClick={() => goToPage(pageIndex)}>
                  重试
                </button>
              </div>
            ) : (
              <img
                key={pageUrl}
                ref={imageRef}
                className={cn("reader-page-image", imageLoading && "is-loading")}
                src={pageUrl}
                alt={`${series.title} 第 ${chapter.number} 话第 ${pageIndex + 1} 页`}
                decoding="async"
                fetchPriority="high"
                onLoad={() => setImageLoading(false)}
                onError={() => {
                  setImageLoading(false);
                  setImageFailed(true);
                }}
                draggable={false}
              />
            )}
          </div>
          <button
            type="button"
            className="reader-tap-zone reader-tap-zone--left"
            onClick={(event) => {
              event.stopPropagation();
              movePrevious();
            }}
            aria-label="上一页"
          >
            <ArrowLeft size={20} />
          </button>
          <button
            type="button"
            className="reader-tap-zone reader-tap-zone--right"
            onClick={(event) => {
              event.stopPropagation();
              moveNext();
            }}
            aria-label="下一页"
          >
            <ArrowRight size={20} />
          </button>

          <div className="reader-controls" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={movePrevious} aria-label="上一页">
              <ArrowLeft size={18} />
            </button>
            <span className="reader-page-count">
              <strong>{String(pageIndex + 1).padStart(2, "0")}</strong>
              <i>/</i>
              {String(chapter.pages.length).padStart(2, "0")}
            </span>
            <input
              className="reader-slider"
              type="range"
              min={1}
              max={Math.max(1, chapter.pages.length)}
              value={pageIndex + 1}
              aria-label="页码"
              onChange={(event) => goToPage(Number(event.target.value) - 1)}
              style={{ "--progress": `${((pageIndex + 1) / chapter.pages.length) * 100}%` } as React.CSSProperties}
            />
            <span className="reader-page-total">{pageLabel}</span>
            <button
              type="button"
              onClick={moveNext}
              aria-label={pageIndex === chapter.pages.length - 1 ? "下一话" : "下一页"}
            >
              {pageIndex === chapter.pages.length - 1 && nextChapter ? <List size={18} /> : <ArrowRight size={18} />}
            </button>
          </div>
          <div className="reader-progress-line">
            <span style={{ width: `${((pageIndex + 1) / chapter.pages.length) * 100}%` }} />
          </div>
        </main>
      ) : (
        <main className="continuous-reader">
          <div className="continuous-reader__inner">
            {chapter.pages.map((key, index) => (
              <div className="continuous-page" key={key} data-reader-page={index}>
                <img
                  src={assetUrl(key, library.assetBaseUrl)}
                  alt={`${series.title} 第 ${chapter.number} 话第 ${index + 1} 页`}
                  loading={
                    (continuousTarget !== null && index <= continuousTarget) || index <= pageIndex + 2
                      ? "eager"
                      : "lazy"
                  }
                  decoding="async"
                  fetchPriority={index === pageIndex ? "high" : "auto"}
                  draggable={false}
                />
              </div>
            ))}
          </div>
          <div className="chapter-end-card" onMouseEnter={() => setEndCardVisible(true)}>
            <span className="chapter-end-card__eyebrow">END OF CHAPTER</span>
            <h2>
              第 {String(chapter.number).padStart(2, "0")} 话
              <br />阅读完毕。
            </h2>
            <div className="chapter-end-card__actions">
              {nextChapter ? (
                <Link className="button button--paper" to={`/read/${series.id}/${nextChapter.number}`}>
                  继续第 {String(nextChapter.number).padStart(2, "0")} 话 <ArrowRight size={16} />
                </Link>
              ) : (
                <Link className="button button--paper" to={`/series/${series.id}`}>
                  返回章节列表 <List size={16} />
                </Link>
              )}
              <Link className="button button--ghost-light" to={`/series/${series.id}`}>
                作品详情
              </Link>
            </div>
            <span className="chapter-end-card__hint">{endCardVisible ? "谢谢阅读" : "YORU / 夜页"}</span>
          </div>
        </main>
      )}

      <div className="reader-mobile-footer">
        <button type="button" onClick={movePrevious} aria-label="上一页">
          <ArrowLeft size={18} />
        </button>
        <input
          className="reader-slider"
          type="range"
          min={1}
          max={Math.max(1, chapter.pages.length)}
          value={pageIndex + 1}
          aria-label="页码"
          onChange={(event) => goToPage(Number(event.target.value) - 1)}
          style={{ "--progress": `${((pageIndex + 1) / chapter.pages.length) * 100}%` } as React.CSSProperties}
        />
        <span>{pageIndex + 1} / {chapter.pages.length}</span>
        <button type="button" onClick={moveNext} aria-label="下一页">
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
