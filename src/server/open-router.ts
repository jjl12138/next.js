import { router } from "./trpc";
import { fileOpenRoutes } from "./routes/files-open";

// openRouter 是【对外公开】的 API 聚合点，供 /api/open/[...trpc] 使用。
//
// 为什么跟 appRouter（server/router.ts）分开：
//   · appRouter 的鉴权是「登录 session」—— protectedProcedure 里查 next-auth；
//   · openRouter 的鉴权是「api-key 请求头」—— 每个 procedure 都套
//     withAppProcedure，从 `api-key` 头反查 apiKeys → app → user。
//   两套准入方式混在同一个 router 里，就得在每个 resolver 里手动判断
//   「这次是走 session 还是走 key」，漏一个就是越权。物理隔开之后，
//   openRouter 里【不可能】出现只认 session 的 procedure，反之亦然。
//
// ⚠️ 这个文件曾被建成空文件（0 字节），而 api/open 的 route handler 已经
//    在 import 它 —— 表现是 `tsc` 报 TS2306「不是模块」，`next build` 直接失败，
//    但 dev server 因为按路由懒编译，点进 /api/open 之前一切正常，很难发现。
//
// ⚠️ 命名差异是有意的：这里挂 `file`，跟 appRouter 里的 `file` 保持一致，
//    客户端 SDK 换 basePath（/api/trpc → /api/open）就能复用同一份类型形状。
export const openRouter = router({
  file: fileOpenRoutes,
});

export type OpenRouter = typeof openRouter;
