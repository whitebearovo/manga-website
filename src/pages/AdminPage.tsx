import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Cloud,
  CloudUpload,
  Database,
  Eye,
  EyeOff,
  FileImage,
  FolderSearch,
  ImagePlus,
  LayoutDashboard,
  Library,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { CoverArt } from "../components/CoverArt";
import { LoadingState } from "../components/LoadingState";
import {
  assetUrl,
  cn,
  displayAuthor,
  formatChapter,
  formatDate,
  naturalCompare,
} from "../lib/utils";
import type { LibraryData, MangaSeries } from "../types";

type AdminTab = "overview" | "content" | "upload";
type UploadMode = "upload" | "scan";
type ToastState = { tone: "success" | "error"; message: string } | null;

interface SeriesDraft {
  id: string;
  title: string;
  originalTitle: string;
  author: string;
  artist: string;
  description: string;
  status: MangaSeries["status"];
  genres: string;
  accent: string;
  coverKey: string;
}

interface ConfirmState {
  kind: "series" | "chapter";
  id: string;
  title: string;
  chapterId?: string;
}

const TOKEN_KEY = "yoru:admin-token";
const accentSwatches = ["#76583d", "#8b5e3c", "#5f6650", "#6d594a", "#9a6b4f"];

const emptyDraft: SeriesDraft = {
  id: "",
  title: "",
  originalTitle: "",
  author: "",
  artist: "",
  description: "",
  status: "连载中",
  genres: "青春, 日常",
  accent: "#76583d",
  coverKey: "",
};

function draftFromSeries(series: MangaSeries | undefined): SeriesDraft {
  if (!series) return { ...emptyDraft };
  return {
    id: series.id,
    title: series.title,
    originalTitle: series.originalTitle || "",
    author: series.author || "",
    artist: series.artist || "",
    description: series.description || "",
    status: series.status,
    genres: series.genres.join(", "),
    accent: series.accent || "#76583d",
    coverKey: series.coverKey || "",
  };
}

async function parseResponse(response: Response) {
  const data = (await response.json().catch(() => null)) as
    | { error?: string; details?: string; code?: string; [key: string]: unknown }
    | null;
  if (!response.ok) {
    const error = new Error(data?.error || `请求失败（${response.status}）`) as Error & {
      code?: string;
      status?: number;
    };
    error.code = data?.code;
    error.status = response.status;
    throw error;
  }
  if (!data) {
    throw new Error("服务端返回了空响应");
  }
  return data;
}

async function adminJson(token: string, action: string, payload: Record<string, unknown> = {}) {
  const response = await fetch("/api/admin", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
  });
  return parseResponse(response);
}

