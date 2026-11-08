# 夜页 YORU

一个基于 React、Vite、Cloudflare Pages Functions 和 Cloudflare R2 的中文漫画阅读站。采用 Material You 风格和棕色主题，包含书架、作品详情、单页/条漫阅读器以及 R2 内容管理后台。

## 功能

- 首页书架、最近更新和继续阅读进度
- 作品详情与章节列表
- 单页 / 条漫两种阅读模式
- 适合高度 / 适合宽度、键盘翻页、全屏和章节切换
- 图片预加载、阅读进度保存在浏览器 `localStorage`
- 管理端登录后新建/编辑作品、上传封面和章节图片
- 扫描 R2 已有章节目录并导入
- 覆盖章节、删除章节/作品，可选同时删除 R2 图片
- 无数据库：书目索引保存在 R2 根目录的 `library.json`

## 本地开发

需要 Node.js 20+。

```bash
npm install
npm run dev
```

Vite 默认运行在 `http://localhost:5173`。如果只运行 Vite，`/api/library` 不可用时会自动读取 `public/demo-library.json` 的演示数据。

要连同 Cloudflare Pages Functions 一起本地运行：

```powershell
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，把 ADMIN_TOKEN 改成足够长的随机字符串
npm run dev:pages
```

`npm run dev:pages` 会先构建静态站点，然后通过 Wrangler 启动 Pages Functions。默认端口为 `8788`。本地的 R2 绑定由 `wrangler.toml` 中的 `[[r2_buckets]]` 配置提供；首次使用 Wrangler 前请执行 `npx wrangler login`。

## R2 配置

当前项目默认使用存储桶 `manga`：

- 绑定名称：`MANGA_BUCKET`
- 存储桶名称：`manga`
- 公开图片域名：`https://manga.mahiru.dpdns.org`

图片路径采用以下结构：

```text
64/61.png
65/1.png
```

其中第一级是章节号目录，文件名是页码。图片扩展名支持 `png`、`jpg`、`jpeg`、`webp`、`avif` 和 `gif`。

站点会从 R2 根目录读取 `library.json`，它只保存作品和章节索引，不保存图片二进制。首次在空桶中打开管理端并保存作品后，系统会自动创建该文件。图片通过 `R2_PUBLIC_BASE_URL` 直接访问；如果该变量留空，则使用 `/api/media/...` Functions 代理。

## Cloudflare Pages 部署

### 通过 Wrangler 直接部署

```powershell
npx wrangler login
npm run deploy -- --project-name yoru-manga-reader
```

`npm run deploy` 会执行 `npm run build`，然后把 `dist` 和 `functions` 部署到 Cloudflare Pages。首次部署时，Wrangler 会在 Cloudflare 上创建同名 Pages 项目。

> **不要对 Pages 项目执行 `npx wrangler deploy`。** 该命令用于 Workers，会出现 `wrangler pages deploy should be used instead` 并最终报 `Missing entry-point`。

如果 Cloudflare 的 Git 构建设置中有独立的 **Deploy command** 字段，请使用：

```bash
npx wrangler pages deploy dist --project-name=yoru-manga-reader
```

如果使用的是标准 Pages Git 集成，则 **Deploy command 留空**，由 Pages 自动上传 `dist`，只填写 Build command：`npm run build`。

部署完成后，在 Cloudflare Pages 项目的 **Settings → Variables and Secrets** 中添加：

```text
ADMIN_TOKEN=<足够长的随机管理口令>
R2_PUBLIC_BASE_URL=https://manga.mahiru.dpdns.org
```

`ADMIN_TOKEN` 必须设置为 Secret，不要写在前端代码或提交到仓库。R2 绑定已在 `wrangler.toml` 配置为 `MANGA_BUCKET`；如果使用控制台部署，请在 **Settings → Functions → R2 bucket bindings** 中创建同名绑定。

### 通过 GitHub 连接 Pages

在 Cloudflare Pages 新建项目并连接仓库，使用以下构建配置：

- Framework preset：`Vite`
- Build command：`npm run build`
- Build output directory：`dist`
- Deploy command：留空，或使用 `npx wrangler pages deploy dist --project-name=yoru-manga-reader`
- R2 binding：`MANGA_BUCKET` → `manga`

保存环境变量 `ADMIN_TOKEN` 和 `R2_PUBLIC_BASE_URL` 后重新部署。

## 管理端

打开 `/admin`，输入 `ADMIN_TOKEN` 登录。登录凭据只保存在当前浏览器会话的 `sessionStorage` 中，不会写入 R2 或页面代码。

上传章节时可以：

- 上传本地图片并自动按 `1.png`、`2.png` 顺序命名
- 输入已有 R2 目录，扫描其中的图片并导入
- 覆盖已有章节号
- 选择是否同时删除 R2 原始图片

## 数据格式

R2 根目录的 `library.json` 结构大致如下：

```json
{
  "version": 1,
  "updatedAt": "2026-11-08T00:00:00.000Z",
  "series": [
    {
      "id": "hana-shin",
      "title": "花信",
      "author": "YORU",
      "description": "……",
      "status": "连载中",
      "genres": ["剧情"],
      "coverKey": "65/1.png",
      "accent": "#76583d",
      "createdAt": "2026-11-08T00:00:00.000Z",
      "updatedAt": "2026-11-08T00:00:00.000Z",
      "chapters": [
        {
          "id": "chapter-65",
          "number": 65,
          "title": "第十三点的练习室",
          "directory": "65",
          "pages": ["65/1.png", "65/2.png"],
          "publishedAt": "2026-11-08T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

## 安全提示

- 不要把 R2 S3 Access Key、Secret Key 或 Cloudflare API Token 写进仓库、Wrangler 变量或前端代码。
- 实际图片上传由 Pages Functions 通过 `MANGA_BUCKET` 绑定完成，不需要把 S3 密钥交给浏览器。
- 如果管理口令或 API 凭据曾经暴露，请立即在 Cloudflare 控制台轮换。
