import { useEffect, useState } from "react";
import { getCachedImage } from "../lib/imagePreloader";

export type ProgressiveImageProgress = {
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
};

type ProgressiveImageState = {
  requestKey: string;
  sourceUrl: string;
  displayUrl: string;
  progress: ProgressiveImageProgress | null;
};

function requestKeyOf(sourceUrl: string, streamUrl: string, reloadToken: number) {
  return `${sourceUrl}\u0000${streamUrl}\u0000${reloadToken}`;
}

function percentOf(loadedBytes: number, totalBytes: number | null) {
  if (!totalBytes) return null;
  return Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
}

export function useProgressiveImage(
  sourceUrl: string,
  streamUrl: string,
  reloadToken = 0,
) {
  const [state, setState] = useState<ProgressiveImageState | null>(null);
  const requestKey = requestKeyOf(sourceUrl, streamUrl, reloadToken);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let activeObjectUrl: string | null = null;

    if (!sourceUrl) {
      setState(null);
      return () => controller.abort();
    }

    const cached = getCachedImage(sourceUrl);
    if (cached?.complete && cached.naturalWidth > 0) {
      setState({
        requestKey,
        sourceUrl,
        displayUrl: sourceUrl,
        progress: {
          loadedBytes: 0,
          totalBytes: null,
          percent: 100,
        },
      });
      return () => controller.abort();
    }

    setState({
      requestKey,
      sourceUrl,
      displayUrl: "",
      progress: {
        loadedBytes: 0,
        totalBytes: null,
        percent: null,
      },
    });

    const load = async () => {
      try {
        if (!streamUrl) throw new Error("No image stream URL");

        const response = await fetch(streamUrl, {
          cache: "force-cache",
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !response.body || !contentType.startsWith("image/")) {
          throw new Error("Image stream unavailable");
        }

        const contentLength = Number(response.headers.get("content-length"));
        const totalBytes = Number.isFinite(contentLength) && contentLength > 0
          ? contentLength
          : null;
        const chunks: ArrayBuffer[] = [];
        const reader = response.body.getReader();
        let loadedBytes = 0;

        if (!disposed) {
          setState({
            requestKey,
            sourceUrl,
            displayUrl: "",
            progress: {
              loadedBytes,
              totalBytes,
              percent: percentOf(loadedBytes, totalBytes),
            },
          });
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done || disposed) break;

          const chunk = new Uint8Array(value.byteLength);
          chunk.set(value);
          chunks.push(chunk.buffer);
          loadedBytes += value.byteLength;
          setState({
            requestKey,
            sourceUrl,
            displayUrl: "",
            progress: {
              loadedBytes,
              totalBytes,
              percent: percentOf(loadedBytes, totalBytes),
            },
          });
        }

        if (disposed) return;

        const blob = new Blob(chunks, { type: contentType });
        activeObjectUrl = URL.createObjectURL(blob);
        setState({
          requestKey,
          sourceUrl,
          displayUrl: activeObjectUrl,
          progress: {
            loadedBytes,
            totalBytes: totalBytes || loadedBytes,
            percent: 100,
          },
        });
      } catch {
        if (disposed || controller.signal.aborted) return;
        setState({
          requestKey,
          sourceUrl,
          displayUrl: sourceUrl,
          progress: null,
        });
      }
    };

    void load();

    return () => {
      disposed = true;
      controller.abort();
      if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
      }
    };
  }, [reloadToken, sourceUrl, streamUrl]);

  const activeState = state?.requestKey === requestKey ? state : null;
  return {
    displayUrl: activeState?.displayUrl || "",
    progress: activeState?.progress || null,
  };
}
