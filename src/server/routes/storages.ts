import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

import { db } from "../db/db";
import { apps, storageConfiguration } from "../db/schema";
import { protectedProcedure, router } from "../trpc";

// 跟 files.ts 里的默认值保持一致：apiEndpoint 留空时用这个 endpoint 签名。
const defaultEndpoint =
  process.env.COS_ENDPOINT ?? "https://cos.ap-guangzhou.myqcloud.com";
const defaultRegion = process.env.COS_REGION ?? "ap-guangzhou";

// 腾讯云 COS 的桶名必须带 APPID 后缀：<名称>-<APPID>，
// 例如 test-image-1420857858。
//
// 为什么要在【入库前】拦：之前库里躺过一条 bucket="seeds"、密钥="dssd" 的
// 占位配置，绑到应用上以后，预签名 URL 指向 seeds.cos.ap-guangzhou...
// 这个根本不存在的桶，COS 在【预检阶段】就返回 400
// （Missing required header: Appid），浏览器拿不到响应头 →
// XHR status 0 → 前端只看到 `Network error during S3 request`。
// 错误现场离真正的原因隔了好几层，用户第一反应是「我网络没问题啊」。
// 在创建这一步就拒掉，就把错误推回了离用户最近的地方。
const COS_BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}-\d{6,}$/;

function isCosEndpoint(endpoint: string) {
  try {
    return /(^|\.)myqcloud\.com$/i.test(new URL(endpoint).hostname);
  } catch {
    // zod 已经把 apiEndpoint 校验成合法 URL 了，走不到这里；兜底当作 COS 处理
    return true;
  }
}

// 建配置时顺手探一下桶在不在、密钥认不认。
//
// 只拦「明确是配置错」的几种：桶不存在 / 密钥无效。
// 遇到 AccessDenied 一律放行 —— 只给了 PutObject 权限的子账号
// HeadBucket 本来就会 403，那不是配置错误，拦掉会让正常账号建不了配置。
async function assertBucketLooksReal(configuration: {
  bucket: string;
  region?: string;
  apiEndpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  const client = new S3Client({
    endpoint: configuration.apiEndpoint ?? defaultEndpoint,
    region: configuration.region ?? defaultRegion,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  });

  try {
    await client.send(
      new HeadBucketCommand({ Bucket: configuration.bucket }),
      // 网络不通时不要一直挂着：8 秒拿不到结论就放行，
      // 别让「云服务临时抽风」变成「建不了存储配置」。
      { abortSignal: AbortSignal.timeout(8000) }
    );
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;

    if (name === "AccessDenied" || status === 403) return; // 权限受限，放行
    if (name === "TimeoutError" || name === "AbortError") return; // 网络问题，放行

    if (name === "NotFound" || name === "NoSuchBucket" || status === 404) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `桶「${configuration.bucket}」不存在，检查一下桶名是否写全了（COS 格式是「名称-APPID」）`,
      });
    }
    if (name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "AccessKeyId / SecretAccessKey 校验不通过，检查一下是不是复制漏了",
      });
    }
    // 其它错误不阻断创建：这里只是「顺便探一下」，不该比真正的上传更严格。
  }
}

