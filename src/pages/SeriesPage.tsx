import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Play,
  Share2,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { CoverArt } from "../components/CoverArt";
import { ErrorState, LoadingState } from "../components/LoadingState";
import { useLibrary } from "../hooks/useLibrary";
import {
  assetUrl,
  displayAuthor,
  formatChapter,
  formatDate,
  getLatestChapter,
  getSortedChapters,
  readProgress,
  readingPercent,
  totalPages,
} from "../lib/utils";
import type { ReadingProgress } from "../types";

export function SeriesPage() {
  const { seriesId } = useParams();
  const { library, loading, error, reload } = useLibrary();
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [copied, setCopied] = useState(false);

  const series = library?.series.find((item) => item.id === seriesId);

  useEffect(() => {
    if (!series) return;
    const sync = () => setProgress(readProgress(series.id));
    sync();
    window.addEventListener("yoru:progress", sync);
    return () => window.removeEventListener("yoru:progress", sync);
  }, [series]);

  if (loading) return <LoadingState />;
  if (error || !library) {
    return <ErrorState message={error || "无法读取漫画数据"} retry={() => void reload()} />;
  }
  if (!series) {
    return (
      <div className="not-found page-width">
        <span className="eyebrow">404 / SERIES NOT FOUND</span>
        <h1>这本书不在书架上。</h1>
        <Link className="button button--ink" to="/">
          返回首页
        </Link>
      </div>
    );
  }

  const chapters = getSortedChapters(series).reverse();
  const latest = getLatestChapter(series);
  const first = getSortedChapters(series)[0];
  const target = progress
    ? `/read/${series.id}/${progress.chapterNumber}?page=${progress.pageIndex + 1}`
    : latest
      ? `/read/${series.id}/${latest.number}`
      : null;

  async function shareSeries() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: series!.title, text: series!.description, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Native share can be cancelled by the user.
    }
  }

  return (
    <div className="series-page" style={{ "--series-accent": series.accent } as React.CSSProperties}>
      <div
        className="series-page__wash"
        style={{ backgroundImage: `url(${assetUrl(series.coverKey, library.assetBaseUrl)})` }}
      />
      <div className="series-hero page-width">
        <Link className="back-link" to="/">
          <ArrowLeft size={16} /> 返回书架
        </Link>
        <div className="series-hero__grid">
          <div className="series-cover-column">
            <CoverArt series={series} baseUrl={library.assetBaseUrl} className="series-cover" priority />
            <div className="series-cover-caption">
              <span>{series.status}</span>
              <span>VOL. {String(Math.max(1, latest?.number || 1)).padStart(2, "0")}</span>
            </div>
          </div>

          <div className="series-info">
            <span className="eyebrow">{series.originalTitle || "YORU SERIES"}</span>
            <h1>{series.title}</h1>
            <p className="series-info__author">{displayAuthor(series)}</p>
            <div className="tag-row">
              {series.genres.map((genre) => (
                <span key={genre}>{genre}</span>
              ))}
            </div>
            <p className="series-info__description">{series.description}</p>
            <dl className="series-facts">
              <div>
                <dt>连载状态</dt>
                <dd>{series.status}</dd>
              </div>
              <div>
                <dt>章节</dt>
                <dd>{series.chapters.length}</dd>
              </div>
              <div>
                <dt>总页数</dt>
                <dd>{totalPages(series)}</dd>
              </div>
              <div>
                <dt>最近更新</dt>
                <dd>{latest ? formatDate(latest.publishedAt) : "—"}</dd>
              </div>
            </dl>
            <div className="series-actions">
              {target ? (
                <Link className="button button--accent" to={target}>
                  <Play size={16} fill="currentColor" />
                  {progress ? "继续阅读" : "开始阅读"}
                </Link>
              ) : (
                <span className="button button--disabled">尚无章节</span>
              )}
              <button type="button" className="button button--ghost" onClick={() => void shareSeries()}>
                <Share2 size={16} />
                {copied ? "链接已复制" : "分享作品"}
              </button>
            </div>
            {progress && (
              <div className="series-progress">
                <div className="series-progress__label">
                  <span>阅读进度</span>
                  <strong>{readingPercent(progress)}%</strong>
                </div>
                <div className="series-progress__bar">
                  <span style={{ width: `${readingPercent(progress)}%` }} />
                </div>
                <small>
                  第 {formatChapter(progress.chapterNumber)} 话 · 第 {progress.pageIndex + 1} 页
                </small>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="chapter-catalog page-width">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              <BookOpen size={14} /> CHAPTER LIST
            </span>
            <h2>章节目录</h2>
          </div>
          <span className="section-count">共 {series.chapters.length} 话</span>
        </div>
        {chapters.length ? (
          <div className="chapter-list">
            {chapters.map((chapter) => (
              <Link
                className="chapter-list__row"
                key={chapter.id}
                to={`/read/${series.id}/${chapter.number}`}
              >
                <span className="chapter-list__number">{formatChapter(chapter.number)}</span>
                <div className="chapter-list__title">
                  <strong>{chapter.title}</strong>
                  <span>
                    <CalendarDays size={13} /> {formatDate(chapter.publishedAt)}
                  </span>
                </div>
                <span className="chapter-list__pages">{chapter.pages.length} 页</span>
                <span className="chapter-list__go">
                  阅读 <ChevronRight size={17} />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted-copy">这本书还没有上传章节。</p>
        )}
      </section>

      <div className="series-end page-width">
        <span className="series-end__line" />
        <p>一页页读到这里，也算和故事并肩走了一段。</p>
        {first && (
          <Link className="text-link" to={`/read/${series.id}/${first.number}`}>
            从第一话重读 <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </div>
  );
}
