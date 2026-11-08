import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock3,
  MoveRight,
  Play,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { CoverArt } from "../components/CoverArt";
import { ErrorState, LoadingState } from "../components/LoadingState";
import { useLibrary } from "../hooks/useLibrary";
import {
  assetUrl,
  displayAuthor,
  formatChapter,
  formatRelativeDate,
  getLatestChapter,
  getSortedChapters,
  readProgress,
  readingPercent,
  totalPages,
} from "../lib/utils";
import type { Chapter, MangaSeries, ReadingProgress } from "../types";

interface ChapterUpdate {
  series: MangaSeries;
  chapter: Chapter;
}

export function HomePage() {
  const { library, loading, error, reload } = useLibrary();
  const [progress, setProgress] = useState<Record<string, ReadingProgress | null>>({});

  useEffect(() => {
    if (!library) return;
    const sync = () => {
      setProgress(
        Object.fromEntries(library.series.map((series) => [series.id, readProgress(series.id)])),
      );
    };
    sync();
    window.addEventListener("yoru:progress", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("yoru:progress", sync);
      window.removeEventListener("storage", sync);
    };
  }, [library]);

  const updates = useMemo<ChapterUpdate[]>(() => {
    if (!library) return [];
    return library.series
      .flatMap((series) => series.chapters.map((chapter) => ({ series, chapter })))
      .sort(
        (a, b) =>
          new Date(b.chapter.publishedAt).getTime() - new Date(a.chapter.publishedAt).getTime(),
      );
  }, [library]);

  if (loading) return <LoadingState />;
  if (error || !library) {
    return <ErrorState message={error || "漫画数据为空"} retry={() => void reload()} />;
  }
  if (!library.series.length) {
    return (
      <div className="empty-library page-width">
        <span className="eyebrow">EMPTY SHELF</span>
        <h1>书架还在等待第一话。</h1>
        <p>连接 R2 后，从管理界面上传章节或扫描已有目录。</p>
        <Link className="button button--ink" to="/admin">
          打开内容管理 <ArrowRight size={16} />
        </Link>
      </div>
    );
  }

  const featured = library.series[0];
  const latest = getLatestChapter(featured);
  const featuredProgress = progress[featured.id];
  const readTarget = featuredProgress
    ? `/read/${featured.id}/${featuredProgress.chapterNumber}?page=${featuredProgress.pageIndex + 1}`
    : latest
      ? `/read/${featured.id}/${latest.number}`
      : `/series/${featured.id}`;
  const readLabel = featuredProgress ? "继续阅读" : "从最新话读起";

  return (
    <div className="home-page">
      <section className="hero" style={{ "--hero-accent": featured.accent } as React.CSSProperties}>
        <div className="hero__noise" />
        <div className="hero__inner page-width">
          <div className="hero__copy">
            <div className="hero__eyebrow">
              <span className="live-dot" />
              {featured.status}
              {latest && <span>最新 · 第 {formatChapter(latest.number)} 话</span>}
            </div>
            <div className="hero__title-wrap">
              <span className="hero__index">NO. 001</span>
              <h1>{featured.title}</h1>
              <p className="hero__original">{featured.originalTitle || "YORU ORIGINAL SERIES"}</p>
            </div>
            <p className="hero__description">{featured.description}</p>
            <div className="hero__meta">
              <span>{displayAuthor(featured)}</span>
              <span>{featured.genres.slice(0, 3).join(" · ")}</span>
            </div>
            <div className="hero__actions">
              <Link className="button button--accent" to={readTarget}>
                <Play size={16} fill="currentColor" />
                {readLabel}
              </Link>
              <Link className="button button--ghost" to={`/series/${featured.id}`}>
                作品详情 <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="hero__footnote">
              <span>UPDATED {latest ? formatRelativeDate(latest.publishedAt) : "TODAY"}</span>
              <span>
                {featured.chapters.length} CHAPTERS / {totalPages(featured)} PAGES
              </span>
            </div>
          </div>

          <div className="hero__visual">
            <div className="hero__vertical-type" aria-hidden="true">
              花 / 信 / LETTERS IN BLOOM
            </div>
            <div className="hero__image-frame">
              <img
                src={assetUrl(featured.coverKey, library.assetBaseUrl)}
                alt={`${featured.title} 封面插画`}
                fetchPriority="high"
              />
              <span className="hero__image-shadow" />
            </div>
            {latest && (
              <Link className="hero__latest-card" to={`/read/${featured.id}/${latest.number}`}>
                <span className="hero__latest-top">
                  <span>最新话</span>
                  <MoveRight size={16} />
                </span>
                <strong>第 {formatChapter(latest.number)} 话</strong>
                <small>{latest.title}</small>
              </Link>
            )}
            <span className="hero__seal" aria-hidden="true">
              夜读
            </span>
          </div>
        </div>
      </section>

      <div className="ticker" aria-hidden="true">
        <div className="ticker__track">
          <span>NEW CHAPTERS</span>
          <i>✦</i>
          <span>花信 · 第 {latest ? formatChapter(latest.number) : "00"} 话</span>
          <i>✦</i>
          <span>READ SLOWLY</span>
          <i>✦</i>
          <span>夜页 YORU</span>
          <i>✦</i>
          <span>NEW CHAPTERS</span>
          <i>✦</i>
          <span>花信 · 第 {latest ? formatChapter(latest.number) : "00"} 话</span>
          <i>✦</i>
        </div>
      </div>

      <div className="page-width home-content">
        {featuredProgress && (
          <section className="continue-panel" aria-label="继续阅读">
            <div
              className="continue-panel__art"
              style={{ backgroundImage: `url(${assetUrl(featured.coverKey, library.assetBaseUrl)})` }}
            />
            <div className="continue-panel__body">
              <span className="eyebrow">
                <BookOpen size={14} /> 回到上次的位置
              </span>
              <h2>{featured.title}</h2>
              <p>
                第 {formatChapter(featuredProgress.chapterNumber)} 话 · 第{" "}
                {featuredProgress.pageIndex + 1} / {featuredProgress.totalPages} 页
              </p>
            </div>
            <div className="continue-panel__progress">
              <span style={{ width: `${readingPercent(featuredProgress)}%` }} />
            </div>
            <Link className="icon-link" to={readTarget} aria-label="继续阅读">
              <ArrowRight size={21} />
            </Link>
          </section>
        )}

        <section className="section shelf-section" id="shelf">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                <Sparkles size={14} /> ON THE SHELF
              </span>
              <h2>正在发光的故事</h2>
            </div>
            <span className="section-count">{String(library.series.length).padStart(2, "0")} SERIES</span>
          </div>
          <div className="series-shelf">
            {library.series.map((series, index) => {
              const seriesLatest = getLatestChapter(series);
              const seriesProgress = progress[series.id];
              return (
                <article className="series-row" key={series.id}>
                  <span className="series-row__number">{String(index + 1).padStart(2, "0")}</span>
                  <Link to={`/series/${series.id}`} className="series-row__cover-wrap">
                    <CoverArt series={series} baseUrl={library.assetBaseUrl} />
                  </Link>
                  <div className="series-row__body">
                    <div className="series-row__kicker">
                      <span>{series.status}</span>
                      <span>{series.genres.join(" / ")}</span>
                    </div>
                    <Link to={`/series/${series.id}`} className="series-row__title-link">
                      <h3>{series.title}</h3>
                      <ArrowUpRight size={20} />
                    </Link>
                    <p>{series.description}</p>
                    <div className="series-row__meta">
                      <span>{displayAuthor(series)}</span>
                      <span>{series.chapters.length} 话</span>
                      <span>{totalPages(series)} 页</span>
                    </div>
                    {seriesProgress && (
                      <div className="mini-progress">
                        <span style={{ width: `${readingPercent(seriesProgress)}%` }} />
                        <small>已读 {readingPercent(seriesProgress)}%</small>
                      </div>
                    )}
                  </div>
                  <div className="series-row__action">
                    <span>最新</span>
                    <strong>{seriesLatest ? `第 ${formatChapter(seriesLatest.number)} 话` : "等待更新"}</strong>
                    {seriesLatest && (
                      <Link
                        className="round-arrow"
                        to={`/read/${series.id}/${seriesLatest.number}`}
                        aria-label="阅读最新章节"
                      >
                        <ArrowRight size={20} />
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="section updates-section" id="chapters">
          <div className="section-heading section-heading--inverse">
            <div>
              <span className="eyebrow">
                <Clock3 size={14} /> RECENTLY UPDATED
              </span>
              <h2>最近更新</h2>
            </div>
            <span className="section-count">{updates.length} CHAPTERS</span>
          </div>
          <div className="chapter-feed">
            {updates.slice(0, 8).map(({ series, chapter }, index) => {
              const chapters = getSortedChapters(series);
              const currentIndex = chapters.findIndex((item) => item.id === chapter.id);
              const previous = currentIndex > 0 ? chapters[currentIndex - 1] : null;
              return (
                <Link
                  className="chapter-feed__row"
                  to={`/read/${series.id}/${chapter.number}`}
                  key={`${series.id}-${chapter.id}`}
                >
                  <span className="chapter-feed__index">{String(index + 1).padStart(2, "0")}</span>
                  <div className="chapter-feed__title">
                    <span>{series.title}</span>
                    <strong>
                      第 {formatChapter(chapter.number)} 话 · {chapter.title}
                    </strong>
                    {previous && <small>接续第 {formatChapter(previous.number)} 话</small>}
                  </div>
                  <span className="chapter-feed__date">{formatRelativeDate(chapter.publishedAt)}</span>
                  <span className="chapter-feed__pages">{chapter.pages.length} P</span>
                  <span className="chapter-feed__arrow">
                    <ArrowRight size={19} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="about-section" id="about">
          <span className="about-section__index">ABOUT / 04</span>
          <div className="about-section__copy">
            <span className="eyebrow">A QUIET PLACE FOR STORIES</span>
            <h2>
              故事不必赶路，<br />一页一页就好。
            </h2>
          </div>
          <div className="about-section__body">
            <p>
              夜页是一间为长故事留下的小小阅读室。没有弹窗和喧嚣，只有干净的画面、顺手的翻页，以及随时可以接上的阅读进度。
            </p>
            <Link className="text-link" to={readTarget}>
              现在开始阅读 <ArrowRight size={15} />
            </Link>
          </div>
          <div className="about-section__stamp" aria-hidden="true">
            YORU
            <br />
            2026
          </div>
        </section>
      </div>
    </div>
  );
}
