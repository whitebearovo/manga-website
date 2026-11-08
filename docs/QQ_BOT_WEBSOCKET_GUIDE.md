# 夜頁漫畫更新 API：QQ WebSocket Bot 接入指引

這份文件供已經在執行 QQ WebSocket Bot 的專案使用。Bot 主動拉取漫畫更新，透過現有 WebSocket 發送 QQ 訊息，發送成功後再向漫畫站 ACK。

不要在 Bot 專案新增 Webhook、公開 HTTP callback、Fastify/Express 路由或 Cloudflare Worker。漫畫站不需要反向連接 Bot。

## 1. 架構

```text
QQ WebSocket Bot                         夜頁漫畫站 / Cloudflare Pages
      |                                             |
      |  既有 QQ WebSocket 連線                     |
      |<------------------------------------------->|
      |                                             |
      |  POST /api/notifications/qq/pull            |
      |  Authorization: Bearer <token>              |
      |-------------------------------------------->|
      |                                             |
      |  未通知的章節批次 + signatures               |
      |<--------------------------------------------|
      |                                             |
      |  呼叫 Bot 現有的 sendGroupMessage()          |
      |  經既有 WebSocket 發送 batch.text            |
      |                                             |
      |  發送成功後                                 |
      |  POST /api/notifications/qq/ack             |
      |  Authorization: Bearer <token>              |
      |-------------------------------------------->|
      |                                             |
      |  ACK 結果                                   |
      |<--------------------------------------------|
```

關鍵規則：

1. Pull 只讀取狀態，不會把更新標記為已通知。
2. Pull 成功但還沒 ACK 時，下一次 Pull 會再次返回同一批更新，這是刻意的重試機制。
3. 只有確定 QQ 訊息已透過 WebSocket 發送成功後才可以 ACK。
4. ACK 成功後，Pull 才不會再返回相同章節。
5. 不要由漫畫站推送 Webhook，也不要要求漫畫站知道 Bot 的 WebSocket 位址。

## 2. 正式站與環境變數

正式站：

```text
https://yoru-manga-reader.pages.dev
```

QQ Bot 專案只需要以下環境變數：

```dotenv
MANGA_API_BASE_URL=https://yoru-manga-reader.pages.dev
MANGA_API_TOKEN=<Cloudflare Pages 中的 UPDATE_API_TOKEN>
QQ_GROUP_ID=<要通知的 QQ 群號>
```

`MANGA_API_TOKEN` 不可提交到 Git、不可寫入日誌，也不可傳到前端。

Cloudflare Pages 端需要設定：

```dotenv
UPDATE_API_TOKEN=<足夠長的隨機 API 權杖>
SITE_URL=https://yoru-manga-reader.pages.dev
```

如果 Pages 沒有設定 `UPDATE_API_TOKEN`，Function 會回退使用 `ADMIN_TOKEN`。不過 Bot 應使用獨立的 `UPDATE_API_TOKEN`，不要共用管理員密碼。

## 3. API 認證

`GET /api/updates` 是公開端點。

Pull 和 ACK 都需要 Bearer Token：

```http
Authorization: Bearer <UPDATE_API_TOKEN>
```

只接受 `Authorization: Bearer ...`。舊版的 `X-Webhook-Token` 已移除，也不要再傳送 Webhook 相關 headers。

未設定任何可用權杖時，伺服器回傳 `503 UPDATE_TOKEN_MISSING`。權杖錯誤或缺少時，回傳 `401 UNAUTHORIZED`。

所有 API 都支援 JSON 與 `OPTIONS` CORS；Bot 在 Node.js 執行時仍建議直接使用 `fetch`。

## 4. 查詢目前更新狀態

```http
GET /api/updates
```

這個端點適合健康檢查、手動查詢或 Bot 管理指令，不用於通知去重。

可選查詢參數：

| 參數 | 說明 |
| --- | --- |
| `seriesId` | 只返回指定作品的 ID |
| `since` | 只返回該時間後更新的作品，支援 ISO 8601 或 Unix timestamp |

範例：

```bash
curl "https://yoru-manga-reader.pages.dev/api/updates"
curl "https://yoru-manga-reader.pages.dev/api/updates?seriesId=sassakoi"
curl "https://yoru-manga-reader.pages.dev/api/updates?since=2026-11-08T00:00:00.000Z"
```

代表性回應：

