import { initTRPC, TRPCError } from "@trpc/server";
import { getServerSession } from "@/server/auth";
import type { Session } from "next-auth";
import { headers } from "next/headers";
import { db } from "./db/db";
import jwt from "jsonwebtoken";

// ⚠️ Context 必须【先声明成类型】，再交给 initTRPC.context<Context>()。
//
//    原来是 initTRPC.context().create() —— 没传泛型，ctx 的类型退化成 object，
//    跟 createTRPCContext() 的返回值【完全脱钩】：
//      · context 工厂里加字段 / 改字段名 / 手滑 return undefined，编译器一律不报；
//      · 要等某个 resolver 访问到才炸，而且报的是「属性不存在」这种隔了一层的错。
//    （Session 这个 import 原来被 eslint 标为「定义了没用」，
//     正是因为没有任何类型引用到它 —— 现在用上了。）
export interface Context {
  /** 未登录时为 null，由各 resolver / middleware 自己决定怎么处理 */
  session: Session | null;
}

// 服务端 / Server Component 直接调 tRPC 时用它造 context。
// 未登录返回 { session: null } —— 不抛错，让调用方自己决定怎么处理。
export async function createTRPCContext(): Promise<Context> {
  const session = await getServerSession();

  // 关键：不要 return undefined。
  // 返回 undefined 会让 ctx 变成 undefined，resolver 里 ctx.session 直接抛
  // TypeError（而且是在求值阶段就炸，console.log 根本执行不到）。
  return { session: session ?? null };
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const procedure = t.procedure;

// ⚠️ tRPC v11 里 server caller 的工厂【不是】 @trpc/server 的顶层导出，
//    它是挂在 initTRPC 实例上的方法：t.createCallerFactory(router)。
//    从 "@trpc/server" import 会报 TS2305: has no exported member 'createCallerFactory'。
//
//    这里只把工厂函数透出去，真正的 caller 在 router.ts 里造 —— 因为
//    createCallerFactory(appRouter) 需要 appRouter，而 router.ts 又依赖本文件，
//    反过来 import 就成了循环依赖。
export const createCallerFactory = t.createCallerFactory;

// 计时中间件：包在 loggedProcedure 上，每个请求打一次耗时
export const withLoggerProcedure = procedure.use(
  async ({ next, path, type }) => {
    const start = Date.now();

    // ⚠️ 原来是 `const result = await next(); log; return result;`
    //    —— resolver 抛错时 await next() 直接 reject，log 那行【永远不执行】。
    //    结果是「失败的请求反而没有日志」，而排查时恰恰只看失败的那几条。
    //    用 try/finally 保证成功和失败都打点。
    try {
      return await next();
    } finally {
      console.log(`---> Api ${type} ${path} time:`, Date.now() - start, "ms");
    }
  }
);

// session 归一化中间件。
// ⚠️ 原来这里又调了一次 getServerSession()：session 在 createTRPCContext()
//    里已经取过了，同一个请求取两遍（JWT 验签 + 可能一次数据库查询）纯属双倍开销；
//    更糟的是这两份结果在极端情况下（请求处理途中 session 正好过期）可能不一致，
//    用哪一份全看运气。
//    现在优先复用 ctx 里已有的那份；保留兜底只是给「不走 route handler、
//    自己拼 ctx 直接调用」的场景（将来加 server caller）留口子。
export const withSessionMiddleware = t.middleware(async ({ ctx, next }) => {
  const session = ctx.session ?? (await getServerSession());

  return next({
    ctx: {
      ...ctx,
      session,
    },
  });
});

// 登录校验：未登录直接 UNAUTHORIZED。
// ⚠️ 原来抛的是 FORBIDDEN(403)：403 的语义是「已认证，但没权限」，
//    而这里是「压根没登录」，应该是 401 UNAUTHORIZED。
//    混成同一个码之后，前端没法区分「登录过期，跳登录页」和「无权访问，别重试」，
//    只能一律当失败处理。
export const protectedProcedure = withLoggerProcedure
  .use(withSessionMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
    }

    const user = await db.query.users.findFirst({
      where: (users,{eq}) => eq(users.id, ctx.session!.user.id),
      columns: {
        plan: true
      }
    })

    // ⚠️ 原来 `const plan = user!.plan`：session 是自包含 JWT，用户行被删后
    //    session 仍能验签通过 —— 此时 user 是 undefined，非空断言让下面
    //    直接 TypeError（500），而不是一个干净的 401。
    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
    }

    // ⚠️ plan 列可空（GitHub 新用户为 null，见 user.ts getPlan 的兜底注释）。
    //    原来 null 原样下发：下游 `ctx.plan === "free"` 对 null 判 false，
    //    null 会被当成【付费档】—— 新用户绕过「free 限 1 应用/1 文件」的全部限制。
    //    与 getPlan 保持同一语义：null 归一化为 "free"。
    const plan = user.plan ?? "free";

    // ⚠️ 原来是 ctx.session! —— 非空断言没必要：
    //    上一句的 `!ctx.session?.user` 已经把 ctx.session 收窄成 Session 了
    //    （可选链的判空会连带收窄基对象）。留着断言反而会掩盖以后改坏的情况。
    return next({
      ctx: {
        ...ctx,
        session: ctx.session,
        plan,
      },
    });
  });

