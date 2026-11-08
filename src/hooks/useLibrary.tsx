import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LibraryData } from "../types";
import { normalizeLibrary } from "../lib/utils";

interface LibraryContextValue {
  library: LibraryData | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

async function fetchLibrary() {
  let apiMessage = "";
  try {
    const response = await fetch("/api/library", { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as LibraryData;
      return normalizeLibrary({ ...data, mode: data.mode || "r2" });
    }
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    apiMessage = payload?.error || `API ${response.status}`;
  } catch {
    apiMessage = "API 暂时无法访问";
  }

  const fallback = await fetch("/demo-library.json", { cache: "no-store" });
  if (!fallback.ok) throw new Error(apiMessage || "无法读取漫画数据");
  const demo = (await fallback.json()) as LibraryData;
  return normalizeLibrary({ ...demo, mode: "demo" });
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLibrary(await fetchLibrary());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取漫画数据");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(
    () => ({ library, loading, error, reload }),
    [library, loading, error, reload],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error("useLibrary must be used inside LibraryProvider");
  return context;
}
