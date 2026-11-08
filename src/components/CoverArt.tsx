import { useState } from "react";
import type { MangaSeries } from "../types";
import { assetUrl, cn, getLatestChapter } from "../lib/utils";

interface CoverArtProps {
  series: MangaSeries;
  baseUrl?: string;
  className?: string;
  priority?: boolean;
}

export function CoverArt({ series, baseUrl, className, priority }: CoverArtProps) {
  const [failed, setFailed] = useState(false);
  const source = assetUrl(series.coverKey, baseUrl);
  const latest = getLatestChapter(series);

  return (
    <div
      className={cn("cover-art", className, failed && "cover-art--fallback")}
      style={{ "--cover-accent": series.accent } as React.CSSProperties}
    >
      {!failed && source ? (
        <img
          src={source}
          alt={`${series.title} 封面`}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover-art__fallback">
          <span>{series.title.slice(0, 1)}</span>
          <small>{series.originalTitle || "YORU"}</small>
        </div>
      )}
      <div className="cover-art__grain" />
      <div className="cover-art__caption">
        <span>{series.title}</span>
        {latest && <small>CH. {String(latest.number).padStart(2, "0")}</small>}
      </div>
    </div>
  );
}