```json
{
  "ok": true,
  "generatedAt": "2026-11-08T04:10:00.000Z",
  "cursor": "2026-11-08T04:09:30.000Z",
  "libraryUpdatedAt": "2026-11-08T04:09:30.000Z",
  "since": null,
  "seriesId": null,
  "hasUpdates": true,
  "summary": {
    "series": 1,
    "chapters": 12,
    "matchedSeries": 1
  },
  "updates": [
    {
      "seriesId": "sassakoi",
      "title": "戀語輕唱",
      "author": "作者名稱",
      "status": "连载中",
      "updatedAt": "2026-11-08T04:09:30.000Z",
      "coverUrl": "https://manga.mahiru.dpdns.org/covers/sassakoi.webp",
      "seriesUrl": "https://yoru-manga-reader.pages.dev/series/sassakoi",
      "latestChapter": {
        "id": "chapter-62.5",
        "number": 62.5,
        "title": "電話、報告、戀人",
        "publishedAt": "2026-11-08T04:09:30.000Z",
        "pageCount": 17,
        "url": "https://yoru-manga-reader.pages.dev/read/sassakoi/62.5"
      }
    }
  ]
}
```

`latestChapter.number` 是 number，不是字串。它允許小數，例如 `62.5`，請勿用 `parseInt()` 截斷。

若要保存增量游標，請使用回應中的 `cursor` 作為下一次查詢的 `since`。通知去重仍應使用 Pull/ACK，不要只依賴 `since`。

## 5. Pull：取得未通知批次

```http
POST /api/notifications/qq/pull
Authorization: Bearer <UPDATE_API_TOKEN>
Content-Type: application/json

{}
```

Pull 不需要 Webhook URL、群號或使用者 ID。訊息目標由 Bot 端既有設定決定。

### 5.1 首次 Pull

第一次 Pull 如果 R2 中還沒有通知基準，會先建立基準並返回：

```json
{
  "ok": true,
  "hasUpdates": false,
  "reason": "baseline-created",
  "stateUpdated": true,
  "checkedSeries": 1,
  "message": "已建立首次通知基準，後續最新章節變化會由 pull 接口返回。"
}
```

這是正常結果。它不會把所有歷史章節發到群裡。建立基準後，下一次 Pull 才會回報新的章節變化。

### 5.2 無更新

```json
{
  "ok": true,
  "hasUpdates": false,
  "reason": "no-updates",
  "checkedSeries": 1,
  "since": null,
  "force": false
}
```

### 5.3 有更新

```json
{
  "ok": true,
  "hasUpdates": true,
  "requiresAck": true,
  "checkedSeries": 2,
  "batch": {
    "event": "manga.update",
    "version": 1,
    "createdAt": "2026-11-08T04:12:00.000Z",
    "siteUrl": "https://yoru-manga-reader.pages.dev",
    "text": "【夜頁漫畫更新】\n《戀語輕唱》更新至第 62.5 話「電話、報告、戀人」\nhttps://yoru-manga-reader.pages.dev/read/sassakoi/62.5（17 頁）",
    "updates": [
      {
        "seriesId": "sassakoi",
        "title": "戀語輕唱",
        "author": "作者名稱",
        "status": "连载中",
        "updatedAt": "2026-11-08T04:09:30.000Z",
        "coverUrl": "https://manga.mahiru.dpdns.org/covers/sassakoi.webp",
        "seriesUrl": "https://yoru-manga-reader.pages.dev/series/sassakoi",
        "latestChapter": {
          "id": "chapter-62.5",
          "number": 62.5,
          "title": "電話、報告、戀人",
          "publishedAt": "2026-11-08T04:09:30.000Z",
          "pageCount": 17,
          "url": "https://yoru-manga-reader.pages.dev/read/sassakoi/62.5"
        }
      }
    ]
  },
  "signatures": {
    "sassakoi": "chapter-62.5"
  },
  "message": "請先透過 QQ WebSocket 發送 batch.text，成功後再呼叫 ACK 接口。"
}
```

`signatures` 是 Pull 當下的章節簽章。ACK 時必須原樣提交這次 Pull 回傳的 `signatures`，不要自行用其他資料重新推導。

### 5.4 Pull 的進階參數

Pull request body 全部為可選欄位：

```json
{
  "seriesId": "sassakoi",
  "since": "2026-11-08T00:00:00.000Z",
  "force": true
}
```

| 欄位 | 說明 |
| --- | --- |
| `seriesId` | 只拉取指定作品 |
| `since` | 忽略一般通知基準，只返回此時間後的更新 |
| `force` | 忽略通知基準，返回目前所有指定作品；適合首次測試 |

