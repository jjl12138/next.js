import { db } from "../db/db";
import { apps, apiKeys, files, storageConfiguration } from "../db/schema";
import { protectedProcedure, router } from "../trpc";
import { v4 as uuid } from "uuid";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// ⚠️ 原来这里 import 了 `createAppSchema`，但 validate-schema.ts 里【根本没有】
//    这个导出 → TS2305，整个文件编译不过，连带 /api/trpc 的类型一起废掉。
//    按「只动这两个文件」的要求，这里就地定义；长度跟 schema.ts 里的
//    varchar(100) / varchar(500) 对齐，避免超长时 PG 抛 value too long。
//    想统一收进 validate-schema.ts 的话，把这段搬过去再 export 即可。
const createAppSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(100, "名称过长"),
  description: z.string().trim().max(500, "描述过长").nullish(),
});

export const appsRouter = router({
    createApp: protectedProcedure.input(createAppSchema.pick({name: true, description: true})).mutation(async ({ctx, input}) => {
        // ⚠️ 原来 `const isFreePlan = ctx.plan` 后直接 if(isFreePlan)：
        //    ctx.plan 是字符串 'free'/'paid'，两个都是 truthy → 付费用户
        //    也被当成免费档限制到 1 个应用。必须显式比较。
        const isFreePlan = ctx.plan === "free";

        if(isFreePlan){
            const appCountResult = await db.select({count: count()}).from(apps).where(and(eq(apps.userId, ctx.session.user.id), isNull(apps.deletedAt)));
            const appCount = appCountResult[0].count;

            if(appCount >= 1){
                throw new TRPCError({
                    code: "FORBIDDEN",
                    // ⚠️ 原来 message 为空：新建应用页 catch 后把空字符串写进
                    //    ?error=，页面只显示一条空白红字。带上可读信息。
                    message: "免费版最多创建 1 个应用，升级 Pro 解锁无限应用",
                });
            }
        }

        const [app] = await db.insert(apps).values({
            id: uuid(),
            name: input.name,
            description: input.description ?? null,
            // ⚠️ 归属一律取 session 里的 userId，不接受客户端传 ——
            //    否则可以替别人建应用。
            userId: ctx.session.user.id
        }).returning();

        // returning() 没吐出行 = 插入被拒（将来补了 (user_id, name) 唯一约束后
        // 重名就会走到这里），别把 undefined 当成功返回给前端。
        if (!app) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建应用失败" });
        }

        return app;
    }),

    // ⚠️ 这条查询是必需的：saveFile 现在要求传 appId，但前端没有任何渠道
    //    拿到当前用户的 app 列表 → 拿不到 id 就没法上传（死循环）。
    //    如果前端另有渠道取 appId，这条可以直接删掉。
    listApps: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
      .query(async ({ ctx, input }) => {
        return db.query.apps.findMany({
          where: and(
            eq(apps.userId, ctx.session.user.id),
            isNull(apps.deletedAt)
          ),
          orderBy: [desc(apps.createdAt)],
          limit: input.limit,
        });
      }),

    changeStore: protectedProcedure.input(
        z.object({
            // ⚠️ 必须 z.uuid()：apps.id 是 uuid 列，裸 z.string() 传非法值
            //    会让 PG 抛 invalid input syntax for type uuid → 裸 500
            //    （与 bindStorage / listApps 的口径一致）。
            appId: z.uuid(),
            storageId: z.number().int().positive()
        })
    ).mutation(async ({ctx, input}) =>{

        // ⚠️ 必须排除软删除的存储：bindStorage 拦了，这里漏了，口径要一致 ——
        //    否则已删存储仍能从这里绑回应用。
        const storage = await db.query.storageConfiguration.findFirst({
            where: (storages, { eq, and, isNull }) =>
              and(eq(storageConfiguration.id, input.storageId), isNull(storageConfiguration.deletedAt))
        })

        if(storage?.userId !== ctx.session.user.id){
            throw new TRPCError({
                code: "FORBIDDEN"
            })
        }

        // ⚠️ where 原来不排软删除的应用：已删 app 还能被换绑存储。
        await db.update(apps).set({
            storageId: input.storageId
        }).where(and(eq(apps.id, input.appId), eq(apps.userId, ctx.session.user.id), isNull(apps.deletedAt)))
    }),

    // 软删除应用（settings/danger 页「Delete App」）：
    //   · apps 记录打 deletedAt，列表（listApps）和详情查询全部过滤掉；
    //   · 顺带软删该 app 下未删除的 files 记录 —— 不删的话 /image/[id]
    //     路由还能按文件 id 命中被删应用的图，删除语义不完整；
    //   · 顺带软删该 app 的 apiKeys —— danger 页文案承诺「API Key 立即失效」，
    //     withAppProcedure 是按 appId 实时查库的，打上 deletedAt 即刻 403。
    // COS 上的对象不动：与 UI 上删除单个文件同一策略，可恢复、省流量。
    // 三条 UPDATE 各带归属 + isNull 守卫，重复调用幂等。
    deleteApp: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const ownership = and(
          eq(apps.id, input.id),
          eq(apps.userId, ctx.session.user.id),
          isNull(apps.deletedAt)
        );

        const [deleted] = await db
          .update(apps)
          .set({ deletedAt: now })
          .where(ownership)
          .returning({ id: apps.id });

        // 没删到行 = 应用不存在 / 不是你的 / 已经删过，统一 404 不区分，
        // 避免给调用方暴露「这个 id 属于别人」的存在性信息。
        if (!deleted) {
          throw new TRPCError({ code: "NOT_FOUND", message: "应用不存在或已删除" });
        }

        await db
          .update(files)
          .set({ deletedAt: now })
          .where(and(eq(files.appId, input.id), isNull(files.deletedAt)));

        await db
          .update(apiKeys)
          .set({ deletedAt: now })
          .where(and(eq(apiKeys.appId, input.id), isNull(apiKeys.deletedAt)));

        return { id: deleted.id };
      })
})
