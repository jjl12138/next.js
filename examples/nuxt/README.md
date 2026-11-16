# Nuxt 4 × image-saas

用 Nuxt 4 调 image-saas 开放 API 的最小示例：**签名 → 浏览器直传 COS → 落库**。

## 为什么是三段式

```
浏览器 ──① POST /api/presign──▶ Nuxt 服务端 ──▶ image-saas /api/open/file.createPresignedUrl
   │                              返回预签名 URL（90 秒有效）
   ├──② PUT file ─────────────────────────────────▶ COS（文件本体不经过 Nuxt）
   └──③ POST /api/files ────────▶ Nuxt 服务端 ──▶ image-saas /api/open/file.saveFile
```

文件内容不经过 Nuxt：大文件不会占 Node 内存和带宽，慢网络也不会把服务端的请求拖死。
服务端只做两件事 —— 签发带权限的 URL、把元数据记进库。

## 启动

```bash
# 1. 先把 image-saas 起起来（默认 3000）
cd ../../ && pnpm dev

# 2. 复制环境变量并填入 api-key / appId
cd examples/nuxt
cp .env.example .env

# 3. 启动（3456）
pnpm dev
```

`.env` 里的三项：

| 变量 | 说明 |
| --- | --- |
| `NUXT_IMAGE_SAAS_BASE_URL` | image-saas 地址，不带 `/api` |
| `NUXT_IMAGE_SAAS_API_KEY` | image-saas → 设置 → API Key |
| `NUXT_IMAGE_SAAS_DEFAULT_APP_ID` | 可选，示例页默认用的 appId |

这些值只挂在 `runtimeConfig.imageSaas`（非 `public`）下，**只在服务端可见**，
不会被打进客户端 bundle。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/config` | 只回报本地配置状态（`baseUrl` / `apiKeyConfigured` / `appId`），不调上游，永远 200；页面头部的「API Key 已/未配置」就读它 |
| GET | `/api/test` | 冒烟检查：用 SDK 以 api-key 身份签一个 URL，验证「密钥 → 应用 → 存储」整条链路 |
| POST | `/api/presign` | `{ appId, filename?, contentType?, key? }` → `{ url, method, key }` |
| POST | `/api/files` | `{ appId, url, name, type }` → 落库后的记录 |

`/api/test` 可以直接 curl（appId 不传就用 `.env` 里的默认值）：

```bash
curl "http://localhost:3456/api/test"
curl "http://localhost:3456/api/test?appId=<uuid>"
```

> **页面显示「API Key 未配置」但 `.env` 明明有值？**
> `.env` 只认这个目录：`examples/nuxt/.env`（不是仓库根目录、也不是 `packages/api`）。
> 改完必须**重启** `pnpm dev` —— 环境变量在进程启动时读取，热更新不会重新加载它。
> 用 `curl http://localhost:3456/api/config` 直接看服务端到底读到了什么，
> 比看页面猜快。

## 三个容易踩的坑

**1. 预签名 URL 90 秒失效。**
拿到就 PUT，不要缓存、不要存库。存库必须剥掉 query（`?X-Amz-Signature=...`），
否则列表页过一会儿全是 403。`server/api/files.post.ts` 里已经用 `stripQuery` 处理。

**2. Content-Type 必须和签名时一致。**
签名时声明 `image/png`，PUT 时就得发 `Content-Type: image/png`，
否则 COS 报 `403 SignatureDoesNotMatch`。

**3. 对象键要带唯一后缀。**
只用 `日期/文件名` 的话，同一天传两个同名文件（两张都叫 `image.png` 的截图）
会算出同一个 key → 后者覆盖前者，而数据库里留下两条记录指向同一个对象。
`generateObjectKey()` 用 `日期/uuid-文件名` 避开。

## 目录

```
server/
  utils/image-saas.ts      # 开放 API 封装：batch 解包、错误码映射、超时
  api/test.ts              # 冒烟检查
  api/presign.post.ts      # 签名
  api/files.post.ts        # 落库
app/app.vue                # 示例页：选文件 → 上传 → 展示结果
```

## 类型检查

```bash
pnpm typecheck
```
