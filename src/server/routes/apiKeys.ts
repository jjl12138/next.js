import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db } from "../db/db";
import { apiKeys, apps } from "../db/schema";
import { protectedProcedure, router } from "../trpc";

export const apiKeysRouter = router({
  listApiKeys: protectedProcedure
    // ⚠️ 必须是 z.uuid()，不能是 z.number()：apps.id 是 uuid 列，
    //    传数字会让 PG 抛 invalid input syntax for type uuid → 裸 500，
    //    而不是一个干净的校验错误。（跟 storages.ts 的 bindStorage 一致。）
    .input(z.object({ appId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      // ⚠️ 先验 app 归属：只按 appId 过滤的话，任何登录用户改个数字
      //    就能枚举别人应用下的密钥（IDOR）。跟 storages.ts 的 bindStorage 同一套路。
      const [app] = await db
        .select({ id: apps.id })
        .from(apps)
        .where(
          and(
            eq(apps.id, input.appId),
            eq(apps.userId, ctx.session.user.id),
            isNull(apps.deletedAt)
          )
        )
        .limit(1);

      if (!app) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "应用不存在或无权访问",
        });
      }

      return db.query.apiKeys.findMany({
        // ⚠️ 绝对不能整行返回：key 就是密钥本体，tRPC 会把它原样 JSON
        //    序列化进 HTTP 响应 —— 浏览器 devtools 里看一眼 Network 就拿到了。
        //    clientId 是「账号名」性质的非敏感标识（单独拿到它没有 key 配对
        //    什么也干不了），可以回显；key 永远不回列表，只在创建时明文展示一次。
        columns: { id: true, name: true, clientId: true, createdAt: true },
        where: (apiKeys, { eq, and, isNull }) =>
          and(eq(apiKeys.appId, input.appId), isNull(apiKeys.deletedAt)),
        orderBy: (apiKeys, { desc }) => [desc(apiKeys.createdAt)],
      });
    }),

  createApiKey: protectedProcedure
    .input(
      z.object({
        // ⚠️ 不能只写 z.string()：空串 "" 会通过校验并成功入库，
        //    然后上传时 cosCredentials() 才报「未配置密钥」，
        //    错误出现在离出错现场很远的地方。这里就拦掉。
        name: z.string().trim().min(3).max(100),
        appId: z.uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ⚠️ 同上：不验归属的话，可以给【别人的应用】发密钥。
      const [app] = await db
        .select({ id: apps.id })
        .from(apps)
        .where(
          and(
            eq(apps.id, input.appId),
            eq(apps.userId, ctx.session.user.id),
            isNull(apps.deletedAt)
          )
        )
        .limit(1);

      if (!app) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "应用不存在或无权访问",
        });
      }

      const [created] = await db
        .insert(apiKeys)
        .values({
          name: input.name,
          // ⚠️ 原来写成 `uuid()`，而 uuid 是从 "zod" import 的 ——
          //    zod v4 的顶层 uuid 是【schema 构造器】，uuid() 返回的是一个
          //    ZodUUID 对象（{ def: { format: "uuid" }, type: "string" }），
          //    不是随机字符串。塞进 varchar 列要么写进 "[object Object]"，
          //    要么直接被驱动拒绝，而且 tsc 会报 TS2769。
          //    生成随机 ID 请用 crypto.randomUUID()（schema.ts 里也是这个写法）
          //    或 uuid 包的 v4（apps.ts 里是 `import { v4 as uuid } from "uuid"`）。
          key: crypto.randomUUID(),
          appId: input.appId,
          clientId: crypto.randomUUID(),
        })
        // ⚠️ 绝不能 .returning() 不带 columns：整行返回不可控，字段一多
        //    （将来加 revokedAt / lastUsedAt / 元数据）就会被顺带泄出去。
        //    这里显式列出要回的字段。
        //    注：key 【这次必须回】—— 它是明文密钥，创建时是唯一一次能拿到
        //    完整值的机会，之后列表接口只会回 id / name。
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          key: apiKeys.key,
          createdAt: apiKeys.createdAt,
        });

      // returning() 没吐出行 = 插入被拒，别把 undefined 当成功返回给前端。
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "创建密钥失败",
        });
      }

      return created;
    }),
});