// 两条鉴权路径共用的查询：按 key 或 clientId 拉密钥记录，
// 连同 app → user / storage 一起带出来（下游签名要用存储配置）。
function lookup(by: { key: string } | { clientId: string }) {
  return db.query.apiKeys.findFirst({
    where: (apiKeys, { eq, and, isNull }) =>
      "key" in by
        ? and(eq(apiKeys.key, by.key), isNull(apiKeys.deletedAt))
        : and(eq(apiKeys.clientId, by.clientId), isNull(apiKeys.deletedAt)),
    with: {
      app: {
        with: {
          user: true,
          storage: true,
        },
      },
    },
  });
}

type ApiKeyRecord = NonNullable<Awaited<ReturnType<typeof lookup>>>;

// 外部 API（SDK / CLI）用 `api-key` 请求头鉴权的 procedure。
// 与 protectedProcedure 平行：那个靠 session，这个靠应用密钥，互不依赖，
// 所以这里刻意不接 withSessionMiddleware（外部调用方本来就没有登录态）。
//
// ⚠️ 目前还没有任何路由挂它（router.ts 里只有 file / apps / storages /
//    apiKeys / hello），属于「待接入」的基础件。但即使没人用也必须能编译：
//    本文件的报错会让整个 AppRouter 的类型构建失败，前端 trpc.* 连带全挂。
// 两种凭证二选一：
//   · api-key       —— 直接持钥，适合服务端到服务端
//   · signed-token  —— 用 api-key 签出的 JWT（payload 带 clientId），
//                      适合「不想在调用方明文放 key」的场景
// ⚠️ 门卫条件必须是 ||（二选一），不能是 &&：
//    原来 if (!apiKey || !signedToken) 同时要求两个头，
//    导致下面 if(apiKey){}else{} 的 else 分支永远执行不到 —— 死代码，
//    JWT 路径写了也白写。
export const withAppProcedure = withLoggerProcedure.use(
  async ({ ctx, next }) => {
    // ⚠️ Next 15+ / 16 的 headers() 是异步的：
    //      declare function headers(): Promise<ReadonlyHeaders>
    //    原来既没 import（TS2552），又没 await —— 不 await 就是在 Promise 上
    //    调 .get()，运行时直接 TypeError，而且「没带 header」和「带了 header」
    //    会以同一种方式炸，排查时极具迷惑性。
    const header = await headers();
    const apiKey = header.get("api-key");
    const signedToken = header.get("signed-token");

    if (!apiKey && !signedToken) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "缺少 api-key 或 signed-token 请求头" });
    }

    // 两条路径共同的收尾：把 app / user 塞进 ctx。
    // ⚠️ tRPC v11 的 next() 只接受 { ctx?, input? }，不能把字段平铺进去；
    //    且必须展开 ...ctx：createTRPCContext 放进来的 session 等字段不能丢。
    const finish = (record: ApiKeyRecord) =>
      next({
        ctx: {
          ...ctx,
          app: record.app,
          user: record.app.user,
        },
      });

    if (apiKey) {
      const record = await lookup({ key: apiKey });

      // ⚠️ 无效密钥一律 401，不要回 404：
      //    ① 404 的语义是「资源不存在」，SDK 会当普通业务错误处理甚至重试；
      //    ② 「没带 header」和「带了但不对」必须同码，否则等于把
      //       「这个 key 库里存不存在」做成了可探测的预言机。
      //    message 也别写「记录不存在」，不要泄露库内信息。
      // ⚠️ 要连带检查关系完整性：apps.userId 是裸 text（没有 .references()），
      //    孤儿 app 下 user 是 null；app 被软删后若不拦，旧密钥仍能调接口。
      if (!record || !record.app || record.app.deletedAt || !record.app.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "api-key 无效" });
      }

      return finish(record);
    }

    // ---- signed-token 路径（没带 api-key 才走到这）----
    // 门卫只保证了「两个头至少有一个」，TS 推不出 signedToken 非空，
    // 不收窄的话下面 jwt.decode / jwt.verify 全是 string | null（TS2345/TS2769）。
    if (!signedToken) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "缺少 signed-token 请求头" });
    }

    // decode 只解 payload 不验签 —— 这里是故意的：
    // 得先从 token 里拿到 clientId 才能查出「用哪把 key 验签」，
    // 验签在下面 jwt.verify 一步做。所以这步不能提前抛「签名无效」。
    const payload = jwt.decode(signedToken);

    // jwt.decode 对畸形 token 返回 null，对字符串 JWT 返回 string ——
    // 盲转 JwtPayload 会把这两种都放过去，到 .clientId 才炸。
    if (!payload || typeof payload !== "object" || !payload.clientId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "signed-token 无效" });
    }

    const tokenRecord = await lookup({ clientId: payload.clientId as string });

    if (!tokenRecord || !tokenRecord.app || tokenRecord.app.deletedAt || !tokenRecord.app.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "signed-token 无效" });
    }

    try {
      // ⚠️ 必须显式锁算法：不锁的话 verify 按 token 头里的 alg 放行，
      //    alg-confusion / none 攻击就是吃这个口子。
      //    exp / nbf 由 verify 自动校验 —— 前提是签发时真的写了
      //    expiresIn，否则 token 永久有效，等于又一个不过期的 api-key。
      jwt.verify(signedToken, tokenRecord.key, { algorithms: ["HS256"] });
    } catch {
      // ⚠️ 用 UNAUTHORIZED(401) 不是 BAD_REQUEST(400)：
      //    凭证无效/过期是「身份没验过」，400 是「请求参数有问题」。
      //    调用方（SDK）按 401 决定要不要刷新凭证，按 400 只会当成参数错误。
      throw new TRPCError({ code: "UNAUTHORIZED", message: "signed-token 无效或已过期" });
    }

    return finish(tokenRecord);
  }
);
