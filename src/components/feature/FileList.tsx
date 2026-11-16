"use client";

import { useTRPC } from "@/utils/api";
// skipToken：input 凑不齐时让这条查询保持 disabled（enabled: false），
// 而不是发一次注定 400 的请求。
import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { FileItem } from "./FileItem";
import { ScrollArea } from "../ui/ScrollArea";
import { Button } from "../ui/Button";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
// ⚠️ 必须用 import type：这是服务端路由模块，普通 import 会让打包器尝试
//    把它（连同 db / 密钥读取）拉进客户端 bundle。只取类型，编译后整行消失。
import type { FilesOrderByColumnSchema } from "@/server/routes/files";
import { CopyUrl, DeleteFile } from "./FileItemAction";

// ⚠️ 导出给 page.tsx 共用：queryKey 里包含 limit，两边只要不一致
// 就会退化成两个互不相干的缓存 —— 上次「上传成功、库里有记录、列表不动」
// 就是 key 不一致造成的。改这个值就得同时影响两边。
export const FILE_PAGE_LIMIT = 10;

export type FilesOrderBy = NonNullable<FilesOrderByColumnSchema>;

// 从 /dashboard/apps/[id] 这段路由上取当前应用 id。
// ⚠️ 抽成公共 hook 是必要的：FileList 自己要查列表、page.tsx 要算 fileCount，
//    是【两条独立调用路径】。而 queryKey 里含 appId —— 只要两边取值方式不同
//    （一个从路由取、一个从 props 取但来源不一致），就会算出两个 key、
//    两套缓存、两份请求，数据互不可见。这个坑本项目已经踩过三次。
// ⚠️ 必须跟 dashboard/apps/[id]/page.tsx 里的 UUID_RE 保持【完全一致】。
//    后端 infinityQueryFiles / saveFile 的 appId 都是 z.uuid()，而 files.app_id
//    是 PG 的 uuid 列；随便一个字符串进 where 就是
//      invalid input syntax for type uuid: "abc" → 500。
//    之前这里只判了 typeof === string，导致 page.tsx 把非法 id 变成 undefined
//    之后，useFilesInfiniteQuery 的 `appId ?? routeAppId` 又把非法 id 捡了回来，
//    skipToken 根本没生效（注释里写的「查询保持 disabled」是假的）。
const APP_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useRouteAppId(): string | undefined {
  const params = useParams();

  // useParams() 的返回类型是 { [key: string]: string | string[] }：
  // catch-all 路由下同一个 key 会是数组，所以必须做运行时判断，
  // 不能直接当 string 用（TS 也不会让你直接当 string 用）。
  return typeof params?.id === "string" && APP_ID_RE.test(params.id)
    ? params.id
    : undefined;
}

