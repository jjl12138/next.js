import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { TRPCError } from "@trpc/server";
import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/server/db/db";
import { apps, files, type StorageConfiguration } from "@/server/db/schema";
// desc / eq / isNull 都来自 drizzle-orm，不是 drizzle-orm/pg-core
import { and, asc, count, desc, eq, exists, gt, isNull, lt, or, sql, SQL } from "drizzle-orm";
import { filesCanOrderByColumns } from "../db/validate-schema";

// ── 游标编解码（infinityQueryFiles 用） ────────────────────────────────────
// 游标 = 排序列名 | 排序方向 | 该行排序列的值 | 主键 id
//
// 为什么必须带排序列和方向：
//   「下一页」的语义是「在 ORDER BY 排出的顺序里，严格排在这条记录之后」。
//   换一列排，之前那个值就不再是有效的分界点了 —— 拿 createdAt 的游标
//   去翻按 name 排的页，比较的是两个不相干的列，结果必然重复 + 丢数据。
//   带上之后可以在解码时校验，不匹配直接 400，而不是静默返回错数据。
//
// 为什么还要带 id：排序列的值会撞（同一毫秒创建、同名文件），
// 撞了就分不清谁在前谁在后。id 是主键、全局唯一、插入后永不改变，
// 用来做第二排序键打破平手（ORDER BY 里也带着它，见下面的 orderBy）。
function badCursor(): never {
  // 游标是服务端签发的，正常流程不会出现非法值；
  // 出现了说明有人手工构造请求，直接 400 而不是让它穿透到 SQL 层。
  throw new TRPCError({ code: "BAD_REQUEST", message: "cursor 格式非法" });
}

function encodeCursor(
  value: Date | string | null | undefined,
  id: string,
  field: string,
  order: "asc" | "desc"
): string {
  // null / undefined 退化成该类型的最小值，保证游标始终可解析 ——
  // 一条脏数据不会让整条分页链断掉。
  const normalized =
    value ?? (field === "createdAt" ? new Date(0) : "");
  const tag = normalized instanceof Date ? "d" : "s";
  const raw =
    normalized instanceof Date ? normalized.toISOString() : normalized;
  // 各段都过 encodeURIComponent：文件名里可能有 | 或 :，
  // 不转义的话下面按 | 切段会切错位置。
  return [
    field,
    order,
    `${tag}:${encodeURIComponent(raw)}`,
    encodeURIComponent(id),
  ].join("|");
}

function decodeCursor(cursor: string): {
  field: string;
  order: "asc" | "desc";
  value: Date | string;
  id: string;
} {
  const parts = cursor.split("|");
  if (parts.length !== 4) badCursor();
  const [field, order, tagged, rawId] = parts;
  const colon = tagged.indexOf(":");
  const id = decodeURIComponent(rawId);
  if (colon === -1 || !id || !field) badCursor();
  if (order !== "asc" && order !== "desc") badCursor();

  const tag = tagged.slice(0, colon);
  const raw = decodeURIComponent(tagged.slice(colon + 1));
  if (tag === "d") {
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) badCursor();
    return { field, order, value, id };
  }
  if (tag === "s") return { field, order, value: raw, id };
  return badCursor();
}

const filesOrderByColumnSchema = z.object({
            field: filesCanOrderByColumns.keyof(),
            order: z.enum(['desc', 'asc'])
        }).optional()

export type FilesOrderByColumnSchema = z.infer<typeof filesOrderByColumnSchema>