export const storagesRouter = router({
  listStorages: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.query.storageConfiguration.findMany({
      // ⚠️ 绝对不能整行返回：configuration 里躺着 accessKeyId / secretAccessKey，
      //    tRPC 会把它原样 JSON 序列化进 HTTP 响应 —— 打开浏览器 devtools
      //    看一眼 Network 就能拿到完整密钥，等于把 COS 账号公开。
      //    密钥【永远】不出服务器；列表页只回显非敏感字段
      //    （bucket / region / apiEndpoint），见下面的 map。
      columns: { id: true, name: true, createdAt: true, configuration: true },
      where: (storages, { eq, and, isNull }) =>
        and(
          eq(storages.userId, ctx.session.user.id),
          isNull(storages.deletedAt)
        ),
      orderBy: (storages, { desc }) => [desc(storages.createdAt)],
    });

    // ⚠️ 在服务端把 configuration 白名单化：只挑这三个字段，
    //    密钥（accessKeyId / secretAccessKey）连 HTTP 响应都进不去。
    //    以后新增非敏感字段在这里加，别在前端直接读整行。
    return rows.map(({ configuration, ...rest }) => ({
      ...rest,
      configuration: {
        region: configuration.region,
        bucket: configuration.bucket,
        apiEndpoint: configuration.apiEndpoint,
      },
    }));
  }),

  // 把某个存储绑到某个应用上（apps.storage_id）。
  // 路由在 /dashboard/apps/[id]/storage，本来就是干这个的。
  bindStorage: protectedProcedure
    .input(
      z.object({
        // ⚠️ 必须是 uuid / int，不能是裸 z.string()：
        //    apps.id 是 uuid 列、storageConfiguration.id 是 serial(int)，
        //    非法值直接进 where 会让 PG 抛
        //      invalid input syntax for type uuid
        //    → 裸 500，而不是一个干净的校验错误。
        appId: z.uuid(),
        storageId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // ⚠️ 两个都要验归属，缺一不可：
      //   · 只验 app  → 能把【别人的存储】绑到自己应用上（读到别人的桶）
      //   · 只验存储  → 能把存储绑到【别人的应用】上（往别人应用里塞文件）
      const [app] = await db
        .select({ id: apps.id })
        .from(apps)
        .where(
          and(
            eq(apps.id, input.appId),
            eq(apps.userId, userId),
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

      const [storage] = await db
        .select({ id: storageConfiguration.id })
        .from(storageConfiguration)
        .where(
          and(
            eq(storageConfiguration.id, input.storageId),
            eq(storageConfiguration.userId, userId),
            isNull(storageConfiguration.deletedAt)
          )
        )
        .limit(1);

      if (!storage) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "存储不存在或无权访问",
        });
      }

      const [updated] = await db
        .update(apps)
        .set({ storageId: input.storageId })
        .where(eq(apps.id, input.appId))
        .returning({ id: apps.id, storageId: apps.storageId });

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "绑定存储失败",
        });
      }

      return updated;
    }),

  // 解绑（apps.storage_id = null）。绑上去之后没有解绑就是个死胡同：
  // 换存储、停用存储都得先解开。
  unbindStorage: protectedProcedure
    .input(z.object({ appId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(apps)
        .set({ storageId: null })
        .where(
          and(
            eq(apps.id, input.appId),
            eq(apps.userId, ctx.session.user.id),
            isNull(apps.deletedAt)
          )
        )
        .returning({ id: apps.id, storageId: apps.storageId });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "应用不存在或无权访问",
        });
      }

      return updated;
    }),

  createStorage: protectedProcedure
    .input(
      z.object({
        // ⚠️ 不能只写 z.string()：空串 "" 会通过校验并成功入库，
        //    然后上传时 cosCredentials() 才报「未配置密钥」，
        //    错误出现在离出错现场很远的地方。这里就拦掉。
        name: z.string().trim().min(3).max(100),
        bucket: z.string().trim().min(1),
        region: z.string().trim().min(1),
        accessKeyId: z.string().trim().min(1),
        secretAccessKey: z.string().trim().min(1),
        // ⚠️ 空串必须先转成 undefined 再走 optional：
        //    Input 留空时 react-hook-form 提交的是 ""，【不是 undefined】，
        //    而 .url().optional() 只豁免 undefined，"" 会被 url() 判失败
        //    → 表单上写着「选填」，留空却提交失败，这是最容易撞上的一条。
        apiEndpoint: z
          .string()
          .trim()
          // ⚠️ optional() 必须在 transform 【之前】：写在后面的话 undefined
          //    会先在 z.string() 处挂掉（expected string, received undefined），
          //    等于「不传这个字段」反而比「传空串」更容易失败。
          .optional()
          .transform((v) => (v === undefined || v.length === 0 ? undefined : v))
          .pipe(z.url().optional()),
      })
        // ⚠️ 用 superRefine 而不是给 bucket 加 .regex()：
        //    只有「走 COS endpoint」时才该要求 <名称>-<APPID> 格式，
        //    换成 MinIO / R2 这类自建 endpoint 时桶名规则完全不同，
        //    统一按 COS 校验会把正常配置也拒掉。
        .superRefine((val, ctx) => {
          const endpoint = val.apiEndpoint ?? defaultEndpoint;
          if (!isCosEndpoint(endpoint)) return;

          if (!COS_BUCKET_PATTERN.test(val.bucket)) {
            ctx.addIssue({
              code: "custom",
              path: ["bucket"],
              message: `COS 桶名必须是「名称-APPID」，比如 test-image-1420857858；"${val.bucket}" 少了 APPID 后缀`,
            });
          }
          // 地域写错不会立刻报错，但签名会指向错误的数据中心，
          // 表现为上传超时 —— 顺手在这里拦掉明显的拼写错误。
          if (!/^[a-z]{2}-[a-z]+(-[a-z0-9]+)?$/.test(val.region)) {
            ctx.addIssue({
              code: "custom",
              path: ["region"],
              message: `地域格式不对，COS 一般是 ap-guangzhou / ap-shanghai 这种写法；"${val.region}" 看起来不是地域`,
            });
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      const { name, ...configuration } = input;

      // 格式对了不代表桶真的存在、密钥真的能用 —— 建之前先探一下，
      // 免得又攒出一条只能在上传时才炸的配置。
      await assertBucketLooksReal(configuration);

      const [created] = await db
        .insert(storageConfiguration)
        .values({
          name,
          configuration,
          // ⚠️ userId 取 session，【不收客户端传】—— 否则能把存储建到别人名下。
          userId: ctx.session.user.id,
        })
        // ⚠️ 绝不能 .returning() 不带 columns：整行返回会把 configuration
        //    （含 accessKeyId / secretAccessKey）原样 JSON 序列化回前端，
        //    等于「写进去什么就吐回来什么」，浏览器 devtools 里明文可见。
        //    只回 id / name，跟 listStorages 保持一致。
        .returning({ id: storageConfiguration.id, name: storageConfiguration.name });

      return created;
    }),
});