// ⚠️ 这个 hook 是 page.tsx 和 FileList 共用的【唯一入口】。
//    之前两边各自手写 infiniteQueryOptions(...)，只要有一边漏传 / 写死某个
//    input 字段，就会算出两个不同的 queryKey（key 里含全部 input，
//    经 hashKey 深比较）→ 两套独立缓存、两份请求、数据互不可见。
//    这个坑已经踩了三次（listFiles → infiniteKey、limit 3 vs 10、现在又差 orderBy），
//    彻底收敛到一处，从结构上消除。
export function useFilesInfiniteQuery(orderBy: FilesOrderBy, appId?: string) {
  const trpc = useTRPC();
  const routeAppId = useRouteAppId();
  // 显式传了就用传的，没传就回退到路由参数。
  // 两条路最终必须落到同一个 id 上，否则 key 就分叉了（见上面注释）。
  const resolvedAppId = appId ?? routeAppId;

  // ⚠️ @trpc/tanstack-react-query v11 里【没有】 trpc.file.xxx.useInfiniteQuery()
  //    —— 那个 API 只存在于经典 @trpc/react-query。
  //    这里装饰出来的 procedure 上有的是：
  //      queryOptions / queryKey / queryFilter
  //      infiniteQueryOptions / infiniteQueryKey / infiniteQueryFilter
  //      mutationOptions / mutationKey / subscribe
  //    所以正确写法是把 infiniteQueryOptions(...) 的结果喂给 React Query 原生的
  //    useInfiniteQuery。TS 的原话就是：
  //      Property 'useInfiniteQuery' does not exist ... Did you mean 'infiniteQueryKey'?
  //
  // ⚠️ initialCursor: null 必须显式传。
  //    trpcInfiniteQueryOptions 内部算 initialPageParam 的规则是
  //    `opts.initialCursor ?? input.cursor`，input 里我们没写 cursor → undefined；
  //    而 getNextPageParam 返回的是 string | null，两边类型对不上。
  //    传 null 让「无游标」这个值全程统一为 null。
  //    另外 ingestion：首帧请求体是 { cursor: null }，所以后端的 zod 必须是
  //    .nullish() 而不是 .optional()（.optional() 遇到 null 会 400）。
  //
  // ⚠️ queryKey 里是完整的 input（limit + orderBy），不含 cursor ——
  //    cursor 是每次请求通过 pageParam 动态拼进 input 的（getQueryKeyInternal
  //    遇到 type==='infinite' 会把 cursor / direction 剔除），
  //    所以整条翻页链路共用同一个缓存条目。
  //    反过来：orderBy 变了 key 就变了 → 自动重新请求并重新分页，这是期望行为。
  return useInfiniteQuery(
    trpc.file.infinityQueryFiles.infiniteQueryOptions(
      // ⚠️ 少 appId 就不能发请求：后端 input 里它是必填的 z.uuid()，
      //    传 undefined 过去只会稳定地拿回一条 400（而且 zod 的报错信息
      //    跟「文件不存在」这类业务错误混在一起，很难看出来是路由参数没取到）。
      //    skipToken 让这条查询安静地保持 disabled，而不是挂一个假的"加载失败"。
      resolvedAppId
        ? { limit: FILE_PAGE_LIMIT, orderBy, appId: resolvedAppId }
        : skipToken,
      {
        initialCursor: null,
        // 后端用 limit+1 探测还有没有下一页，最后一页返回 null。
        // 返回 null → hasNextPage 为 false，不会陷入「无限自动翻页」。
        getNextPageParam: (resp) => resp.nextCursor,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false
      }
    )
  );
}