// ⚠️ 密钥绝不能硬编码在源码里。这个文件一旦进 Git（或截图/贴日志）就等于泄露。
// 已改为从 .env 读，且建议去腾讯云控制台 regenerate 一次
// —— 原来的密钥已经出现在终端日志和对话里了。
// ⚠️ 对象名的「URL 编码」边界 —— 这是本项目最容易出错的一处约定：
//
//   COS / S3 上的真实对象名（Object Key）是【原始 UTF-8 中文】：
//      2026-10-25/微信图片_20261024180226_151_135.jpg
//   而 HTTP URL 里的 pathname 是【百分号编码】的：
//      /2026-10-25/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_....jpg
//
//   AWS SDK 拿到 Key 后会自己再做一次 percent-encode。所以：
//      ✅ Key 传【原始中文】→ SDK 编码成 %E5%BE%AE... → 命中对象
//      ❌ Key 传【已编码】的字符串 → % 被二次编码成 %25E5%BE%AE...
//         → 找的是名字里字面含 %E5%BE%AE 的对象 → COS 返回 NoSuchKey
//
//   实测复现：同一张图，原样传 NoSuchKey，decode 后取到 4,580,631 bytes。
export function decodeObjectKey(keyOrPathname: string): string {
  try {
    return decodeURIComponent(keyOrPathname);
  } catch {
    // 文件名里可能本来就带孤立的 %（如 "完成度 100%.jpg"），
    // decodeURIComponent 会抛 URIError。这种情况它已经是原始 key，原样返回。
    return keyOrPathname;
  }
}

// ⚠️ 这两个只是【兜底默认值】：真正的 endpoint / region / 桶名 / 密钥
//    来自应用绑定的 storage 配置（apps.storage_id → storageConfiguration.configuration）。
//    只有应用没绑 storage 时才退回这里。别再往源码里抄真实密钥。
const apiEndpoint = process.env.COS_ENDPOINT ?? "https://cos.ap-guangzhou.myqcloud.com";
const region = process.env.COS_REGION ?? "ap-guangzhou";

// ── COS 账号 / 客户端 ─────────────────────────────────────────────────────
// ⚠️ 凭据现在是【按应用】的，来自该应用绑定的 storage 配置，不再是全局环境变量。
//    所以这两个函数必须【接收 storage 作为参数】—— 上一版直接引用了一个
//    根本不存在的模块级 `storage`，编译期 TS2552、运行期 ReferenceError，
//    createPresignedUrl 一调用就 500。
function cosCredentials(configuration: StorageConfiguration) {
  const { accessKeyId, secretAccessKey } = configuration;
  // ⚠️ 校验不能写在模块顶层：那会让这个模块【导入即崩】，
  //    缺配置时连 /api/trpc 下的其它接口一起 500，报错还定位不到真正的原因。
  //    挪到真正要用的地方抛，影响面只剩这一个 mutation。
  if (!accessKeyId || !secretAccessKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "该存储的 accessKeyId / secretAccessKey 未配置，无法生成预签名 URL",
    });
  }
  return { accessKeyId, secretAccessKey };
}

// ⚠️ 缓存必须【按 storage 维度分开】，不能是全局单例：
//    单例会把第一个应用的 endpoint + 凭据建出来的 client 拿给后面【所有】应用复用，
//    结果是用 A 的账号去给 B 的桶签名 → 403（更糟的情况是签到了别的桶上）。
//    按 storage id 分桶缓存，既复用连接池，又不会串号。
const s3ClientCache = new Map<number, S3Client>();

export function getS3Client(
  storageId: number,
  configuration: StorageConfiguration
): S3Client {
  const cached = s3ClientCache.get(storageId);
  if (cached) return cached;

  const client = new S3Client({
    endpoint: configuration.apiEndpoint ?? apiEndpoint,
    region: configuration.region ?? region,
    credentials: cosCredentials(configuration),
  });
  s3ClientCache.set(storageId, client);
  return client;
}