一般 Bot 不需要這三個欄位，固定傳 `{}` 即可。

## 6. ACK：確認已透過 WebSocket 發送

```http
POST /api/notifications/qq/ack
Authorization: Bearer <UPDATE_API_TOKEN>
Content-Type: application/json

{
  "signatures": {
    "sassakoi": "chapter-62.5"
  }
}
```

成功時：

```json
{
  "ok": true,
  "acked": {
    "sassakoi": "chapter-62.5"
  },
  "ignored": [],
  "ackedCount": 1,
  "message": "通知狀態已確認，後續 pull 不會重複返回這些章節。"
}
```

ACK 成功後，下一次 Pull 對同一章節會返回 `no-updates`。

### 6.1 Pull 後章節又更新

如果 Pull 返回 `chapter-62.5`，但在 ACK 前作品已經更新到 `63`，舊 ACK 不會把新章節誤標成已通知：

```json
{
  "ok": true,
  "acked": {},
  "ignored": [
    {
      "seriesId": "sassakoi",
      "reason": "chapter-changed"
    }
  ],
  "ackedCount": 0,
  "message": "沒有可確認的章節；最新章節可能已在拉取後再次變化。"
}
```

下一次 Pull 會返回 `63`。

`ignored` 也可能包含：

```json
{
  "seriesId": "deleted-series",
  "reason": "series-not-found"
}
```

ACK 回傳 HTTP `200` 不代表所有簽章都成功。Bot 必須檢查 `ackedCount` 和 `ignored`。

## 7. HTTP 狀態與錯誤

錯誤格式：

```json
{
  "error": "更新 API 口令不正確",
  "code": "UNAUTHORIZED",
  "details": null
}
```

| HTTP | code | 意義 |
| --- | --- | --- |
| 400 | `INVALID_JSON` | Pull body 不是合法 JSON 物件 |
| 400 | `INVALID_ACK` | ACK body 格式錯誤或 `signatures` 為空 |
| 401 | `UNAUTHORIZED` | Bearer Token 缺少或不正確 |
| 422 | `INVALID_SINCE` | `since` 不是合法 ISO 時間或 Unix timestamp |
| 500 | `QQ_PULL_FAILED` | Pull 讀取 R2 或建立批次失敗 |
| 500 | `QQ_ACK_FAILED` | ACK 寫入通知狀態失敗 |
| 503 | `UPDATE_TOKEN_MISSING` | Pages 未設定 `UPDATE_API_TOKEN` 或 `ADMIN_TOKEN` |
| 503 | `R2_BINDING_MISSING` | Pages 未綁定 `MANGA_BUCKET` R2 bucket |
| 500 | `UPDATE_STATUS_FAILED` | 公開更新狀態端點讀取失敗 |

## 8. TypeScript 型別

```ts
export interface LatestChapterStatus {
  id: string;
  number: number;
  title: string;
  publishedAt: string;
  pageCount: number;
  url: string;
}

export interface MangaUpdateStatus {
  seriesId: string;
  title: string;
  author: string;
  status: "连载中" | "已完结" | "休载中";
  updatedAt: string;
  coverUrl: string;
  seriesUrl: string;
  latestChapter: LatestChapterStatus;
}

export type ChapterSignatures = Record<string, string>;

export interface PullResponse {
  ok: true;
  hasUpdates: boolean;
  requiresAck?: true;
  reason?: "baseline-created" | "no-updates";
  checkedSeries?: number;
  batch?: {
    event: "manga.update";
    version: 1;
    createdAt: string;
    siteUrl: string;
    text: string;
    updates: MangaUpdateStatus[];
  };
  signatures?: ChapterSignatures;
  message?: string;
}

export interface AckResponse {
  ok: true;
  acked: ChapterSignatures;
  ignored: Array<{
    seriesId: string;
    reason: "chapter-changed" | "series-not-found";
  }>;
  ackedCount: number;
  message: string;
}
```

`status` 請以站點目前 `src/types.ts` 的實際 union 為準。若 Bot 不想耦合，可改成 `string`。

## 9. Node.js fetch 範例

以下只處理漫畫通知 API，不包含 QQ WebSocket protocol。請直接呼叫 Bot 專案已有的 WebSocket 發送函式。

