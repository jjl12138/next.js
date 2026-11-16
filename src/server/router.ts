import { fileRoutes } from "./routes/files";
import { appsRouter } from "./routes/apps";
import { storagesRouter } from "./routes/storages";
import { apiKeysRouter } from "./routes/apiKeys";
import { userRouter } from "./routes/user";
import { createCallerFactory, procedure, router } from "./trpc";

// appRouter 是唯一的聚合点：前端 createTRPCClient<AppRouter> 和
// 服务端 serverCaller 都从这里拿类型和路由。
// 以后加新模块就往里加一行，不要在前端各自 import。
export const appRouter = router({
  file: fileRoutes,

  // ⚠️ 必须挂上：apps.ts 早就被写好了，但没注册进 appRouter，
  //    客户端 createTRPCClient<AppRouter> 的类型里就【没有】 apps 这个命名空间，
  //    trpc.apps.createApp / listApps 全是 TS2339，新建应用页根本调不通。
  apps: appsRouter,
  storages: storagesRouter,

  // ⚠️ 必须挂上：跟 apps 当时一样，apiKeys.ts 写好了但没注册，
  //    客户端类型里就没有 apiKeys 这个命名空间，trpc.apiKeys.* 全是 TS2339。
  apiKeys: apiKeysRouter,

  // userRouter（getPlan）同样必须注册：不挂上的话前端类型里没有 user
  // 这个命名空间，trpc.user.getPlan 是 TS2339，Plan.tsx 编译不过。
  user: userRouter,

  // 保留一个最简单的 query，用来验证链路 + 演示 loading 状态。
  // 真实业务里可以删掉，换成别的查询端点。
  hello: procedure.query(() => ({ hello: "world" })),
});

export type AppRouter = typeof appRouter;

/**
 * 服务端直连入口：Server Component / Server Action 里调它，
 * 不走 HTTP，但仍然完整经过 logger + session 中间件 + zod 校验。
 *
 * ⚠️ 原来 apps/new 里写的 `serverCaller({session})` 全项目搜不到定义，
 *    这句注释里的「计划」直到现在才落地。
 *
 * 用法：
 *   const session = await getServerSession();
 *   const app = await createCaller({ session }).apps.createApp({ name });
 *
 * ctx 里的 session 允许为 null（未登录），由 protectedProcedure 抛 UNAUTHORIZED。
 */
export const createCaller = createCallerFactory(appRouter);
