"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { useTRPC } from "@/utils/api";
import { useAppId } from "@/utils/useAppId";
import { Plus } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/Accordion";
export default function AppStoragePage() {
  // ⚠️ 必须有 "use client"：useQuery / useMutation 是 hook，
  //    写在 Server Component 里会直接报
  //      "useQuery is not a function / Hooks are not supported in Server Components"
  //    原文件既没写 "use client"，也一个 import 都没有。

  // ⚠️ 走 useAppId()，不要自己 useParams()：软导航回来时 params 可能还没就绪，
  //    会一进来就命中 !appId 显示「缺少应用 id」，刷新又好了。详见 utils/useAppId.ts。
  const appId = useAppId();
  const router = useRouter();

  // ⚠️ 不是 trpcClientReact（utils/api.ts 根本没有这个导出，TS2724）。
  //    项目里统一的写法是 useTRPC() + useQuery(trpc.xxx.queryOptions(...))；
  //    trpcClient 是 vanilla client，只有 .query()/.mutate()，没有 .useQuery()。
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const storagesQuery = useQuery(trpc.storages.listStorages.queryOptions());

  const appsQuery = useQuery(trpc.apps.listApps.queryOptions({}));
  // 当前 app 整个对象后面还要用（手风琴标题标红当前绑定的那个），
  // 所以先存 currentApp，storageId 从它身上取，别 find 两遍。
  const currentApp = appsQuery.data?.find((app) => app.id === appId);
  const currentStorageId = currentApp?.storageId ?? null;

  // 绑定/解绑成功后【直接改缓存】，不再发一次 listApps 重查。
  // ⚠️ 关键点 1：key 必须写成 trpc.apps.listApps.queryOptions({}).queryKey，
  //   和上面 useQuery 用的那个【完全同一个表达式】。
  //    原写法 setData(void 0, ...) 传的是 undefined 而不是 {} ——
  //    listApps 的 input 是 z.object({limit: default(50)})，
  //    useQuery 拿的是 input={} 的 key，写 undefined 会落到【另一个 key】，
  //    缓存改了但读的地方读不到 → 界面纹丝不动，还不报错。
  // ⚠️ 关键点 2：只改这一行的 storageId，别整表重建，
  //    其它字段（name / createdAt / ...）保持引用不变，避免无关重渲染。
  // ⚠️ 关键点 3：这条链路走的・是乐观更新，服务端已经返回成功，
  //    写入的值就是请求里的值，不需要再 invalidate 兜底。
  const patchAppStorage = (nextStorageId: number | null) =>
    queryClient.setQueryData(
      trpc.apps.listApps.queryOptions({}).queryKey,
      (prev) =>
        prev?.map((app) =>
          app.id === appId ? { ...app, storageId: nextStorageId } : app
        )
    );

  const bindStorage = useMutation(
    trpc.storages.bindStorage.mutationOptions({
      onSuccess: (_data, variables) => patchAppStorage(variables.storageId),
    })
  );
  const unbindStorage = useMutation(
    trpc.storages.unbindStorage.mutationOptions({
      onSuccess: () => patchAppStorage(null),
    })
  );

  // ⚠️ 页面根节点用 flex-1，不要 container、也不要只写 mx-auto：
  //   · settings/layout.tsx 外层已经是 `container mx-auto flex`（带 240px 侧栏），
  //     页面是它的 flex item，再套 container 是嵌套容器；
  //   · 只写 mx-auto 会让 flex item 收缩到内容宽再居中 → 右上角 + 会缩到中间，
  //     跟 api-key 页对不上（这正是之前两页按钮位置不一致的原因）。
  //   · flex-1 = 占满侧栏以外的剩余宽度，两页统一。
  if (!appId) {
    return (
      <div className="flex-1 px-4 pt-10 text-sm text-muted-foreground">
        缺少应用 id
      </div>
    );
  }

  if (storagesQuery.isPending || appsQuery.isPending) {
    return (
      <div className="flex-1 px-4 pt-10 text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (storagesQuery.isError || appsQuery.isError) {
    return (
      <div className="flex-1 px-4 pt-10 text-sm text-destructive">
        加载失败：{storagesQuery.error?.message ?? appsQuery.error?.message}
      </div>
    );
  }

  const storages = storagesQuery.data;

  return (
    <div className="flex-1 space-y-2 px-4 pt-10">
      <div className="flex items-center justify-between">
        {/* ⚠️ h1 上不能留 mb-6：外层是 items-center，标题自带下边距会把这一行
            撑高、标题视觉中心上移，右侧按钮就跟着偏下，看起来「掉下去一截」。
            行间距交给外层的 space-y-2。 */}
        <h1 className="text-3xl">Storage</h1>
        {/* ⚠️ 原来是个空的 <Button><Plus/></Button>：没有 onClick，
            点了完全没反应（而且没有可读名称，读屏软件读出来是个空按钮）。
            这里跳到同目录下的 ./new 表单页。 */}
        <Button
          // 图标按钮必须给可读名称，否则对读屏用户是个「无名按钮」
          aria-label="新建存储"
          onClick={() =>
            router.push(`/dashboard/apps/${appId}/settings/storage/new`)
          }
        >
          <Plus />
        </Button>
      </div>
      {/* ⚠️ 显示 id 数字（"当前绑定：1"）对用户没有任何意义，换成存储名 */}
      <div className="text-sm font-medium">
        当前绑定：
        {storages.find((s) => s.id === currentStorageId)?.name ??
          (currentStorageId === null ? "未绑定" : `#${currentStorageId}`)}
      </div>

      {storages.length === 0 ? (
        // ⚠️ 原来没有空态：一个存储都没配时页面是一片空白，
        //    看起来像「接口挂了」，实际上只是没数据。
        <div className="text-sm text-muted-foreground">
          还没有存储配置，点右上角 + 新建一个
        </div>
      ) : (
        // ⚠️ 不要再套 <ul>：AccordionItem 内部渲染的是 div（Radix 手风琴），
        //    ul 的合法子元素只有 li，套一层既是不合法 HTML，外层的 space-y-2
        //    也只作用于这一个 Accordion，等于没用。
        <Accordion type="single" collapsible className="space-y-2">
          {storages.map((storage) => {
            const bound = storage.id === currentStorageId;
            // ⚠️ 原来写 disabled={bindStorage.isPending}：一个请求在飞，
            //    列表里【所有】绑定按钮全被禁用。用 variables 精确只禁用正在提交的那行。
            const pending =
              bindStorage.isPending &&
              bindStorage.variables?.storageId === storage.id;
            // ⚠️ Radix AccordionItem 的 value 是 string，storage.id 是 number
            //    （TS2322），必须转字符串。
            return (
              <AccordionItem key={storage.id} value={String(storage.id)}>
                <AccordionTrigger
                  className={bound ? "text-destructive" : undefined}
                >
                  {storage.name}
                </AccordionTrigger>
                <AccordionContent>
                  <div className="text-lg mb-6">
                    <div className="flex justify-between items-center">
                      <span>region</span>
                      <span>{storage.configuration.region || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>bucket</span>
                      <span>{storage.configuration.bucket || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>apiEndpoint</span>
                      <span>{storage.configuration.apiEndpoint || "—"}</span>
                    </div>
                  </div>
                  {bound ? (
                    <Button
                      variant="outline"
                      // base-ui 的 Button 用 disabled（react-aria 那套才是 isDisabled）
                      disabled={unbindStorage.isPending}
                      onClick={() => unbindStorage.mutate({ appId })}
                    >
                      解绑
                    </Button>
                  ) : (
                    <Button
                      disabled={pending}
                      onClick={() =>
                        bindStorage.mutate({
                          appId,
                          storageId: storage.id,
                        })
                      }
                    >
                      {pending ? "绑定中…" : "绑定"}
                    </Button>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {bindStorage.isError && (
        <div className="text-sm text-destructive">
          绑定失败：{bindStorage.error.message}
        </div>
      )}
      {/* 原来只有 bind 的错误提示，解绑失败是静默的 —— 点了解绑没反应也不知道为什么 */}
      {unbindStorage.isError && (
        <div className="text-sm text-destructive">
          解绑失败：{unbindStorage.error.message}
        </div>
      )}
    </div>
  );
}