async function adminForm(
  token: string,
  action: string,
  payload: Record<string, unknown>,
  files: Record<string, File | File[] | null>,
) {
  const form = new FormData();
  form.set("action", action);
  form.set("payload", JSON.stringify(payload));
  Object.entries(files).forEach(([name, value]) => {
    if (Array.isArray(value)) value.forEach((file) => form.append(name, file));
    else if (value) form.set(name, value);
  });
  const response = await fetch("/api/admin", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return parseResponse(response);
}

export function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [draft, setDraft] = useState<SeriesDraft>({ ...emptyDraft });
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [loading, setLoading] = useState(Boolean(token));
  const [busy, setBusy] = useState("");
  const [authError, setAuthError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [deleteObjects, setDeleteObjects] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>("upload");
  const [uploadSeriesId, setUploadSeriesId] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [directory, setDirectory] = useState("");
  const [pageStart, setPageStart] = useState("1");
  const [overwrite, setOverwrite] = useState(false);
  const [renumber, setRenumber] = useState(true);
  const [chapterFiles, setChapterFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSeries = library?.series.find((series) => series.id === selectedSeriesId);
  const filePreviews = useMemo(
    () => chapterFiles.slice(0, 8).map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
    [chapterFiles],
  );
  const firstFilePreview = filePreviews[0]?.url || "";

  useEffect(() => {
    return () => filePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [filePreviews]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void loadSession(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDraft(draftFromSeries(selectedSeries));
    setCoverFile(null);
    setCoverPreview("");
    if (selectedSeries) setUploadSeriesId(selectedSeries.id);
  }, [selectedSeries]);

  useEffect(() => {
    if (!coverFile) return;
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  async function loadSession(activeToken: string) {
    setLoading(true);
    setAuthError("");
    try {
      const data = await adminJson(activeToken, "session");
      applyLibrary(data.library as LibraryData);
    } catch (error) {
      const caught = error as Error & { code?: string; status?: number };
      if (caught.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY);
        setToken("");
        setAuthError("管理口令无效，请重新输入。");
      } else {
        setAuthError(caught.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function applyLibrary(nextLibrary: LibraryData) {
    setLibrary(nextLibrary);
    const nextSelection =
      nextLibrary.series.find((series) => series.id === selectedSeriesId)?.id ||
      nextLibrary.series[0]?.id ||
      "";
    setSelectedSeriesId(nextSelection);
    setUploadSeriesId((current) =>
      nextLibrary.series.some((series) => series.id === current) ? current : nextSelection,
    );
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    const candidate = password.trim();
    if (!candidate) {
      setAuthError("请输入管理口令。");
      return;
    }
    setBusy("login");
    setAuthError("");
    try {
      const data = await adminJson(candidate, "session");
      sessionStorage.setItem(TOKEN_KEY, candidate);
      setToken(candidate);
      setPassword("");
      applyLibrary(data.library as LibraryData);
    } catch (error) {
      setAuthError((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setLibrary(null);
    setPassword("");
  }

  async function saveSeries(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (!draft.title.trim()) {
      setToast({ tone: "error", message: "请先填写作品名称。" });
      return;
    }
    setBusy("save-series");
    try {
      const data = await adminForm(
        token,
        "save-series",
        {
          id: draft.id,
          title: draft.title,
          originalTitle: draft.originalTitle,
          author: draft.author,
          artist: draft.artist,
          description: draft.description,
          status: draft.status,
          genres: draft.genres,
          accent: draft.accent,
          coverKey: draft.coverKey,
        },
        { cover: coverFile },
      );
      const saved = data.series as MangaSeries;
      applyLibrary(data.library as LibraryData);
      setSelectedSeriesId(saved.id);
      setDraft(draftFromSeries(saved));
      setCoverFile(null);
      setToast({ tone: "success", message: draft.id ? "作品资料已更新。" : "新作品已创建。" });
    } catch (error) {
      setToast({ tone: "error", message: (error as Error).message });
    } finally {
      setBusy("");
    }
  }

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files).filter(
      (file) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|avif|gif)$/i.test(file.name),
    );
    setChapterFiles((current) => {
      const merged = [...current, ...incoming].filter(
        (file, index, all) =>
          all.findIndex((item) => item.name === file.name && item.size === file.size) === index,
      );
      return merged.sort((a, b) => naturalCompare(a.name, b.name));
    });
  }

  function resetUploadFields() {
    setChapterFiles([]);
    setChapterTitle("");
    setChapterNumber("");
    setDirectory("");
    setPageStart("1");
    setOverwrite(false);
    setFileInputKey((value) => value + 1);
  }

  async function submitChapter(event: FormEvent) {
    event.preventDefault();
    if (!token || !uploadSeriesId) {
      setToast({ tone: "error", message: "请先选择作品。" });
      return;
    }
    const normalizedChapterNumber = chapterNumber.trim();
    if (!/^\d+(?:\.\d+)?$/.test(normalizedChapterNumber)) {
      setToast({ tone: "error", message: "请输入有效章节号，例如 12 或 12.5。" });
      return;
    }
    const parsedChapterNumber = Number(normalizedChapterNumber);
    if (!Number.isFinite(parsedChapterNumber)) {
      setToast({ tone: "error", message: "章节号超出有效范围。" });
      return;
    }
    if (uploadMode === "upload" && !chapterFiles.length) {
      setToast({ tone: "error", message: "请选择漫画图片。" });
      return;
    }
    setBusy(uploadMode === "upload" ? "upload-chapter" : "scan-chapter");
    try {
      const payload = {
        seriesId: uploadSeriesId,
        number: parsedChapterNumber,
        title: chapterTitle || `第 ${normalizedChapterNumber} 话`,
        directory: directory || normalizedChapterNumber,
        pageStart: Number(pageStart),
        overwrite,
        renumber,
      };
      const data =
        uploadMode === "upload"
          ? await adminForm(token, "upload-chapter", payload, { files: chapterFiles })
          : await adminJson(token, "import-chapter", payload);
      applyLibrary(data.library as LibraryData);
      setToast({
        tone: "success",
        message:
          uploadMode === "upload"
            ? `第 ${chapterNumber} 话已上传到 R2。`
            : `已从 R2 目录 ${directory || chapterNumber}/ 导入章节。`,
      });
      resetUploadFields();
      setActiveTab("content");
    } catch (error) {
      setToast({ tone: "error", message: (error as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function confirmDelete() {
    if (!token || !confirm) return;
    setBusy("delete");
    try {
      const data = await adminJson(
        token,
        confirm.kind === "series" ? "delete-series" : "delete-chapter",
        {
          seriesId: selectedSeriesId,
          chapterId: confirm.chapterId,
          deleteObjects,
        },
      );
      applyLibrary(data.library as LibraryData);
      setToast({
        tone: "success",
        message: confirm.kind === "series" ? "作品已从书架移除。" : "章节已移除。",
      });
      setConfirm(null);
      setDeleteObjects(false);
    } catch (error) {
      setToast({ tone: "error", message: (error as Error).message });
    } finally {
      setBusy("");
    }
  }

  function openDeleteSeries() {
    if (!selectedSeries) return;
    setDeleteObjects(false);
    setConfirm({ kind: "series", id: selectedSeries.id, title: selectedSeries.title });
  }

  function openDeleteChapter(chapterId: string, title: string) {
    setDeleteObjects(false);
    setConfirm({
      kind: "chapter",
      id: chapterId,
      chapterId,
      title,
    });
  }

  if (!token) {
    return (
      <div className="admin-login-page">
        <Link className="admin-back-link" to="/">
          <ArrowLeft size={17} /> 返回阅读室
        </Link>
        <div className="admin-login">
          <div className="admin-login__mark">
            <Cloud size={28} />
          </div>
          <span className="eyebrow">YORU ADMIN</span>
          <h1>内容控制台</h1>
          <p>输入 Cloudflare Pages 中设置的 `ADMIN_TOKEN`，管理 R2 里的作品与章节。</p>
          <form onSubmit={handleLogin}>
            <label className="field field--filled">
              <span>管理口令</span>
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="输入 ADMIN_TOKEN"
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="显示或隐藏口令">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {authError && <p className="form-error">{authError}</p>}
            <button className="button button--accent button--wide" type="submit" disabled={busy === "login"}>
              {busy === "login" ? <LoaderCircle className="spin" size={17} /> : <Cloud size={17} />}
              连接 R2
            </button>
          </form>
          <div className="admin-login__note">
            <Database size={16} />
            <span>凭据只保存在当前浏览器会话中，不会写入 R2 或页面代码。</span>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingState label="正在连接内容库" />;

  if (!library) {
    return (
      <div className="admin-fatal">
        <h1>控制台暂时不可用。</h1>
        <p>{authError || "请检查 Pages 的 R2 绑定和环境变量。"}</p>
        <div>
          <button type="button" className="button button--accent" onClick={() => void loadSession(token)}>
            <RefreshCw size={16} /> 重试
          </button>
          <button type="button" className="button button--ghost" onClick={signOut}>
            重新登录
          </button>
        </div>
      </div>
    );
  }

  const stats = {
    series: library.series.length,
    chapters: library.series.reduce((sum, series) => sum + series.chapters.length, 0),
    pages: library.series.reduce(
      (sum, series) =>
        sum + series.chapters.reduce((chapterSum, chapter) => chapterSum + chapter.pages.length, 0),
      0,
    ),
  };
  const chapters = selectedSeries
    ? [...selectedSeries.chapters].sort((a, b) => b.number - a.number)
    : [];

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar__brand">
          <Link to="/" className="admin-brand">
            <span className="brand__mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <span>
              <strong>夜页</strong>
              <small>CONTENT STUDIO</small>
            </span>
          </Link>
        </div>
        <div className="admin-topbar__status">
          <span className="connection-chip">
            <i /> R2 已连接
          </span>
          <Link className="admin-icon-button" to="/" aria-label="预览站点" title="预览站点">
            <Eye size={18} />
          </Link>
          <button className="admin-icon-button" type="button" onClick={signOut} aria-label="退出登录" title="退出登录">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="admin-layout">
        <nav className="admin-rail" aria-label="管理导航">
          <button
            type="button"
            className={cn(activeTab === "overview" && "is-active")}
            onClick={() => setActiveTab("overview")}
          >
            <LayoutDashboard size={19} />
            <span>概览</span>
          </button>
          <button
            type="button"
            className={cn(activeTab === "content" && "is-active")}
            onClick={() => setActiveTab("content")}
          >
            <Library size={19} />
            <span>作品资料</span>
          </button>
          <button
            type="button"
            className={cn(activeTab === "upload" && "is-active")}
            onClick={() => setActiveTab("upload")}
          >
            <CloudUpload size={19} />
            <span>上传章节</span>
          </button>
          <span className="admin-rail__spacer" />
          <div className="admin-rail__version">
            <Cloud size={16} />
            <span>R2 / Pages</span>
          </div>
        </nav>

        <main className="admin-main">
          {activeTab === "overview" && (
            <div className="admin-view">
              <div className="admin-heading">
                <div>
                  <span className="eyebrow">CONTENT OVERVIEW</span>
                  <h1>晚上好，创作者。</h1>
                  <p>书架状态一目了然，更新从这里开始。</p>
                </div>
                <button type="button" className="button button--accent" onClick={() => setActiveTab("upload")}>
                  <Plus size={17} /> 新章节
                </button>
              </div>

              <section className="metric-strip" aria-label="内容统计">
                <div>
                  <span>作品</span>
                  <strong>{String(stats.series).padStart(2, "0")}</strong>
                  <small>SERIES</small>
                </div>
                <div>
                  <span>章节</span>
                  <strong>{String(stats.chapters).padStart(2, "0")}</strong>
                  <small>CHAPTERS</small>
                </div>
                <div>
                  <span>图片</span>
                  <strong>{String(stats.pages).padStart(3, "0")}</strong>
                  <small>PAGES</small>
                </div>
                <div className="metric-strip__status">
                  <span>索引状态</span>
                  <strong><Check size={18} /> 已同步</strong>
                  <small>{formatDate(library.updatedAt)}</small>
                </div>
              </section>

              <div className="admin-grid">
                <section className="admin-list-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">ON THE SHELF</span>
                      <h2>作品列表</h2>
                    </div>
                    <button type="button" className="text-button" onClick={() => {
                      setDraft({ ...emptyDraft });
                      setSelectedSeriesId("");
                      setActiveTab("content");
                    }}>
                      <Plus size={15} /> 新建作品
                    </button>
                  </div>
                  <div className="admin-series-list">
                    {library.series.map((series) => (
                      <button
                        key={series.id}
                        type="button"
                        onClick={() => {
                          setSelectedSeriesId(series.id);
                          setActiveTab("content");
                        }}
                      >
                        <CoverArt series={series} baseUrl={library.assetBaseUrl} />
                        <span className="admin-series-list__copy">
                          <strong>{series.title}</strong>
                          <small>{displayAuthor(series)} · {series.chapters.length} 话</small>
                        </span>
                        <span className="status-pill">{series.status}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="quick-panel">
                  <span className="eyebrow">QUICK UPLOAD</span>
                  <h2>把下一话放上书架。</h2>
                  <p>图片会按自然顺序编号并写入章节目录，公开地址与阅读器保持同一路径规则。</p>
                  <div className="quick-panel__path">
                    <FolderSearch size={17} />
                    <code>/章节目录/页码.png</code>
                  </div>
                  <button type="button" className="button button--ink" onClick={() => setActiveTab("upload")}>
                    <UploadCloud size={17} /> 上传章节
                  </button>
                </section>
              </div>

              <section className="recent-admin-section">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">RECENT CHAPTERS</span>
                    <h2>最近章节</h2>
                  </div>
                </div>
                <div className="admin-chapter-table">
                  {library.series
                    .flatMap((series) => series.chapters.map((chapter) => ({ series, chapter })))
                    .sort((a, b) => new Date(b.chapter.publishedAt).getTime() - new Date(a.chapter.publishedAt).getTime())
                    .slice(0, 6)
                    .map(({ series, chapter }) => (
                      <div className="admin-chapter-row" key={`${series.id}-${chapter.id}`}>
                        <span className="admin-chapter-row__number">{formatChapter(chapter.number)}</span>
                        <div>
                          <strong>{series.title} · {chapter.title}</strong>
                          <span>{formatDate(chapter.publishedAt)}</span>
                        </div>
                        <span>{chapter.pages.length} 页</span>
                        <span className="status-pill">已发布</span>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === "content" && (
            <div className="admin-view">
              <div className="admin-heading">
                <div>
                  <span className="eyebrow">SERIES PROFILE</span>
                  <h1>作品资料</h1>
                  <p>编辑公开页面上的书目信息与封面。</p>
                </div>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setDraft({ ...emptyDraft });
                    setSelectedSeriesId("");
                  }}
                >
                  <Plus size={17} /> 新建作品
                </button>
              </div>

              <div className="content-selector">
                <label htmlFor="series-selector">当前作品</label>
                <div>
                  <select
                    id="series-selector"
                    value={selectedSeriesId}
                    onChange={(event) => setSelectedSeriesId(event.target.value)}
                  >
                    {!library.series.length && <option value="">尚未创建作品</option>}
                    {library.series.map((series) => (
                      <option key={series.id} value={series.id}>{series.title}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </div>

              <form className="series-editor" onSubmit={saveSeries}>
                <div className="series-editor__main">
                  <div className="form-section-heading">
                    <span>01</span>
                    <div>
                      <h2>基本信息</h2>
                      <p>会显示在作品详情页与书架中。</p>
                    </div>
                  </div>
                  <div className="form-grid form-grid--two">
                    <label className="field field--filled">
                      <span>作品名称 *</span>
                      <input
                        value={draft.title}
                        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                        placeholder="例如：花信"
                      />
                    </label>
                    <label className="field field--filled">
                      <span>原文标题 / 英文标题</span>
                      <input
                        value={draft.originalTitle}
                        onChange={(event) => setDraft({ ...draft, originalTitle: event.target.value })}
                        placeholder="LETTERS IN BLOOM"
                      />
                    </label>
                    <label className="field field--filled">
                      <span>作者</span>
                      <input
                        value={draft.author}
                        onChange={(event) => setDraft({ ...draft, author: event.target.value })}
                        placeholder="作者名"
                      />
                    </label>
                    <label className="field field--filled">
                      <span>画师</span>
                      <input
                        value={draft.artist}
                        onChange={(event) => setDraft({ ...draft, artist: event.target.value })}
                        placeholder="画师名（可选）"
                      />
                    </label>
                    <label className="field field--filled">
                      <span>连载状态</span>
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          setDraft({ ...draft, status: event.target.value as MangaSeries["status"] })
                        }
                      >
                        <option value="连载中">连载中</option>
                        <option value="已完结">已完结</option>
                        <option value="休载中">休载中</option>
                      </select>
                    </label>
                    <label className="field field--filled">
                      <span>题材标签</span>
                      <input
                        value={draft.genres}
                        onChange={(event) => setDraft({ ...draft, genres: event.target.value })}
                        placeholder="青春, 日常, 文艺"
                      />
                    </label>
                    <label className="field field--filled form-grid__wide">
                      <span>作品简介</span>
                      <textarea
                        rows={4}
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        placeholder="用两三句话介绍这个故事。"
                      />
                    </label>
                  </div>

                  <div className="form-section-heading">
                    <span>02</span>
                    <div>
                      <h2>视觉主题</h2>
                      <p>选择一组与作品气质相符的棕色强调色。</p>
                    </div>
                  </div>
                  <div className="theme-row">
                    {accentSwatches.map((color) => (
                      <button
                        type="button"
                        key={color}
                        className={cn("theme-swatch", draft.accent === color && "is-active")}
                        style={{ backgroundColor: color }}
                        onClick={() => setDraft({ ...draft, accent: color })}
                        aria-label={`使用颜色 ${color}`}
                      >
                        {draft.accent === color && <Check size={15} />}
                      </button>
                    ))}
                    <label className="custom-color">
                      <input
                        type="color"
                        value={draft.accent}
                        onChange={(event) => setDraft({ ...draft, accent: event.target.value })}
                      />
                      <span>{draft.accent.toUpperCase()}</span>
                    </label>
                  </div>
                </div>

                <aside className="series-editor__side">
                  <div className="cover-uploader">
                    <span className="eyebrow">COVER IMAGE</span>
                    <div className="cover-uploader__preview">
                      {coverPreview || assetUrl(draft.coverKey, library.assetBaseUrl) ? (
                        <img
                          src={coverPreview || assetUrl(draft.coverKey, library.assetBaseUrl)}
                          alt="作品封面预览"
                        />
                      ) : (
                        <div>
                          <ImagePlus size={30} />
                          <span>还没有封面</span>
                        </div>
                      )}
                    </div>
                    <label className="button button--ghost button--wide">
                      <UploadCloud size={16} /> 更换封面
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(event) => setCoverFile(event.target.files?.[0] || null)}
                      />
                    </label>
                    <small>建议使用竖版 PNG 或 WebP，最大 8MB。</small>
                  </div>
                  {selectedSeries && (
                    <button type="button" className="danger-button" onClick={openDeleteSeries}>
                      <Trash2 size={16} /> 从书架移除作品
                    </button>
                  )}
                </aside>

                <div className="series-editor__footer">
                  <span>{draft.id ? `ID: ${draft.id}` : "新作品将在保存后生成 ID"}</span>
                  <button className="button button--accent" type="submit" disabled={busy === "save-series"}>
                    {busy === "save-series" ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
                    保存作品
                  </button>
                </div>
              </form>

              {selectedSeries && (
                <section className="chapter-manager">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">CHAPTER INDEX</span>
                      <h2>章节管理</h2>
                    </div>
                    <button type="button" className="button button--accent" onClick={() => setActiveTab("upload")}>
                      <Plus size={16} /> 添加章节
                    </button>
                  </div>
                  <div className="chapter-manager__table">
                    {chapters.map((chapter) => (
                      <div className="chapter-manager__row" key={chapter.id}>
                        <span className="chapter-manager__number">{formatChapter(chapter.number)}</span>
                        <div className="chapter-manager__title">
                          <strong>{chapter.title}</strong>
                          <span>{chapter.directory}/ · {formatDate(chapter.publishedAt)}</span>
                        </div>
                        <span>{chapter.pages.length} 页</span>
                        <Link to={`/read/${selectedSeries.id}/${chapter.number}`} className="text-button">
                          预览
                        </Link>
                        <button
                          type="button"
                          className="admin-icon-button"
                          onClick={() => openDeleteChapter(chapter.id, `第 ${chapter.number} 话 · ${chapter.title}`)}
                          aria-label="删除章节"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    {!chapters.length && <p className="empty-table">还没有章节，先上传第一话吧。</p>}
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === "upload" && (
            <div className="admin-view">
              <div className="admin-heading">
                <div>
                  <span className="eyebrow">CHAPTER STUDIO</span>
                  <h1>上传章节</h1>
                  <p>按「章节目录 / 页码.png」的结构写入 R2。</p>
                </div>
              </div>

              <div className="segmented-control">
                <button
                  type="button"
                  className={cn(uploadMode === "upload" && "is-active")}
                  onClick={() => setUploadMode("upload")}
                >
                  <UploadCloud size={17} /> 上传图片
                </button>
                <button
                  type="button"
                  className={cn(uploadMode === "scan" && "is-active")}
                  onClick={() => setUploadMode("scan")}
                >
                  <FolderSearch size={17} /> 扫描已有目录
                </button>
              </div>

              <form className="upload-form" onSubmit={submitChapter}>
                <section className="upload-form__fields">
                  <div className="form-section-heading">
                    <span>01</span>
                    <div>
                      <h2>章节信息</h2>
                      <p>章节号会用于阅读器的上一话 / 下一话切换。</p>
                    </div>
                  </div>
                  <label className="field field--filled">
                    <span>所属作品 *</span>
                    <select
                      value={uploadSeriesId}
                      onChange={(event) => setUploadSeriesId(event.target.value)}
                      required
                    >
                      {library.series.map((series) => (
                        <option value={series.id} key={series.id}>{series.title}</option>
                      ))}
                    </select>
                  </label>
                  <div className="form-grid form-grid--two">
                    <label className="field field--filled">
                      <span>章节号 *</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={chapterNumber}
                        onChange={(event) => {
                          const value = event.target.value;
                          setChapterNumber(value);
                          if (!directory || directory === chapterNumber) setDirectory(value);
                        }}
                        placeholder="67.5"
                        required
                      />
                    </label>
                    <label className="field field--filled">
                      <span>R2 目录 *</span>
                      <input
                        value={directory}
                        onChange={(event) => setDirectory(event.target.value)}
                        placeholder="67.5"
                        pattern="[^/]+"
                        required
                      />
                    </label>
                    <label className="field field--filled form-grid__wide">
                      <span>章节标题</span>
                      <input
                        value={chapterTitle}
                        onChange={(event) => setChapterTitle(event.target.value)}
                        placeholder="例如：雨停之前"
                      />
                    </label>
                  </div>
                  {uploadMode === "upload" && (
                    <>
                      <div className="inline-options">
                        <label>
                          <input type="checkbox" checked={renumber} onChange={(event) => setRenumber(event.target.checked)} />
                          <span>按选择顺序重命名为 1.png、2.png…</span>
                        </label>
                        {renumber && (
                          <label className="page-start-field">
                            <span>起始页码</span>
                            <input
                              type="number"
                              min="1"
                              value={pageStart}
                              onChange={(event) => setPageStart(event.target.value)}
                            />
                          </label>
                        )}
                      </div>
                      <div
                        className={cn("drop-zone", dragging && "is-dragging")}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          setDragging(true);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDragLeave={(event) => {
                          if (event.currentTarget === event.target) setDragging(false);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          setDragging(false);
                          addFiles(event.dataTransfer.files);
                        }}
                      >
                        <FileImage size={28} />
                        <div>
                          <strong>把漫画图片拖到这里</strong>
                          <p>支持 PNG、JPG、WebP、AVIF，最多 90MB / 次</p>
                        </div>
                        <button type="button" className="button button--ghost" onClick={() => fileInputRef.current?.click()}>
                          选择图片
                        </button>
                        <input
                          key={fileInputKey}
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          hidden
                          onChange={(event) => event.target.files && addFiles(event.target.files)}
                        />
                      </div>
                      {chapterFiles.length > 0 && (
                        <div className="file-queue">
                          <div className="file-queue__head">
                            <strong>{chapterFiles.length} 个文件</strong>
                            <span>{(chapterFiles.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MB</span>
                            <button type="button" className="text-button" onClick={() => setChapterFiles([])}>
                              清空
                            </button>
                          </div>
                          <div className="file-queue__previews">
                            {filePreviews.map((preview) => (
                              <figure key={preview.url}>
                                <img src={preview.url} alt={preview.name} />
                                <figcaption>{preview.name}</figcaption>
                              </figure>
                            ))}
                            {chapterFiles.length > 8 && <span className="file-queue__more">+{chapterFiles.length - 8}</span>}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {uploadMode === "scan" && (
                    <div className="scan-note">
                      <FolderSearch size={19} />
                      <div>
                        <strong>直接读取 R2 目录</strong>
                        <p>系统会扫描 `{directory || chapterNumber || "章节号"}/` 下的图片，并按自然数字顺序生成章节页序。</p>
                      </div>
                    </div>
                  )}
                  <label className="checkbox-row">
                    <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                    <span>
                      <strong>允许覆盖同章节号</strong>
                      <small>如果章节号已存在，将替换书目中的页序；R2 中未引用的旧图片会保留。</small>
                    </span>
                  </label>
                </section>
                <aside className="upload-form__summary">
                  <span className="eyebrow">PUBLISH PREVIEW</span>
                  <div className="upload-preview">
                    {firstFilePreview ? (
                      <img src={firstFilePreview} alt="章节第一页预览" />
                    ) : (
                      <div>
                        <BookOpen size={28} />
                        <span>章节预览</span>
                      </div>
                    )}
                  </div>
                  <h2>{chapterTitle || `第 ${chapterNumber || "?"} 话`}</h2>
                  <dl>
                    <div><dt>作品</dt><dd>{library.series.find((series) => series.id === uploadSeriesId)?.title || "—"}</dd></div>
                    <div><dt>目录</dt><dd>/{directory || chapterNumber || "…"}/</dd></div>
                    <div><dt>页数</dt><dd>{uploadMode === "upload" ? chapterFiles.length : "自动扫描"}</dd></div>
                  </dl>
                  <button className="button button--accent button--wide" type="submit" disabled={Boolean(busy)}>
                    {busy === "upload-chapter" || busy === "scan-chapter" ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : uploadMode === "upload" ? (
                      <UploadCloud size={17} />
                    ) : (
                      <FolderSearch size={17} />
                    )}
                    {uploadMode === "upload" ? "上传并发布" : "扫描并导入"}
                  </button>
                  <small>提交后会立即更新 `library.json`。</small>
                </aside>
              </form>
            </div>
          )}
        </main>
      </div>

      {toast && (
        <div className={cn("admin-toast", `admin-toast--${toast.tone}`)} role="status">
          {toast.tone === "success" ? <Check size={17} /> : <X size={17} />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="关闭提示"><X size={15} /></button>
        </div>
      )}

      {confirm && (
        <div className="modal-scrim" role="presentation" onMouseDown={() => !busy && setConfirm(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-dialog__icon"><Trash2 size={22} /></span>
            <h2 id="confirm-title">{confirm.kind === "series" ? "移除这部作品？" : "删除这一话？"}</h2>
            <p>
              <strong>{confirm.title}</strong>
              {confirm.kind === "series" ? " 将从书架索引中移除。" : " 将从章节目录中移除。"}默认不会删除 R2 内的原始图片。
            </p>
            <label className="checkbox-row checkbox-row--danger">
              <input type="checkbox" checked={deleteObjects} onChange={(event) => setDeleteObjects(event.target.checked)} />
              <span>
                <strong>同时永久删除 R2 图片</strong>
                <small>此操作无法撤回，请确认已经保留副本。</small>
              </span>
            </label>
            <div className="confirm-dialog__actions">
              <button type="button" className="text-button" onClick={() => setConfirm(null)} disabled={Boolean(busy)}>
                取消
              </button>
              <button type="button" className="button button--danger" onClick={() => void confirmDelete()} disabled={Boolean(busy)}>
                {busy === "delete" ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