```ts
import type {
  AckResponse,
  ChapterSignatures,
  PullResponse,
} from "./types.js";

const apiBaseUrl = requiredEnv("MANGA_API_BASE_URL").replace(/\/+$/, "");
const apiToken = requiredEnv("MANGA_API_TOKEN");
const groupId = requiredEnv("QQ_GROUP_ID");

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function mangaApi<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const code = data?.code ? ` ${data.code}` : "";
    const message = data?.error || response.statusText;
    throw new Error(`Manga API ${response.status}${code}: ${message}`);
  }

  return data as T;
}

export async function pullMangaUpdates(): Promise<PullResponse> {
  return mangaApi<PullResponse>("/api/notifications/qq/pull", {
    method: "POST",
    body: "{}",
  });
}

export async function ackMangaUpdates(
  signatures: ChapterSignatures,
): Promise<AckResponse> {
  return mangaApi<AckResponse>("/api/notifications/qq/ack", {
    method: "POST",
    body: JSON.stringify({ signatures }),
  });
}
```

`sendGroupMessage` 是 Bot 專案現有函式的假設名稱。請替換成實際經 WebSocket 發送的函式，不要在本功能中重寫 QQ WebSocket 協議。

```ts
declare function sendGroupMessage(
  groupId: string,
  text: string,
): Promise<void>;
```

## 10. 建議的 Bot 輪詢流程

建議每 2 到 5 分鐘 Pull 一次。不要讓多個 timer、指令或 worker 同時執行同一輪 Poll。

最簡流程：

```ts
let pollRunning = false;

async function pollMangaUpdatesOnce() {
  if (pollRunning) return;
  pollRunning = true;

  try {
    const pulled = await pullMangaUpdates();
    if (!pulled.hasUpdates || !pulled.batch || !pulled.signatures) return;

    await sendGroupMessage(groupId, pulled.batch.text);

    const acked = await ackMangaUpdates(pulled.signatures);
    if (acked.ackedCount !== Object.keys(pulled.signatures).length) {
      console.warn("Manga ACK was partial:", acked.ignored);
    }
  } finally {
    pollRunning = false;
  }
}
```

正式 Bot 建議把流程拆成可恢復的狀態機：

1. Pull 成功後，先把 `batch` 與 `signatures` 保存到 Bot 的本地持久化狀態。
2. 經既有 WebSocket 發送訊息。
3. 發送成功後，把本地狀態標記為 `pending-ack`。
4. 持續重試 ACK，直到 `ackedCount` 符合預期或收到明確的 `chapter-changed` / `series-not-found`。
5. ACK 完成後清除本地 pending 狀態。

重試規則：

| 失敗位置 | 處理方式 |
| --- | --- |
| Pull 網路錯誤或 5xx | 保留原進度，下一輪重新 Pull |
| WebSocket 發送失敗 | 不要 ACK，下一輪重新 Pull 或重送保存的同一批 |
| 發送成功但 ACK 網路錯誤 | 不要重新發 QQ 訊息，先重試 ACK |
| ACK 回傳 partial / ignored | 記錄結果，下一次 Pull 會返回仍未被 ACK 的較新章節 |

若程序在「QQ 已發送」與「本地記錄 pending-ack」之間突然崩潰，無法保證完全不重複。若 Bot 有資料庫，可在發送前記錄 `sending`，發送後記錄 `pending-ack`，以縮小重複窗口。

QQ 單則訊息可能有長度限制。若一次批次包含很多作品，可依 `batch.updates` 分則發送；只有所有分則都發送成功後才 ACK 整批 `signatures`。

## 11. 日誌與安全

- 不記錄 `MANGA_API_TOKEN`、`Authorization` header 或完整 request headers。
- 可記錄 HTTP status、錯誤 code、Pull 的 `checkedSeries`、ACK 的 `ackedCount` 和 `ignored`。
- 不要把 Token 傳給瀏覽器、QQ 使用者、QQ 群或第三方服務。
- 不要把 `.env`、`config.json` 中的真實 Token 提交到 GitHub。
- 建議 Token 至少 32 bytes 隨機值，且只授予漫畫通知用途。
- 如果 Token 洩漏，立即更新 Cloudflare Pages 的 `UPDATE_API_TOKEN` 與 Bot 環境變數。

## 12. 驗收測試

在 Bot 專案完成後，至少驗證：