export function FileList({
  orderBy,
  appId,
  onMakeUrl,
}: {
  orderBy: FilesOrderBy;
  // 可选：默认从 /dashboard/apps/[id] 的路由参数里取。
  appId?: string;
  // 可选：点击某张卡片的复制按钮时回调，参数是该文件的 id。
  // page.tsx 用它把 fileId 存进 makingUrlImageId，从而打开 Make Url 弹窗。
  onMakeUrl?: (id: string) => void;
}) {
  const routeAppId = useRouteAppId();
  const resolvedAppId = appId ?? routeAppId;

  const {
    data,
    isPending,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useFilesInfiniteQuery(orderBy, resolvedAppId);

  // flatMap 比 reduce((acc, p) => [...acc, ...p.items], [] as FileResult) 好在两点：
  //   1. 不用手写初始值类型，省掉那个 FileResult 类型体操和隐式 any；
  //   2. reduce 版本是 O(n²)——每翻一页都新建一个更长的新数组。
  const filesList = data?.pages.flatMap((page) => page.items) ?? [];
  
  // -------------------------------------> intersection

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(()=>{
    // ⚠️ 原来的 bug：依赖是 []，effect 只在【首次挂载】跑一次。
    //    而哨兵 div 写在 {hasNextPage && ...} 里，首次挂载时 data 还是 undefined，
    //    hasNextPage 恒为 false → 哨兵不在 DOM 里 → bottomRef.current === null
    //    → if 整块跳过，observer 根本没创建；等数据回来哨兵挂载了，
    //    effect 也不会重跑。所以控制台一条日志都没有。
    //    修复：把 hasNextPage 放进依赖，哨兵挂载后 effect 会再跑一次。
    const element = bottomRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(element);
    // disconnect() 已经涵盖 unobserve()，两个写一个就够
    return () => observer.disconnect();
  },[hasNextPage, isFetchingNextPage, fetchNextPage])



  // ⚠️ ScrollArea 自己【不加 container】：滚动条贴在 Root 的右边缘，
  //    Root 全宽 → 滚动条贴窗口最右侧。宽度约束放在内部的容器上。
  return (
    <ScrollArea className="h-full">
      {/* ⚠️ isPending 在「查询被 disabled」时也是 true（拿不到 appId 就会走到这），
          所以必须再判一次 resolvedAppId，否则会永远卡在 Loading。 */}
      {isPending && resolvedAppId && (
        <div className="container mx-auto text-center">Loading</div>
      )}
      {/* ⚠️ 内容列：不用 `container` 类 —— 它是「断点跳档」实现
          （width:100% + 640/768/1024/1280/1536 五个 max-width），
          1280~1535 之间容器锁死 1280、1536 以上锁死 1536，
          所以拖窗口时卡片宽度不动。改成 max-w + px 后宽度随视口连续变化。

          ⚠️ 列数用容器查询（父 `@container` + 子 `@2xl:` 这套）：
          断点看的是【这个盒子的宽度】，不是视口宽度，所以外面再套窄容器也会
          正确减列。@xl=36rem(576) → 2 列，@4xl=56rem(896) → 3 列，
          @6xl=72rem(1152) → 4 列（max-w 1536 时卡片约 360px）。
          注意断点比较的是【内容盒】宽度：父级有 px-6，两侧共 48px 不计入，
          所以 700px 视口（内容宽 632）已经能进 2 列。
          pb-16 是给左下角那个固定按钮留的位置，否则滚到底时最后一行会被它压住。 */}
      <div className="@container mx-auto w-full max-w-[1536px] px-6 pb-16">
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
        {filesList.map((file) => (
          // w-56 给 figure 定宽：flex item 是内容撑宽的，img 上的 w-full 会退化成
          // 按图片固有比例算宽度，导致每张卡片宽度不一样。
          <figure
            key={file.id}
            className="relative overflow-hidden rounded-lg border"
          >
            <div className="absolute inset-0 bg-background/30 opacity-0 hover:opacity-100 transition-all justify-center items-center flex">
              {/* onMakeUrl：把这一行的 file.id 报给上层（page.tsx 存进
                  makingUrlImageId 打开 Make Url 弹窗）；没传就只复制不弹窗。 */}
              <CopyUrl
                url={file.url}
                onMakeUrl={onMakeUrl ? () => onMakeUrl(file.id) : undefined}
              ></CopyUrl>
              <DeleteFile fileId={file.id}></DeleteFile>
            </div>
            <FileItem
              contentType={file.contentType}
              id={file.id}
              name={file.name}
            />
            <figcaption className="truncate p-2 text-sm" title={file.name}>
              {file.name}
            </figcaption>
          </figure>
        ))}
        </div>
      </div>
      {hasNextPage && (
      <div className={cn("hidden justify-center p-4", filesList.length > 0 && "flex")} ref={bottomRef}>
      <Button
        type="button"
        variant='ghost'
        // ⚠️ 翻页中必须禁用：连续点击会重复触发同一个 pageParam 的请求，
        //    React Query 会合并但同时飞来两份响应，本地缓冲可能出现重复项。
        disabled={isFetchingNextPage}
        onClick={() => fetchNextPage()}
        className="bottom-4 left-4 z-20 rounded border bg-white px-4 py-2 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {isFetchingNextPage ? "加载中…" : "加载更多"}
      </Button>
      </div>
    )}
    </ScrollArea>
  );
}