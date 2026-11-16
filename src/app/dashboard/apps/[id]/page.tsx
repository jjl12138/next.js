"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// 当前应用 id 就在路由段 [id] 上，统一由 FileList 的 useRouteAppId() 取
// （内部用 useParams()），不要为此把这里改成 async Server Component
// （会连带丢掉 Uppy 那套客户端状态）。
import { useParams } from "next/navigation";
import AWSS3 from "@uppy/aws-s3";
import { Uppy, UppyFile, Meta } from "@uppy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
// trpcClient 是 createTRPCClient 造的 vanilla client，只有 .query()/.mutate()，
// 【没有 .useQuery()】——hook 只能来自 useTRPC() 返回的 options proxy。
// 所以查列表必须用 const trpc = useTRPC() + useQuery(trpc.xxx.queryOptions())。
import { useTRPC, trpcPureClient } from "@/utils/api";
import { explainUploadError } from "@/utils/uploadErrorMessage";
import { useUppyState } from "../../useUppyState";
import { UploadButton } from "@/components/feature/UploadButton";
// ⚠️ 大小写要跟磁盘上的文件名完全一致：文件是 Dropzone.tsx（小写 z）。
// 写成 DropZone 在 macOS（大小写不敏感的文件系统）上能跑，但 tsc 报 TS1261，
// 而且一旦部署到 Linux（大小写敏感）会直接 404。
import { Dropzone } from "@/components/feature/Dropzone";
import { usePasteFile } from "@/hooks/usePasteFile";
import { UploadPreview } from "@/components/feature/UploadPreview";
import {
  FileList,
  FILE_PAGE_LIMIT,
  useFilesInfiniteQuery,
  type FilesOrderBy,
} from "@/components/feature/FileList";
import {MoveUp, MoveDown, Settings} from 'lucide-react';
import Link from "next/link";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/Dialog";
import { UrlMaker } from "./UrlMaker";
import { UpgradeDialog } from "./Upgrade";

// uuid v1~v5 的形状（后端 files.appId 是 PG 的 uuid 列，schema 里是 uuid()）。
// 只做形状校验，不校验版本位 —— 各版本 uuid 都要能进。
// ⚠️ FileList.tsx 的 useRouteAppId() 里有一份同样的 APP_ID_RE，必须保持一致：
//    useFilesInfiniteQuery 内部是 `appId ?? routeAppId`，只要这里判成 undefined
//    而那边没判，非法 id 就会被回退捡回来，skipToken 完全失效。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 注意：这里【不能】写 export const instant = false。
// instant 是 route segment config，只对 Server Component 有意义；
// 本文件是 "use client" 客户端组件，而且客户端组件不能是 async function
// （hooks 会报错）。Uppy 上传是纯客户端行为。