1. 未設定 `MANGA_API_TOKEN` 時 Bot 啟動會清楚報錯，且不會印出 Token。
2. 第一次 Pull 返回 `baseline-created`，不發 QQ 訊息。
3. 在漫畫管理端新增章節後，Pull 返回 `hasUpdates: true`。
4. `batch.text` 能經既有 QQ WebSocket 發到測試群。
5. 發送成功前不呼叫 ACK。
6. 發送成功後 ACK，`ackedCount` 等於簽章數量。
7. 再次 Pull 返回 `no-updates`。
8. 故意讓 ACK 暫時失敗，確認 Bot 重試 ACK 而沒有重新發同一則 QQ 訊息。
9. 故意讓 WebSocket 發送失敗，確認 Bot 沒有 ACK。
10. 小數章節如 `62.5` 能在訊息與連結中完整顯示，不會變成 `62`。
11. 同時觸發兩個 timer 時，只有一個 Poll 執行。
12. 日誌中搜尋不到完整 API Token。
13. Bot 專案中不存在 `/webhook`、`listen` 或公開 callback HTTP server，只保留原本 QQ WebSocket 連線。

手動 API 檢查：

```bash
curl -X POST "https://yoru-manga-reader.pages.dev/api/notifications/qq/pull" \
  -H "Authorization: Bearer $MANGA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}"
```

```bash
curl -X POST "https://yoru-manga-reader.pages.dev/api/notifications/qq/ack" \
  -H "Authorization: Bearer $MANGA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"signatures":{"sassakoi":"chapter-62.5"}}'
```

## 13. 可直接交給另一個對話的實作提示詞

```text
你正在修改一個已經可正常運作的 QQ Bot 專案。這個 Bot 使用既有 WebSocket 連線與 QQ 通訊，不要新增 Webhook、公開 HTTP callback、Express/Fastify route、Cloudflare Worker 或任何反向接收端點。

請加入「夜頁漫畫更新通知」功能：

API base URL:
https://yoru-manga-reader.pages.dev

環境變數:
MANGA_API_BASE_URL=https://yoru-manga-reader.pages.dev
MANGA_API_TOKEN=<由使用者提供，不可寫死或提交 Git>
QQ_GROUP_ID=<由 Bot 現有設定提供>

固定流程:
1. 每 2 到 5 分鐘呼叫 POST /api/notifications/qq/pull。
2. 請求必須帶 Authorization: Bearer ${MANGA_API_TOKEN} 與 Content-Type: application/json。
3. body 傳 {}。
4. 若 hasUpdates 為 false，直接結束本輪。
5. 若 hasUpdates 為 true，必須使用 Bot 現有的 WebSocket 發送函式，把 batch.text 發到設定的 QQ 群。不要重寫 QQ WebSocket protocol。
6. 只有確定 QQ 訊息發送成功後，才呼叫 POST /api/notifications/qq/ack。
7. ACK body 必須是 {"signatures": <pull 回應原樣返回的 signatures>}。
8. Pull 不會自動標記已讀。發送失敗時不要 ACK，下一次 Pull 會再次返回同一批。
9. ACK 失敗時不要重發 QQ 訊息，先重試 ACK。可用 Pull 回傳的 signatures 作為 pending-ack 去重依據。
10. 必須有單一輪詢鎖，避免兩個 timer 同時 Pull，造成重複 QQ 訊息。
11. 不要把 API Token、Authorization header 寫進日誌。
12. 小數章節例如 62.5 必須完整保留，不要 parseInt 成 62。
13. ACK HTTP 200 仍要檢查 ackedCount、acked 和 ignored；ignored 可能包含 chapter-changed 或 series-not-found。
14. 若 QQ 訊息過長，可依 batch.updates 分則發送，但所有分則成功後才 ACK。
15. 建議持久化 pending batch 與 pending-ack，讓 Bot 重啟後仍能恢復流程。

請保留 Bot 現有 WebSocket 生命週期、登入、重連、心跳、sendGroupMessage 實作和群組設定。完成後加入測試，覆蓋 baseline-created、no-updates、有更新、WebSocket 發送失敗不 ACK、ACK 重試、小數章節與單一輪詢鎖。
```

## 14. 實作邊界

這份指引只定義漫畫站與 Bot 之間的 HTTP pull/ack 契約。QQ Bot 的 WebSocket 登入、心跳、事件解析、重連與訊息發送，應沿用 Bot 專案現有實作。

漫畫站不會保存 Bot 的 WebSocket 位址，也不會主動呼叫 Bot。更新提醒完全由 Bot 主動 Pull 觸發。