// ── 入参校验 ──────────────────────────────────────────────────────────────
// ⚠️ 对象键必须后端校验：key 是【客户端】给的，不校验就等于任何登录用户
//    都能往桶里任意位置 PUT —— 覆盖别人已上传的对象、写进不该写的路径。
//    这里挡住最直接的几类：空串、以 / 开头、含 .. 的路径穿越、控制字符。
//    （注意：真正的「按用户隔离目录」还需要前端 generateObjectKey 也带上 userId
//     前缀，那是前后端一起改的事，这里先把明显的越界挡掉。）
const objectKeySchema = z
  .string()
  .trim()
  .min(1, "key 不能为空")
  .max(1024, "key 过长")
  .refine((k) => !k.startsWith("/"), "key 不能以 / 开头")
  .refine((k) => !k.split("/").includes(".."), "key 不能包含路径穿越的 ..")
  .refine((k) => !/[\x00-\x1f\x7f]/.test(k), "key 含不可见控制字符");

// contentType 会被原样签进 PUT 请求，也会存进 DB 拿去给浏览器用，
// 空串会让签名带上一个不存在的 Content-Type 头 → COS 直接 403。
const contentTypeSchema = z
  .string()
  .trim()
  .min(1, "contentType 不能为空")
  // ⚠️ 补上 max(100)：files.type / files.content_type 都是 varchar(100)，
  //    超长的值一路送到 PG 才是 "value too long for type character varying(100)"
  //    → 500，而不是一条能看懂的校验错误。
  .max(100, "contentType 过长")
  .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, "contentType 必须是 type/subtype 格式");

// 允许入库的 URL 必须落在【这个应用绑定的存储】域名下，
// 否则可以拿任意外链（甚至内网地址）伪造一条文件记录。
//
// ⚠️ endpoint 必须从应用自己的 storage 配置取，不能用全局 env：
//    现在每个应用可以绑不同的存储（不同地域 / 不同服务商），
//    拿全局 endpoint 去比对，要么误杀合法地址，要么放过别的桶。
function isOwnCosUrl(url: URL, endpoint: string, bucket?: string): boolean {
  const endpointHost = new URL(endpoint).hostname; // cos.ap-guangzhou.myqcloud.com
  const domainSuffix = endpointHost.split(".").slice(1).join("."); // ap-guangzhou.myqcloud.com
  // 真实地址是带桶名的子域：test-image-1420857858.cos.ap-guangzhou.myqcloud.com
  const hostOk =
    url.hostname === endpointHost || url.hostname.endsWith(`.${domainSuffix}`);
  if (!hostOk) return false;
  if (!bucket) return true;
  // 桶名也要对得上，否则 A 应用可以伪造一条指向 B 应用私有桶的记录。
  // 虚拟托管风格桶名在 host 前缀（<bucket>.<host>），path 风格在首段（/<bucket>/）。
  return (
    url.hostname.startsWith(`${bucket}.`) ||
    url.pathname.startsWith(`/${bucket}/`)
  );
}