// ⚠️ 传的是【getter】而不是 appId 值本身：
//    createUppy 只在首次渲染调用一次（见下面的 uppyRef），而 signRequest
//    是它闭包里的函数。直接把值传进去的话，从应用 A 切到应用 B 时
//    （同一个路由段，组件不卸载、uppy 不重建）闭包里还是 A 的 id
//    → 文件被存进 A 的应用里，静默串号。
//    传 () => appIdRef.current 才能保证每次签名读的都是最新的 id。
// ⚠️ onForbidden 必须由调用方（组件）传进来：
//    createUppy 是模块级函数，组件的 setState 它根本摸不到 ——
//    原来直接在里面写 setShowUpgrade(true)，TS2304（编译都过不了）；
//    就算硬塞也能想到运行时 ReferenceError。通过参数注入才说得通。
function createUppy(getAppId: () => string | undefined, onForbidden: () => void) {
  const uppy = new Uppy();

  uppy.use(AWSS3, {
    shouldUseMultipart: false,

    // ⚠️ @uppy/aws-s3 v6 改了 API：getUploadParameters(file) 没了。
    // 现在三选一：s3Endpoint+getCredentials / signRequest / companionEndpoint。
    //
    // 关键差异：v6 的 signRequest 收到的参数是 PresignableRequest
    // （只有 key / contentType / method），【拿不到 file 对象】，
    // 所以没法在这里读 file.size 或原始文件名。要控制 key 格式，
    // 用下面的 generateObjectKey；要传额外信息，得走 Uppy 的 meta。
    signRequest: async (request) => {
      // request 是联合类型，且 method==='PUT' 有两个成员：
      //   PutObjectRequest（普通上传，有 contentType）
      //   UploadPartRequest（分片上传，有 uploadId / partNumber）
      // 只靠 method 判断收窄不掉，必须再排除 uploadId。
      // 本实例 shouldUseMultipart: false，不会走分片，直接拒绝即可。
      if (request.method !== "PUT" || "uploadId" in request) {
        throw new Error("仅支持单段 PUT 上传");
      }

      // ⚠️ 必须带上 appId：后端 createPresignedUrl 要用它查出这个应用
      //    【绑定的 storage】（桶 / 地域 / 密钥都在那儿），否则无从签发。
      //    缺了它 tRPC 的 zod 直接拒（TS2345 + 运行期 BAD_REQUEST）。
      //    appId 在本文件里已做过 uuid 形状校验，非法时是 undefined ——
      //    那就别去签了，抛错让 upload-error 落到 UI 上，而不是拿 undefined 发请求。
      //    ⚠️ 每次都调 getAppId() 现取，不要缓存到闭包变量里。
      const appId = getAppId();
      if (!appId) {
        throw new Error("取不到应用 id，无法生成上传签名");
      }

      try{
        const res = await trpcPureClient.file.createPresignedUrl.mutate({
          key: request.key,
          appId,
          // 用 || 而不是 ??：后端 createPresignedUrl 的 zod 是 z.string()（没有 min(1)），
          // 空串会一路传到 PutObjectCommandInput.ContentType —— 签名里带上一个空的
          // content-type，而实际 PUT 那边 S3Client.js:66 是
          //   ...(contentType ? { 'Content-Type': contentType } : {})
          // 空串为假 → 根本不发这个头。签名算了的头请求里没有，COS 直接 403。
          // 正常路径下 request.contentType 由插件给成
          // `file.type || 'application/octet-stream'`，不会是空串；
          // 这一层是防御：万一上游变了，也不能把空字符串签进去。
          contentType: request.contentType || "application/octet-stream",
        });

        // 后端返回什么 method 就用什么，别写死 PUT
        return { url: res.url, method: res.method };
      }catch(err){
        // ⚠️ 只有「免费额度用尽」（后端 FORBIDDEN）才弹升级框，别把所有错误
        //    都当成需要升级：取不到 appId、网络挂了、COS 403 也走这个 catch，
        //    全弹升级框用户会被误导。tRPC 客户端错误把 code 放在 err.data.code。
        //    其余错误 throw 出去，由 upload-error 事件落到红色错误条上。
        if (
          (err as { data?: { code?: string } } | null)?.data?.code ===
          "FORBIDDEN"
        ) {
          onForbidden();
        }
        throw err;
      }
    },

    // 自定义 S3 对象键。默认是 ${randomId}-${filename}，
    // 这里改成 日期/文件名，后端拿到 key 就知道存哪。
    generateObjectKey: (file) => {
      const date = new Date().toISOString().split("T")[0];
      const safeName = file.name?.replaceAll(" ", "_") ?? "unnamed";
      // ⚠️ 必须加唯一后缀，否则会静默丢数据：
      //    只用 `${date}/${safeName}` 时，同一天传两个同名文件
      //    （比如两次粘贴的截图在剪贴板里都叫 image.png，或重复传 logo.png）
      //    会算出完全相同的 key → COS 上后者直接覆盖前者；
      //    而 upload-success 里 saveFile 又各插一条 DB 记录，
      //    结果两条记录指向同一个对象，前一张图彻底消失且无任何报错。
      const uniqueId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : // randomUUID 只在安全上下文（https / localhost）可用，兜个底
          `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return `${date}/${uniqueId}-${safeName}`;
    },
  });

  return uppy;
}

export default function AppFilesPage() {
  // ⚠️ 用 ref 惰性创建，不要写 useState(() => new Uppy())：
  //    App Router 默认开 React Strict Mode，useState 的 initializer 会被
  //    【双调用】→ 造出两个 Uppy 实例，其中一个直接丢弃。
  //    而 Uppy 构造时会往 window 注册 online / offline 监听
  //    （Uppy.js:1127），只有 destroy() 才移除 —— 被丢弃那个就永远泄漏了
  //    （AWS S3 插件、事件监听器一起泄漏）。
  //    ref 在双渲染之间是同一个对象，第二次渲染看到 current 有值就不重建。
  //
  //    这里没有在 effect cleanup 里调 destroy()：Strict Mode 是
  //    setup → cleanup → setup，而 uppy 不在 effect 里创建，第二次 setup
  //    不会重建，立刻 destroy 会留下一个已死的实例（dev 热更新时尤其明显）。
  //    单页常驻场景下这点开销可忽略。
  const uppyRef = useRef<Uppy | null>(null);
  // uppy 比 appId 先建（下面才从路由取 id），所以这里先给个空 ref，
  // 由下面那个 effect 在 appId 变化时同步进去。
  const appIdRef = useRef<string | undefined>(undefined);
  // ⚠️ useState 必须声明在 uppy 创建【之前】：下面 createUppy 的第二个参数
  //    要引用 setShowUpgrade，声明在后的话首次渲染执行到这一行时它还在
  //    暂时性死区（TDZ）里，直接 ReferenceError。
  //    （setter 跨渲染是稳定引用，所以首次渲染闭包捕获它没有过期问题。）
  const [showUpgrade, setShowUpgrade] = useState(false);
  const uppy = (uppyRef.current ??= createUppy(
    () => appIdRef.current,
    () => setShowUpgrade(true)
  ));

  // ⚠️ 不是 trpcClientReact —— utils/api.ts 没有这个导出（TS2304）。
  //    本项目是 @trpc/tanstack-react-query：不是 trpc.xxx.useQuery()（TS2349，
  //    options proxy 上没有这个方法），统一写法是
  //    useQuery(trpc.xxx.queryOptions(...))（和 dashboard/page.tsx 一致）。
  const trpc = useTRPC();
  const appsQuery = useQuery(trpc.apps.listApps.queryOptions({}));
  const apps = appsQuery.data;
  const isAppsPending = appsQuery.isPending;
  // listApps 失败（未登录 / DB 挂了）时 data 是 undefined，
  // 不能把「加载失败」误判成「应用不存在」—— 两种情况要分开显示。
  const isAppsError = appsQuery.isError;

  // ⚠️ files 表现在按 app_id 过滤，所以每个写库/查列表的请求都必须带上它。
  //
  // TODO(可优化)：FileList 里已经导出了 useRouteAppId()（内部同样走 useParams），
  //   理想情况这里应该直接 import 它，避免同一份取值逻辑写两遍
  //   （两条路径只要有一处写法不同，queryKey 就会分叉成两套缓存）。
  //   但当前这个 dev server 的模块图是脏的：import 进来会直接 SSR 报错
  //     TypeError: {imported module ./src/components/feature/FileList.tsx}
  //              .useRouteAppId is not a function
  //   即运行时那份 FileList 实例里没有这个导出（.next/dev/server/chunks/ssr/
  //   下还留着好几个旧版 page.tsx 的 chunk）。重启 dev server 之后再改回来即可。
  //   在那之前保持下面这份内联写法，行为与 useRouteAppId 完全一致。
  //
  // ⚠️ 必须校验 uuid 形状：这个 id 会原样进 where 条件跟 files.app_id
  //    （PG 的 uuid 列）比，也会在上传后写进 saveFile。手敲一个
  //    /dashboard/apps/abc 过去，PG 抛的是
  //      invalid input syntax for type uuid: "abc"
  //    结果是 500 而不是「没有这个文件」，而且此时文件【已经在 COS 上了】，
  //    却因为没有合法 appId 而入不了库 → 列表里永远看不到。
  //    不合法就当 undefined：查询走 skipToken 保持 disabled，
  //    upload-success 里也会跳过入库，至少不会静默丢文件。
  const params = useParams();
  const appId =
    typeof params?.id === "string" && UUID_RE.test(params.id)
      ? params.id
      : undefined;

  // 把最新的 appId 同步进 ref，供 uppy 的 signRequest 读取。
  // 用 effect 而不是在渲染里直接写 ref.current：渲染期写 ref 是副作用，
  // React Compiler / Strict Mode 下都属于不该做的事。
  useEffect(() => {
    appIdRef.current = appId;
  }, [appId]);

  // 注意字段名是 totalProgress（0~100 的总进度百分比）。
  // State 里没有 totalProcess —— 写错会推断成 unknown，渲染时报 TS2322。
  const progress = useUppyState<number>(uppy, (s) => s.totalProgress);

  // ⚠️ 不能靠 totalProgress 判断「是否正在上传」：上传失败时进度会卡在中间某个数
  //    （比如 43），`progress > 0 && progress < 100` 恒为真 →
  //    顶栏的"上传中 43%"会永久挂着，用户以为还在传。
  //    currentUploads 是 Uppy 自己维护的「进行中的上传」映射，
  //    upload() 开始时登记、完成或失败时移除，是唯一准确的信号。
  const hasActiveUpload = useUppyState(
    uppy,
    (s) => Object.keys(s.currentUploads).length > 0
  );

  // 上传中给个可见反馈，否则点完 Upload 界面毫无动静
  const uploading = hasActiveUpload;

  // ⚠️ 上传失败必须落到 UI 上：uppy.upload() 的 Promise 在「部分文件失败」时
  //    是【resolve】的（失败清单放在 result.failed 里），根本走不到 .catch。
  //    所以只写 console.error 的话，用户点完 Upload 界面毫无动静，
  //    还以为传成功了 —— 只有 'upload-error' 事件能感知到失败。
  const [uploadError, setUploadError] = useState<string | null>(null);
  // ⚠️ Make Url 弹窗不再需要独立的开关 state：open = makingUrlImageId 非空，
  //    关闭 = 清空 makingUrlImageId（见下方 Dialog 的 onOpenChange）。
  //    之前留的 urlDialogOpen 是两套状态互相打架：open 看一个、
  //    onOpenChange 改另一个，点 X 关不掉。同一个弹窗只能有一个真源。

  // useTRPC() 已在上方 listApps 处声明（trpc），这里只补 queryClient
  const queryClient = useQueryClient();

  // ⚠️ 原来是 Exclude<FilesOrderByColumnSchema, 'undefined'> —— 这是无效的：
  //    Exclude 的第二个参数是【字符串字面量类型 'undefined'】，而这里要剔除的是
  //    【undefined 类型本身】，两者毫不相干，所以 Exclude 什么都没干，
  //    类型仍是 `{...} | undefined`。
  //    后果：setOrderBy(current => ({...current, ...})) 里 current 可能 undefined，
  //    展开后 field 变可选 → 不能赋回 state（TS2345，也就是编译报的那条）。
  //    正确写法是 NonNullable<>。
  //
  // ⚠️ 必须声明在下面那个 useEffect 之前：那个 effect 的闭包要用它决定
  //    「直写缓存」还是「失效重拉」，声明在后面会同时踩 TS2448（used before
  //    declaration）和 eslint react-hooks/immutability。
  const [orderBy, setOrderBy] = useState<FilesOrderBy>({
    field: "createdAt",
    order: "desc",
  });

  useEffect(() => {
    // @uppy/core v6 不再导出 UploadSuccessCallback（v4 才有）。
    // v6 里事件签名直接写在 Uppy.on 的重载上：
    //   'upload-success': (file, response: NonNullable<UppyFile['response']>) => void
    // 所以这里手写类型；B 用 Record<string, never> 跟 new Uppy() 推导出的对齐。
    type UploadedFile = UppyFile<Meta, Record<string, never>>;
    const handler = (
      file: UploadedFile | undefined,
      resp: NonNullable<UploadedFile["response"]>
    ) => {
      if (!file) return;

      const source = file.data instanceof File ? file.data : undefined;
      const uploadURL = resp.uploadURL ?? "";
      if (!uploadURL) {
        console.error("upload-success 没有 uploadURL，跳过入库", file.id);
        return;
      }
      // ⚠️ 没有 appId 就别入库：saveFile 的 zod 要求它必填，
      //    硬传 undefined 只会得到一条 400；而此时文件【已经在 COS 上了】，
      //    却没有数据库记录 → 列表里永远看不到，用户完全无感。
      //    （正常从 /dashboard/apps/[id] 进来一定会拿到 id，这是兜底。）
      if (!appId) {
        console.error("取不到路由参数 id，跳过入库", file.id);
        return;
      }

      // ⚠️ 必须用 || 而不是 ??：?? 只对 null / undefined 兜底，【空串会原样穿透】。
      //    而后端 saveFile 的 zod 是 z.string().min(1)，传空串会校验失败 →
      //    文件已经躺到 COS 上了，却没有数据库记录 → 列表里永远看不到它，
      //    整个过程只在服务端留一条 zod 报错，用户完全无感。
      //    剪贴板里拖/粘出来的文件 type 经常是空串，这条必踩。
      //
      //    取值优先级也换了：先用 file.name / file.type —— 这是 Uppy 从
      //    addFiles 描述符里提取的，Dropzone 和 usePasteFile 都已兜过底；
      //    source（原始 File）只作最后回退。
      // ⚠️ 必须按后端 saveFile 的 zod 归一化，否则「文件已经躺在 COS 上，
      //    却因为 400 入不了库 → 列表里永远看不到」，用户完全无感：
      //      · name: z.string().max(100)（files.name 是 varchar(100)）——
      //        粘贴/下载的文件名超 100 字符很常见，直接截断到同一个上限；
      //      · type: contentTypeSchema = ^[a-z]+\/[a-z0-9.+-]+$ + max(100)——
      //        去掉 "; charset=..." 之类的参数，不合规则退回 octet-stream。
      const rawName = file.name || source?.name || "unnamed";
      const name = rawName.slice(0, 100) || "unnamed";

      const rawType = (file.type || source?.type || "application/octet-stream")
        .split(";")[0]
        .trim();
      const type =
        rawType.length > 0 &&
        rawType.length <= 100 &&
        /^[a-z]+\/[a-z0-9.+-]+$/i.test(rawType)
          ? rawType
          : "application/octet-stream";

      trpcPureClient.file.saveFile
        .mutate({
          name,
          path: uploadURL,
          type,
          appId,

        })
        // 入库成功后把这条记录【直接写进】列表缓存，而不是让缓存失效去重拉。
        //
        // 为什么换成直写：
        //   invalidateQueries 对 active 查询会立刻 refetch（默认 refetchType: 'active'），
        //   而 upload-success 是逐文件事件 → 传 N 个文件就打 N 次 listFiles，
        //   其中前 N-1 次被 cancelRefetch 取消。直写是纯本地操作，0 次请求。
        //
        // ⚠️ 本项目是 @trpc/tanstack-react-query，【没有】 utils.file.listFiles.setData
        //    （setData 是经典 @trpc/react-query 里 useUtils() 的 API，
        //     createTRPCContext 只返回 TRPCProvider / useTRPC / useTRPCClient）。
        //    等价写法就是 React Query 原生的 setQueryData + trpc 的 queryKey()。
        //    queryKey() 返回的是带 DataTag 的类型化 key，所以 prev / 返回值都有类型。
        //
        // 能这么写的前提：saveFile 后端有 .returning() 把真实 DB 行返回了，
        // 客户端拿得到 id / createdAt / url / contentType，不需要自己伪造。
        // 列表是按 createdAt desc 排的，所以插到头部。
        //
        // prev 为 undefined（列表还没加载过）时原样返回，不凭空造缓存条目 ——
        // 等列表自己加载完会带上这条记录，不会丢。
        //    bug：原来写的是 trpc.file.listFiles.queryKey()，那是旧接口的 key，
        //    跟 FileList 现在读的 infiniteQueryKey 不是同一个缓存条目
        //    —— 结果是「上传成功、数据库有记录、列表纹丝不动」，且不报错。
        //
        //    往 pages[0] 头部插一条是安全的，不会造成翻页错位：
        //    后端的分页是【游标制】（where createdAt < cursor），每一页的起点是
        //    上一页最后一条记录的绝对位置，不是 offset。所以第 0 页临时多出 1 条，
        //    第 1 页仍然从同一个 cursor 往后取 —— 既不会重复也不会漏。
        //    （换成 offset 分页这么写就会整页错位，这是游标分页的真实收益之一。）
        //
        // prev 为 undefined（列表还没加载过）时原样返回，不凭空造缓存条目 ——
        // 等列表自己加载完会带上这条记录，不会丢。
        //
        // ⚠️ limit 必须用 FILE_PAGE_LIMIT，不能写字面量：
        //    queryKey 里含 input，{limit:3} 和 {limit:10} 是【两个不同条目】。
        //    写错就变成往一个没人观察的缓存里塞数据 —— setQueryData 成功、
        //    不报错、页面不动，只有刷新后重新请求才看得到新记录。
        .then((saved) => {
          // ⚠️ 直写缓存只在「按 createdAt 倒序」下成立 —— 那时新记录必然在最前面。
          //    换成 name / type / createdAt asc 之后，新记录该落在哪一页、页内哪个位置
          //    客户端无从得知，插到头部就是错的（列表顺序跟后端不一致，
          //    翻页时还会和真实结果错开）。这种情况只能让缓存失效重拉。
          if (orderBy.field !== "createdAt" || orderBy.order !== "desc") {
            void queryClient.invalidateQueries({
              queryKey: trpc.file.infinityQueryFiles.infiniteQueryKey({
                limit: FILE_PAGE_LIMIT,
                orderBy,
                // ⚠️ 必须带上 appId：后端 input 多了这个必填字段，
                //    key 里也就多了它。漏传 = 失效的是另一条缓存，
                //    列表不会重拉（「上传了但不刷新」）。
                appId,
              }),
            });
            return;
          }

          queryClient.setQueryData(
            trpc.file.infinityQueryFiles.infiniteQueryKey({
              limit: FILE_PAGE_LIMIT,
              // ⚠️ 必须带上 orderBy + appId：key 里含全部 input，
              //    漏一个就写到另一个条目 → 页面不动且无任何报错。
              orderBy,
              appId,
            }),
            (prev) => {
              if (!prev) return prev;
              const [firstPage, ...restPages] = prev.pages;
              return {
                ...prev,
                pages: [
                  { ...firstPage, items: [saved, ...firstPage.items] },
                  ...restPages,
                ],
              };
            }
          );
        })
        .catch((err) => {
          // 不 catch 的话这就是个 floating promise，失败完全静默。
          //
          // ⚠️ 而且必须落到 UI 上：这一步失败意味着文件【已经躺在 COS 上】，
          //    却没有数据库记录 → 列表里永远看不到它。只 console.error 的话
          //    用户看到的画面是「上传成功、进度走完、然后什么都没出现」，
          //    刷新也没用，完全无从排查。
          console.error("保存文件记录失败", err);
          setUploadError(
            `${name} 已上传到 COS，但写入数据库失败：${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
    };
    const errorHandler = (
      file: UploadedFile | undefined,
      err: { name: string; message: string; details?: string }
    ) => {
      // 在事件回调里 setState（不是 effect 里），不会触发 set-state-in-effect。
      //
      // ⚠️ 不要直接把 err.message 丢给用户：Uppy 对「XHR 拿不到响应」只会给一句
      //    `Network error during S3 request`，而这背后通常是存储 bucket 名不合法
      //    或 CORS 没放行（详见 utils/uploadErrorMessage.ts）。统一在这里翻译。
      setUploadError(
        `${file?.name || "文件"} 上传失败：${explainUploadError(err)}`
      );
    };

    // ⚠️ 新一轮上传开始时必须清掉上一次的错误条。
    //    原来这一步在【工具条的 Upload 按钮】里做（setUploadError(null) 再 uppy.upload()），
    //    但那个按钮已经注释掉了，现在上传是从 UploadPreview 弹窗里的 "Upload All" 发起的
    //    —— 本组件完全不知道。于是失败一次之后，红条会一直挂着：
    //    后面再传成功了它也不消失，用户以为还在失败。
    //    'upload' 事件在每次 upload() 真正开始时触发（Uppy.js:1344），是最合适的复位点。
    const startHandler = () => setUploadError(null);

    uppy.on("upload", startHandler);
    uppy.on("upload-success", handler);
    uppy.on("upload-error", errorHandler);
    return () => {
      uppy.off("upload", startHandler);
      uppy.off("upload-success", handler);
      uppy.off("upload-error", errorHandler);
    };
    // ⚠️ orderBy 必须在依赖里：上传成功后要按【当前排序】决定
    //    「直写缓存」还是「失效重拉」，闭包里必须拿到最新的 orderBy，
    //    否则永远用的是首次挂载时那个（createdAt desc）。
    // ⚠️ appId 必须在依赖里：入库请求要用它，闭包里必须拿到最新的值，
    //    否则永远用的是首次挂载时那个（可能为 undefined）。
  }, [uppy, trpc, queryClient, orderBy, appId]);

  // ⚠️ 这里必须和 FileList 用【同一个 queryKey】（同一个 infinite 查询、两个观察者），
  //    否则会变成两个独立缓存：FileList 显示旧的、这里显示新的，且各打一次请求。
  //    limit 必须引用同一个常量 —— key 里含 limit，写死两份迟早改歪。
  // 但职责仍然分开：
  //   Loading（isPending）已交给 FileList，这里就不再渲染，否则会出现两个 Loading；
  //   请求失败 / 空列表提示留在这一层（在 Dropzone 外面，视觉上更合理）。
  // ⚠️ 必须用和 FileList 【同一个 hook】：这里传的 input 少一个 orderBy，
  //    算出来的 queryKey 就跟 FileList 那份不是同一个条目 ——
  //    于是两个观察者各打一次请求、各自缓存一份，
  //    这里的 fileCount / isError 反映的是没有排序的那份，跟屏幕上的列表对不上
  //    （切换排序后「还没有上传过文件」可能一直挂着不消失）。
  const { data: infinityData, isError, error, isPending: listPending } =
    useFilesInfiniteQuery(orderBy, appId);
  // 只在「已加载且真正一条都没有」时提示空列表。
  // 用 pages[0] 而不是全量 flatMap：第一页空就一定没数据。
  const fileCount = infinityData?.pages[0]?.items.length ?? 0;

  // ⚠️ 必须补 name / type，理由同 Dropzone：
  //   name 丢了 → generateObjectKey 里 file.name 是 undefined → key 变 "unnamed"，
  //               多张粘贴的图在 COS 上互相覆盖
  //   type 丢了 → 预签名的 Content-Type 与实际 PUT 请求头不一致 → COS 403
  // 另外剪贴板里的文件有时 type 是空串，兜一个默认值。
  // 用 useCallback 包住：usePasteFile 的 effect 依赖 onFilesPaste，
  // 传内联箭头函数会让它每次 render 都重新 addEventListener/removeEventListener。
  const handlePasteFiles = useCallback(
    (pasted: File[]) => {
      uppy.addFiles(
        pasted.map((file) => ({
          name: file.name || `pasted-${Date.now()}`,
          type: file.type || "application/octet-stream",
          data: file,
          source: "Paste",
        }))
      );
    },
    [uppy]
  );

  usePasteFile({ onFilesPaste: handlePasteFiles });
  const [makingUrlImageId, setMakingUrlImageId] = useState<string | null>(null);
  // 和 dashboard/Plan.tsx（头像旁的小徽章）同一套约定：
  // plan 列可空，新用户后端已兜底返回 "free"。
  const { data: currentPlan } = useQuery({
    ...trpc.user.getPlan.queryOptions(),
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  // ===================== 应用存在性守卫 =====================
  // 需求：直接在地址栏敲 /dashboard/apps/[id] 时，
  //   · 应用不存在【或已被软删除】→ 显示 "App Not Exist" 错误页
  //   · 应用存在 → 必须等列表加载完才渲染内容
  //
  // ⚠️ 判定依据是 listApps 而不是再发一个 getApp 查询：
  //    listApps 本来就在拉（侧边栏/标题要用），且它已过滤 apps.deletedAt is null
  //    —— 被删除的应用根本不在返回列表里，天然覆盖「不存在」和「已删除」两种情况。
  //
  // ⚠️ isAppsPending 时【不能】提前判「不存在」：此时 apps 是 undefined，
  //    find/some 结果必然为假，直接判定会先闪一帧错误页再跳回内容页。
  //    所以顺序必须是：pending → Loading；error → 加载失败；最后才判存在性。
  //
  // ⚠️ 早退 return 放在所有 hooks 之后（usePasteFile / useFilesInfiniteQuery
  //    都已调用完毕），不违反 hooks 规则；守卫生效时文件列表的 infinite query
  //    仍会发一次请求（返回空列表），无副作用，不值得为它加 skipToken 联动。
  if (isAppsPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Loading...
      </div>
    );
  }

  if (isAppsError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-600">
        应用列表加载失败，请刷新重试
      </div>
    );
  }

  // 走到这里 apps 一定已加载。三种「不存在」收拢成一个错误页：
  //   · id 不是合法 uuid（appId === undefined，PG 会 500 的那种）
  //   · id 合法但 apps 里没有（从来没建过）
  //   · 应用被软删除了（listApps 已过滤）
  if (!appId || !apps?.some((a) => a.id === appId)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h1 className="text-3xl font-semibold text-red-600">App Not Exist</h1>
        <Button render={<Link href="/dashboard" />} nativeButton={false}>
          返回应用列表
        </Button>
      </div>
    );
  }

  // ⚠️ 最外层【不加 container】：滚动条贴在 ScrollArea.Root 的右边缘，
  //    只有 Root 全宽时才贴到窗口最右侧；这一层一有 max-width，滚动条就悬在
  //    屏幕中间偏右，跟工具条对不齐。内容列宽度交给内部 container mx-auto 管。
  // ⚠️ 高度用 flex 分配而不是 h-[calc(100%-60px)]：后者没算中间那几条提示
  //    （上传失败 / 加载失败 / 空列表），它们一出现总高就超 100vh，又冒出页面级滚动条。
  // ⚠️ 本项目 Tailwind v4 的 container 只有 width:100% + 各断点 max-width，
  //    【没有 margin-inline:auto】（globals.css 也没覆盖）→ 居中必须自己写 mx-auto。
  return (
    <div className="flex h-full flex-col">
      {/* 工具条单独一行，别和列表混在同一层，否则列表一溢出就会盖上来 */}
      {/* flex 默认 flex-nowrap：缩窄窗口时工具条不换行而是溢出，
          出现横向滚动条、Upload 按钮被切出屏幕（整页看起来像"没响应式"） */}
      <div className="container mx-auto flex h-[60px] shrink-0 flex-wrap items-center justify-between gap-3">
        <Button
        onClick={() => {
          setOrderBy((current) => ({
            ...current,
            // 用 === 不用 ==：这里是 'asc' | 'desc' 的字面量联合，没有类型 coercion 的余地
            order: current.order === "asc" ? "desc" : "asc",
          }));
        }}
      >
        Created At {""}
        {orderBy.order === "desc" ? <MoveUp /> : <MoveDown />}
      </Button>

    {/* ⚠️ 原来这里有两颗 UploadButton：外面这颗单独一个 <UploadButton>，
        下面那个 div 里又一颗 —— 工具条上出现两个一模一样的「+」，
        点哪个都是同一个 uppy 实例，用户完全分不清。只留这一组。 */}
    <div className="flex justify-center gap-2">
      {/* 返回应用列表（/dashboard）。之前的跳转目标 /dashboard/apps 没有 page.tsx，
          会 404 —— 应用列表页一直是 /dashboard，别写错。 */}
      <Button
        render={<Link href="/dashboard" />}
        nativeButton={false}
        aria-label="返回应用列表"
      >
        返回
      </Button>
      <UploadButton uppy={uppy}></UploadButton>
      {/* ⚠️ base-ui【没有】 asChild（那是 Radix 的 API），写上去直接 TS2322；
          运行时也只是把 asChild 当普通 prop 往下传，渲染成
          <button ...><a>new app</a></button> —— 嵌套可交互元素，点击无效。
          base-ui 的等价物是 render，接收一个 ReactElement。
          ⚠️ 同时必须 nativeButton={false}：默认值 true 会让 useButton 按
          <button> 的语义注入属性（type / disabled 等）到 <a> 上，
          dev 下 base-ui 还会警告 "rendered element is not a button"。 */}
      <Button
        render={<Link href="/dashboard/apps/new" />}
        nativeButton={false}
        onClick={(e)=>{
          if(currentPlan=="free"){
            e.preventDefault();
            setShowUpgrade(true);
          }
        }}
      >
        new app
      </Button>
      {/* ⚠️ 原来 href 用的是【双引号普通字符串】："/dashboard/apps/${appId}/storage"。
          ${appId} 在普通字符串里【不会被插值】，跳出去的 URL 是
          /dashboard/apps/${appId}/storage（浏览器编码成 $%7BappId%7D），
          → 落到 storage 页后 useAppId 取不到合法 uuid → 显示「缺少应用 id」。
          模板字符串必须用【反引号】`...`。
          ⚠️ 另外：appId 不合法时（手敲的非法 id）禁用这个按钮，
          否则照样会跳出一个地址栏看着对、内容却全空的配置页。 */}
      <Button
        render={<Link href={`/dashboard/apps/${appId}/settings/storage`} />}
        nativeButton={false}
        disabled={!appId}
        aria-label="配置存储"
      >
        <Settings></Settings>
      </Button>
    </div>
        {/* Uppy 默认 autoProceed: false，点完 Upload 界面没有任何变化，
            用户会以为没生效 —— 这里显示总进度 */}
        {uploading && (
          <span className="text-sm text-gray-600">上传中 {progress}%</span>
        )}
      </div>

      {/* 上传失败提示。没有它的话，点完 Upload 遇到预签名过期 / COS 403 /
          断网，界面只会闪一下"上传中 x%"然后归于平静，用户完全不知道失败。 */}
      {uploadError && (
        <div className="container mx-auto mb-4 flex shrink-0 items-start justify-between gap-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {/* whitespace-pre-line：explainUploadError 会返回「人话 + 换行 + 原始错误」，
              不加这个换行会被 HTML 折叠成空格，两段话糊成一行看不懂。 */}
          <span className="break-all whitespace-pre-line">{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="shrink-0 text-red-500 hover:underline"
          >
            关闭
          </button>
        </div>
      )}

      {/* {isPending && <div>Loading</div>} */}

      {/* 请求失败（未登录 403 / 数据库挂了 / appId 不是合法 uuid）时页面不能是一片空白 */}
      {isError && (
        <div className="container mx-auto shrink-0 text-sm text-red-600">加载失败：{error.message}</div>
      )}

      {/* ⚠️ 拿不到 appId 的情况已由上方「应用存在性守卫」提前拦截，
          渲染到这里时 appId 必然是合法 uuid，不再需要页内提示。 */}

      {/* ⚠️ 必须排除 isError：请求失败时 infinityData 是 undefined →
          fileCount 算出来是 0，而 listPending 也是 false（错误态不算 pending），
          于是「加载失败」和「还没有上传过文件」会【同时】显示，
          用户看到两条互相矛盾的信息（到底是加载失败了还是真没有文件）。 */}
      {fileCount === 0 && !listPending && !isError && (
        <div className="container mx-auto shrink-0 text-sm text-gray-500">还没有上传过文件</div>
      )}
      {/* ⚠️ flex-1 + min-h-0：高度由 flex 分配。min-h-0 不能省——
          flex item 默认 min-height:auto，会被内容撑开，flex-1 直接失效，
          滚动又会掉回 document 级（而不是留在 ScrollArea 里）。
          这样 Dropzone 高度正好等于可视区，里面 absolute inset-0 的拖拽遮罩
          才覆盖可视区，长列表也不会把 "Drop File Here" 顶到屏幕外。 */}
      <Dropzone uppy={uppy} className="relative min-h-0 flex-1" >
        {
          (dragging) => {
            return <>
              {
                dragging && (
          <div className="absolute inset-0 bg-secondary/50 z-10 flex justify-center items-center text-3xl">
            Drop File Here to Upload
          </div>
        )
              }
              {/* ⚠️ FileList 不需要 uppy —— 之前传进来只是为了撑签名，
                  组件里一直是空解构没人用（死参数）。
                  ⚠️ 必须把校验过的 appId 传下去：不传的话 FileList 会自己走
                  useRouteAppId()，两条路径一旦取值不同，queryKey 就会分叉成
                  两套缓存 / 两份请求（这个坑本项目已经踩过三次）。 */}
              <FileList orderBy={orderBy} appId={appId} onMakeUrl={(id)=>setMakingUrlImageId(id)}></FileList>
            </>
          }
        }
      </Dropzone>
      <UploadPreview uppy={uppy}></UploadPreview>
      <UpgradeDialog open={showUpgrade} onOpenChange={(f)=>setShowUpgrade(f)}></UpgradeDialog>
      {/* open 由 makingUrlImageId 派生；关闭时清空它（单一真源，X 才能真关掉）。 */}
      <Dialog
        open={Boolean(makingUrlImageId)}
        onOpenChange={(open) => {
          if (!open) setMakingUrlImageId(null);
        }}
      >
        {/* ⚠️ DialogContent 默认 className 里有 sm:max-w-sm（384px）。
            传 max-w-4xl（无断点）压不过它：桌面视口 ≥640px 时
            带 sm: 前缀的规则排在 CSS 后面、优先生效，弹窗仍然只有 384px
            → UrlMaker 里的滑杆 / 输入框 / 按钮挤成一团。
            必须传【同断点】的 sm:max-w-4xl，tailwind-merge 才会把
            sm:max-w-sm 替换成 sm:max-w-4xl；
            无断点的 max-w-[calc(100%-2rem)] 是移动端全宽，保留。 */}
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-4xl">
          <DialogTitle>Make Url</DialogTitle>
          {makingUrlImageId && (<UrlMaker id={makingUrlImageId}/>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
