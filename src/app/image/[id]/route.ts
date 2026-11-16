import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Readable } from "node:stream";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, isNull } from "drizzle-orm";
import { connection, NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { getServerSession } from "@/server/auth";
import { db } from "@/server/db/db";
import { files } from "@/server/db/schema";
import { decodeObjectKey, getS3Client } from "@/server/routes/files";

// ⚠️ 这里【绝对不能】写 export const runtime = "nodejs"。
//    next.config.ts 开了 cacheComponents: true 时，Next 16 会直接拒绝所有
//    route segment config（dynamic / runtime / revalidate ...）：
//      Error: Route segment config "runtime" is not compatible with
//      `nextConfig.cacheComponents`. Please remove it.
//    而且它报的是运行时 500（pages/_error），不是编译错误，极易误判成「路由挂了」。
//    Route Handler 默认就是 Node runtime，sharp 这类原生模块本来就能跑，不用声明。


// ⚠️ 这里【不能】再建模块级的 S3Client：
//    凭据现在是【按应用】的（apps.storage_id → storageConfiguration.configuration），
//    不同应用可能是不同的账号 / endpoint / 桶。模块级单例会把第一个应用的凭据
//    拿给所有应用用 —— 用 A 的密钥去读 B 的私有桶，结果就是一片 403，
//    更糟的是读到了别人的图还当成自己的返回。
//    统一走 files.ts 里按 storage.id 分桶缓存的 getS3Client()：
//    既复用连接池（不会每次请求都 TLS 握手），又不会串号。

export async function GET(
  request: NextRequest,
  // ⚠️ Next 15 起 params 是 Promise（App Router 全系列统一异步化），
  //    不能直接在形参里解构 { params: { id } } —— 那样拿到的是 Promise 对象，
  //    取 .id 恒为 undefined，而且 Next 的类型校验会直接报错：
  //      Property 'id' is missing in type 'Promise<{ id: string }>'
  { params }: { params: Promise<{ id: string }> }
) {
  // ⚠️ next.config.ts 里开了 cacheComponents: true，Next 16 会把「看不出用了动态数据」的
  //    GET Route Handler 预渲染成静态响应写进 Route Cache —— 之后 handler 根本不再执行
  //    （最典型的症状就是 console.log 一次都不打印，但请求照样返回 200）。
  //    connection() 显式声明「必须有真实请求才执行」。
  //    ❗别用 export const dynamic = "force-dynamic"：开了 cacheComponents 它直接 500。
  await connection();

  const { id } = await params;

  // ⚠️ id 必须先做 uuid 形状校验：files.id 是 uuid 列，
  //    传个 "abc" 或 "../../etc" 进去，PG 会抛
  //      invalid input syntax for type uuid
  //    → 裸 500，而且是一条谁都能打的 500。先挡掉再查库。
  if (!z.uuid().safeParse(id).success) {
    return new NextResponse(null, { status: 404 });
  }

  // 图片是按用户私有的，必须校验归属；否则知道 id 就能拖走别人的图（越权读）。
  const session = await getServerSession();
  if (!session?.user) {
    return new NextResponse(null, { status: 401 });
  }

  // ⚠️ 必须带 isNull(files.deletedAt)：删除做的是软删除（只写 deleted_at），
  //    COS 上的对象还在。不判的话刚删掉的图照样能在这个路由里取出来，
  //    看起来就像「删除没生效」。
  //    三个条件合成一个 where —— 一条 SQL 搞定，不用先查再比。
  const file = await db.query.files.findFirst({
    where: and(
      eq(files.id, id),
      eq(files.userId, session.user.id),
      isNull(files.deletedAt)
    ),
    with: {
        app: {
            with: {
                storage: true
            }
        }
    },
    columns: { path: true, contentType: true },
  });

  // 「不存在」「不是图片」「不是你的」统一返回 404：
  // 不区分是为了不泄露「这个 id 存在但没权限」这种信息。
  if (!file || !file.contentType.startsWith("image/")) {
    return new NextResponse(null, { status: 404 });
  }

  // ⚠️ 顺序不能反：原来把「没绑存储」的判断放在 contentType 判断【之前】，
  //    且抛的是 TRPCError —— 结果非图片文件（.txt/.zip）拿到的不是 404 而是
  //    TRPCError 穿透出来的裸 500（Route Handler 不是 tRPC 上下文，没人接这个错）。
  //    正确顺序：先判文件本身（404），再判服务端配置（记日志 + 404）。
  const storage = file.app?.storage;
  if (!storage) {
    // 不泄露「文件存在但没绑存储」这类服务端内部信息，只打日志。
    console.error("[image] 文件所属应用未绑定存储:", id);
    return new NextResponse(null, { status: 404 });
  }

  const configuration = storage.configuration;
  if (!configuration?.accessKeyId || !configuration?.secretAccessKey) {
    console.error("[image] 存储配置缺少 accessKeyId / secretAccessKey:", storage.id);
    return new NextResponse(null, { status: 404 });
  }

  // 按 storage.id 分桶缓存的客户端：复用连接池，且不会跨应用串号。
  const s3Client = getS3Client(storage.id, configuration);

  let stream: NodeWebReadableStream<Uint8Array>;
  try {
    const response = await s3Client.send(
      // ⚠️ bucket 在 configuration 里，不在 storage 行上（行上只有 id/name/userId/configuration）。
      new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: decodeObjectKey(file.path),
      })
    );
    if (!response.Body) {
      return new NextResponse(null, { status: 404 });
    }
    // ⚠️ 双重断言是必须的：SDK 返回的是 lib.dom 的 ReadableStream，
    //    Node 的 Readable.fromWeb() 要的是 node:stream/web 的同名类型。
    //    两个 ReadableStream 结构一样但来自不同的类型定义，TS 认为不兼容。
    stream = response.Body.transformToWebStream() as unknown as NodeWebReadableStream<Uint8Array>;
  } catch (error) {
    // COS 上没这个 key / 签名失效 / 网络抖动都会抛，
    // 不包 try 就会变成一个裸 500，前端 <img> 直接裂图且看不出原因。
    console.error("[image] COS 读取失败:", file.path, error);
    return new NextResponse(null, { status: 502 });
  }

  try {

    const query = new URL(request.url).searchParams;

    // ⚠️ parseInt 解析失败（参数缺失 / 不是数字）返回 NaN，
    //    而 NaN ?? 250 永远不生效 —— ?? 只认 null/undefined，NaN 不是 nullish，
    //    所以原来的「兜底」是死代码：不带 width 的请求会拿 NaN 进 sharp，
    //    sharp 直接抛 "Expected positive integer ... received NaN" → 500（已实测复现）。
    //    必须用 Number.isFinite / isInteger 判断，再自己给默认值。
    const parsedWidth = Number.parseInt(query.get("width") ?? "", 10);
    // 夹在 [1, 2000]：0 / 负数 sharp 会抛；上限跟 UrlMaker 输入框的 max 对齐，
    // 防止 ?width=99999999 被当免费图片放大器打。
    const width =
      Number.isInteger(parsedWidth) && parsedWidth > 0
        ? Math.min(parsedWidth, 2000)
        : 250;
    const parsedRotate = Number.parseInt(query.get("rotate") ?? "", 10);
    const rotate = Number.isFinite(parsedRotate) ? parsedRotate : 0;

    // ⚠️ 流式喂给 sharp，而不是 response.Body.transformToByteArray() 整包读进内存再处理：
    //    后者 = 进程里同时躺着「原始图 N MB」+「解码后的像素缓冲（宽×高×4 字节）」
    //    +「webb 输出」，一张 20MB 的相机原图解码后像素区就上百 MB，
    //    列表页并发 10 个请求直接把 Node 堆顶爆。
    //    用 pipe 让 sharp 边收边解，峰值内存降一个数量级。
    const buffer = await Readable.fromWeb(stream)
      .pipe(
        sharp({ failOn: "none" })
          // ⚠️ 必须放在 resize 之前：手机拍的照片把方向记在 EXIF 里，
          //    sharp 默认不会自动纠正，不 rotate 就会出现「竖图躺倒了」。
          //    background 填充色：旋转角度不是 90 的整数倍时画布要扩大，
          //    四角露出无内容的三角区。sharp 默认填黑色 —— light 模式下
          //    黑角突兀、dark 模式下白角穿帮，本项目有 dark/light 两套
          //    主题，所以填【透明】，四角透出页面底色，两种模式都对。
          //    alpha:0 只负责 declare 填充色透明，输出端还要 ensureAlpha()
          //    真正给像素缓冲加上 alpha 通道（原图多是不带 alpha 的 JPEG）。
          .rotate(rotate, {
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .ensureAlpha()
          // ⚠️ 只给 width、不给 height：sharp 按原图宽高比自动算高度，
          //    高度不受限，图片也不会变形。fit 参数只在宽高【都给】时才有意义
          //    （都给时 cover=居中裁切），这里显式写成对象形式 { width }
          //    让「只有宽度生效」这件事从代码上一眼可读。
          //    不加 withoutEnlargement：小图会放大到目标宽度（UrlMaker 的语义就是"要这么宽"）。
          .resize({ width })
          .webp()
      )
      .toBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(buffer.byteLength),
        // ⚠️ 必须是 private，不能是 public：
        //    这条路由要登录 + 校验 userId 才能读，图是【私有】的。
        //    标成 public 等于告诉 CDN / 公司网关 / 浏览器共享缓存「谁都能存一份」，
        //    一个用户登录看图之后，同一台代理后面的其它人可能直接拿到这张图，
        //    连 /image/:id 都不会再打过来 —— 鉴权被缓存绕过。
        //    private 表示只允许【该用户的浏览器】缓存，共享缓存不得留存。
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    // sharp 对损坏文件 / 不支持的编码会抛，不是代码 bug，别让它变成未捕获异常
    console.error("[image] sharp 处理失败:", file.path, error);
    return new NextResponse(null, { status: 500 });
  }
}