// 注意 input  shape 跟着 @uppy/aws-s3 v6 的 signRequest 改了：
// v6 的 PresignableRequest 只有 { key, contentType }，没有 file 对象，
// 所以拿不到 size / 原始文件名，只能传 key 和 contentType。
export const fileRoutes = router({
  
  saveFile: protectedProcedure.input(
    z.object({
        // ⚠️ name 是 varchar(100)：原来只写了 min(1)，长文件名会一路穿到 PG，
        //    报的是 "value too long for type character varying(100)"（500），
        //    而不是一条能看懂的 400。这里按列宽截断到同一个上限。
        name: z.string().trim().min(1).max(100, "name 过长"),
        path: z.string().min(1),
        // ⚠️ 复用 contentTypeSchema，别再写 z.string().min(1)：
        //    这个值会原样存进 type / content_type，之后还要拿去当
        //    Content-Type 发给浏览器（image/[id]/route.ts）。格式不对的话
        //    存得进去、显示不出来，且排查时完全看不出问题出在入库这一步。
        type: contentTypeSchema,
        // ⚠️ 必须是 uuid：下面是拿它跟 files.app_id（PG 的 uuid 列）比的，
        //    传个普通字符串过去 PG 会抛 invalid input syntax for type uuid → 500，
        //    而不是友好的校验错误。
        appId: z.uuid("appId 不是合法的 uuid")
    })
  ).mutation(async ({ctx, input}) => {
    // mutation 的第二个参数是 { ctx, input }，没有 next（next 只在中间件里有）。
    let url: URL;
    try {
      url = new URL(input.path);
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "path 不是合法的 URL" });
    }

    // ⚠️ 光校验 uuid 格式不够，还得确认这个 app 是【你自己的】——
    //    否则拿别人的 appId 也能往别人应用里塞文件记录。
    //    ⚠️ 必须把 storage 一起查出来：要用它自己的 endpoint / bucket
    //    校验下面的 url 归属（见 isOwnCosUrl）。
    const ownedApp = await db.query.apps.findFirst({
      where: and(
        eq(apps.id, input.appId),
        eq(apps.userId, ctx.session.user.id),
        isNull(apps.deletedAt)
      ),
      with: { storage: true },
    });

    if (!ownedApp) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "应用不存在或无权访问",
      });
    }

    const storageConfig = ownedApp.storage?.configuration;
    if (
      !isOwnCosUrl(
        url,
        storageConfig?.apiEndpoint ?? apiEndpoint,
        storageConfig?.bucket
      )
    ) {
      // ⚠️ 关键点：input.path 是【带签名】的 URL
      // （...?X-Amz-Algorithm=...&X-Amz-Signature=...），90 秒后就失效，
      // 而且签名里带着鉴权信息。存库必须剥掉 query，只留 origin + pathname，
      // 否则列表页过一会儿全是 403。
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "只能保存本应用存储上的对象",
      });
    }

    const publicUrl = `${url.origin}${url.pathname}`;

    // ⚠️ 免费限制原来只在 createPresignedUrl 检查，saveFile 完全不校验：
    //    isOwnCosUrl 只验「域名/桶名对不对」，不验 URL 签名，免费用户
    //    手工拼一条本桶 URL 就能无限调 saveFile 入库，绕过「每 app 1 个文件」。
    //    这里补上同一道闸（与 createPresignedUrl 同口径：软删文件不占额度）。
    if (ctx.plan === "free") {
      const [row] = await db
        .select({ count: count() })
        .from(files)
        .where(and(eq(files.appId, input.appId), isNull(files.deletedAt)));
      if (row.count >= 1) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "免费版每个应用只能上传 1 个文件",
        });
      }
    }

    const [photo] = await db.insert(files).values({
        name: input.name,
        // ⚠️ 必须剥掉开头的 / 并【还原】URL 编码 —— 存的是 COS 的对象名，
        //    不是 URL 片段。不 decode 的话后面拿它当 S3 Key 会被二次编码 → NoSuchKey。
        //    url 那一列是给人点/复制用的，保持编码不变（URL 里必须是编码形式）。
        path: decodeObjectKey(url.pathname.replace(/^\//, "")),
        url: publicUrl,
        type: input.type,
        contentType: input.type,
        userId: ctx.session.user.id,
        // ⚠️ 原来收了 input.appId 却【压根没写进库】—— 接口看着生效，
        //    落库后 app_id 永远是 NULL，后面按 app 过滤直接查不到东西。
        appId: input.appId,
    }).returning();

    return photo;
  }),

  createPresignedUrl: protectedProcedure
    .input(
      z.object({
        key: objectKeySchema,
        contentType: contentTypeSchema,
        // ⚠️ 必须是 z.uuid()，不能是 z.string()：下面拿它跟 apps.id
        //    （PG 的 uuid 列）比，传个 "abc" 过去 PG 抛的是
        //      invalid input syntax for type uuid: "abc"
        //    → 500，而不是一条干净的校验错误。
        appId: z.uuid("appId 不是合法的 uuid")
      })
    )
    .mutation(async ({ ctx, input }) => {

      const app = await db.query.apps.findFirst({
        where: and(
          eq(apps.id, input.appId),
          // ⚠️ 必须排除已软删除的应用：否则一个已经「删掉」的 app
          //    还能继续签发上传 URL、往里塞文件。
          isNull(apps.deletedAt)
        ),
        with: {
          storage:true
        }
      })

      if(!app){
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '应用不存在'
        })
      }

      // ⚠️ 用 === 不要用 !=：两边都是 string，不存在需要隐式转换的场景，
      //    用 != 只会给以后（万一某边变成 number）留一个静默判等成功的口子。
      if(app.userId !== ctx.session.user.id){
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '无权访问该应用'
        })
      }

      if(!app.storage){
        // ⚠️ 必须跟「应用不存在」分开报：原来合成一个 BAD_REQUEST 且没有 message，
        //    前端只收到一句 "BAD_REQUEST"，根本分不清是 app 没绑存储还是别的。
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该应用未绑定存储配置'
        })
      }

      const isFreePlan = ctx.plan == "free";

      if (isFreePlan) {
        // ⚠️ 原来数的是【apps】表：where apps.id = app.id 是主键精确匹配，
        //    永远恰好 1 行 → countNum>=1 恒成立 → free 用户上传 100% FORBIDDEN。
        //    业务意图明显是「数该 app 下的文件数」，必须查 files 表，
        //    并排除软删除的（已删的文件不占额度）。
        const alreadyUploadedFilesCountResult = await db
          .select({ count: count() })
          .from(files)
          .where(and(eq(files.appId, app.id), isNull(files.deletedAt)));
        const countNum = alreadyUploadedFilesCountResult[0].count;
        if(countNum >= 1){
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "免费版每个应用只能上传 1 个文件",
          });
        }
      }

      const storage = app.storage

      const params: PutObjectCommandInput = {
        Bucket: storage.configuration.bucket,
        // key 由前端 generateObjectKey 决定，上面已校验过合法性
        Key: input.key,
        ContentType: input.contentType,
      };

      const command = new PutObjectCommand(params);
      // ⚠️ 必须把 storage 传进去：endpoint / region / 凭据全是它的，
      //    getS3Client 已经不读任何全局状态了（原来那个版本引用了
      //    一个不存在的模块级 storage，一调用就 ReferenceError）。
      const url = await getSignedUrl(
        getS3Client(storage.id, storage.configuration),
        command,
        {
          expiresIn: 90,
        }
      );

      return {
        url,
        method: "PUT" as const,
      };
    }),

    // ⚠️ 原来这里没有 where —— 任何人登录都能拉到全部用户的文件（越权读）。
    // 必须按当前登录用户过滤，同时排除软删除的（deleted_at is null）。
    // ⚠️ 还要排除【应用本身被软删除】的情况：deleteApp 只写 apps.deleted_at，
    //    files 表的记录原样保留 —— 不加这层的话，直接访问已删应用的
    //    /dashboard/apps/[id] 照样能列出它全部文件（应用"删了"却还能看）。
    //    用 exists 子查询而不是 innerJoin：不用改 select 形状，语义也更直白。
    listFiles: protectedProcedure.input(z.object({
        appId: z.uuid("appId 不是合法的 uuid")
    })).query(async ({ ctx, input }) => {
        const result = await db.query.files.findMany({
            where: and(
                eq(files.userId, ctx.session.user.id),
                eq(files.appId, input.appId),
                isNull(files.deletedAt),
                exists(
                    db.select({ one: sql`1` })
                      .from(apps)
                      .where(and(
                          eq(apps.id, files.appId),
                          isNull(apps.deletedAt)
                      ))
                )
            ),
            orderBy: [desc(files.createdAt)],
            // ⚠️ 没有 limit：一个 app 下文件多了就是整表捞回内存（OOM 风险）。
            limit: 50,
        });

        return result;
    }),

    infinityQueryFiles: protectedProcedure
    .input(
      z.object({
        // ⚠️ 必须 nullish 而不是 optional：tRPC 的 infiniteQueryOptions 会把
        //    initialPageParam 原样塞进 input.cursor 发过来。initialCursor 传 null 时
        //    请求体是 { cursor: null }，z.string().optional() 只接受 undefined，
        //    收到 null 直接 zod 校验失败 → 首页 400。
        cursor: z.string().nullish(),
        limit: z.number().int().min(1).max(50).default(10),
        orderBy: filesOrderByColumnSchema,
        // ⚠️ 必须是 uuid：这个字段会直接进 where 跟 files.app_id 比，
        //    非法字符串会让 PG 抛 invalid input syntax for type uuid。
        appId: z.uuid("appId 不是合法的 uuid")
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit } = input;

      // ⚠️ 排序参数只能来自 input。原来写成
      //      .query(async ({ ctx, input, orderBy = { field: "createdAt", order: "desc" } }) => …
      //    tRPC 的 resolver 只收到【一个】options 对象，里面是
      //    ctx / input / type / path / signal …，压根没有 orderBy 这个属性
      //    （TS 报 TS2339）。所以那个默认值永远生效，客户端传的排序被静默丢弃。
      const sort = input.orderBy ?? { field: "createdAt" as const, order: "desc" as const };
      const sortColumn = files[sort.field];

      // ⚠️ 精度坑：PG 的 timestamp 精度是微秒，而 JS Date 只有毫秒。
      //    （配合 schema.ts 里 created_at 已改成 timestamptz：
      //     date_trunc 返回的是带时区的时间戳，下面回传的 ISO 字符串也能被
      //     PG 正确推断成 timestamptz，两边都是无歧义的 UTC 时刻。
      //     如果哪天把列改回裸 timestamp，这里会重新出现「差 8 小时」的错位：
      //     Node 在本地时区读、PG 在 UTC 写，游标比较就会跳过最近几个小时的数据。）
      //    游标往返一次就把亚毫秒部分丢了 —— asc 方向下，边界行的真实值（.695132）
      //    比游标里的（.695000）大，于是它自己又被判成「排在后面」，每页都重复一条
      //    （实测：18 条数据按 createdAt asc 翻出 26 条，多出 8 个重复）。
      //    所以排序和比较统一截断到毫秒，让「库里的值」和「游标里的值」粒度一致。
      //    更彻底的做法是把列建成 timestamp(3)（schema 里加 precision: 3 + ALTER TABLE），
      //    这里用 date_trunc 是为了不动表结构也能正确。
      // 两个分支都包成 SQL：否则 sortExpr 的类型是 SQL | PgColumn 的联合，
      // 下面 lt/gt/desc 的重载匹配不上（TS2769）。
      const sortExpr: SQL =
        sortColumn.dataType === "date"
          ? sql`date_trunc('milliseconds', ${sortColumn})`
          : sql`${sortColumn}`;

      // ⚠️【安全】原写法漏了 where —— 和当年 listFiles 一模一样的越权读漏洞：
      // 任何一个登录用户都能分页拉到数据库里【所有用户】的文件，
      // 而且连别人已软删除的（deleted_at 不为 null）也一起返回。
      // listFiles 那段注释里已经踩过一次，分页版本必须复制过来。
      // ⚠️ 同 listFiles：应用被软删除后，它的文件列表必须为空 ——
      //    否则直接访问 /dashboard/apps/[已删应用id] 依然看得到全部文件。
      const ownership = and(
        eq(files.userId, ctx.session.user.id),
        eq(files.appId, input.appId),
        isNull(files.deletedAt),
        exists(
          db.select({ one: sql`1` })
            .from(apps)
            .where(and(
              eq(apps.id, files.appId),
              isNull(apps.deletedAt)
            ))
        )
      );

      let pageFilter = ownership;
      if (cursor) {
        const c = decodeCursor(cursor);
        // 游标是按某一列 + 某一方向签发的，换了排序就得重新从头翻
        if (c.field !== sort.field || c.order !== sort.order) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "游标与当前排序不一致，请重新加载列表",
          });
        }
        // 游标语义：「严格排在 (排序列, id) 这个位置之后」。
        // 不能直接 gt(files.id, cursor) —— id 是随机 uuid，跟创建时间毫无关系，
        // 用它分页等于随机跳：翻到第二页可能落在第一页之前，重复数据 + 丢数据。
        //
        // 方向要跟着 order 走：desc 时「之后」= 值更小，asc 时「之后」= 值更大。
        const after = sort.order === "desc" ? lt : gt;
        // ⚠️ 时间戳列比较时左边是裸 sql 表达式（date_trunc(...)），
        //    drizzle 拿不到列的 mapToDriverValue，Date 会原样丢给驱动 →
        //    postgres.js 序列化失败（ERR_INVALID_ARG_TYPE）。
        //    所以这里手动序列化成 drizzle 对 timestamp 用的同一种格式
        //    绑定出去的字符串完全一致（ISO 8601 + Z，配合 timestamptz 列无歧义）。
        const cursorValue =
          c.value instanceof Date ? c.value.toISOString() : c.value;
        pageFilter = and(
          ownership,
          or(
            after(sortExpr, cursorValue),
            and(eq(sortExpr, cursorValue), after(files.id, c.id))
          )
        )!;
      }

      const dir = sort.order === "desc" ? desc : asc;

      // limit + 1：多取一条来判断「还有没有下一页」，
      // 省掉一次 COUNT(*) —— 每页都 count 的话大数据量下是双倍开销。
      const rows = await db
        .select()
        .from(files)
        .where(pageFilter)
        // ⚠️ 二级排序 id 不能省：createdAt 是毫秒级时间戳，
        // 同一毫秒插入的两条记录顺序不确定，纯 createdAt 排序会让翻页结果飘 ——
        // 表现为偶发「某个文件重复出现 / 某个文件永远刷不出来」。
        // 方向必须和游标比较的方向一致，否则「之后」和「排在后面」是两回事。
        .orderBy(dir(sortExpr), dir(files.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items.at(-1);

      return {
        items,
        // ⚠️ 原写法 result[result.length - 1].id 有两个坑：
        //   1. 最后一页非空但不足再多一页时，仍返回一个有效 cursor →
        //      前端 hasNextPage 永远 true → 无限触发 fetchNextPage；
        //   2. 列表为空时 length-1 === -1 → result[-1] 是 undefined →
        //      读 .id 抛 TypeError → 整个请求 500（永远不会发生的边界，恰恰是刚注册的新用户）。
        nextCursor:
          hasMore && last
            ? encodeCursor(
                last[sort.field],
                last.id,
                sort.field,
                sort.order
              )
            : null,
      };
    }),

    deleteFile: protectedProcedure
      .input(z.uuid("id 不是合法的 uuid"))
      .mutation(async ({ ctx, input }) => {
        // ⚠️ 必须带上 userId：只按 id 删的话，任何一个登录用户拿别人的 id
        //    都能把别人的文件软删掉（越权写），跟前面补掉的越权读是一对。
        //    带上 isNull(deletedAt) 是为了让重复删除幂等 ——
        //    否则每删一次都把 deleted_at 刷新一遍，看不出是不是真删成功了。
        const [deleted] = await db
          .update(files)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(files.id, input),
              eq(files.userId, ctx.session.user.id),
              isNull(files.deletedAt)
            )
          )
          .returning({ id: files.id });

        if (!deleted) {
          // 到这里只有两种可能：文件不存在，或者不是你的 —— 不给外人区分。
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "文件不存在或无权删除",
          });
        }

        return deleted;
      }),
});
