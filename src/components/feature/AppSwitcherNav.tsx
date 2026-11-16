"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuButton,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useTRPC } from "@/utils/api";
import {Home} from "lucide-react";

/**
 * 顶部导航里的「应用切换器」。
 *
 * 原来 @nav 下每个插槽页（apps/[id]、settings/api-key、settings/storage…）
 * 都各自复制了一份 120 行的实现，只有结尾那截文字不同。加一个插槽就要再复制
 * 一遍，改一处边界情况（比如菜单空态）得改五份，必然漏。这里收敛成一个组件，
 * suffix 表示「应用名后面的面包屑」。
 *
 * ⚠️ 下面这些坑都是实测踩出来的，改之前先读完：
 *
 * 1. 用 useParams() 取 id，不要从 props 解构 params。
 *    Next 16 里 params 是 **Promise**，`{params: {id}}` 拿到的是 Promise
 *    实例本身，id 恒为 undefined → app.id === id 永远不成立 → 标题永远是
 *    「选择应用」。而且并行插槽没有生成 PageProps，编译期兜不住。
 *
 * 2. 结构必须是 MenuTrigger > [触发按钮, 菜单内容]。
 *    <DropdownMenu> 本身就是那个弹出的 Popover+Menu，放在 Trigger 外面
 *    等于菜单永远不渲染（那是 Radix 的写法）。
 *
 * 3. 触发器必须用 DropdownMenuButton（可按压元素）。MenuTrigger 把 press
 *    事件挂到【直接子元素】上，塞裸文本会报
 *    "A PressResponder was rendered without a pressable child."，
 *    表现是「点了没反应，也不报错」。
 *
 * 4. Menu 的 children 只认注册过 collection node 的组件（MenuItem / Header /
 *    Section）。RAC 会先把 children 渲染进一个隐藏的 <template> 构建集合，
 *    裸 <div> 只留在 template 里 —— 用户看到的仍是空菜单。所以空态 / 错误态
 *    必须用 DropdownMenuLabel（就是 RAC 的 Header）。
 *
 * 5. MenuItem 用 RAC 原生 href，不要再往里塞 <Link>。传了 href 它自己渲染成
 *    一个 <a>：键盘回车、中键新标签页、右键复制链接都正常；塞 <Link> 会变成
 *    「div[role=menuitem] 里嵌 a」（嵌套可交互元素），点一次还会导航两次。
 *
 * 6. react-aria 全家都是 isDisabled，没有 disabled。
 */
export function AppSwitcherNav({ suffix }: { suffix?: string }) {
  const params = useParams();
  const appId = typeof params?.id === "string" ? params.id : undefined;

  const trpc = useTRPC();

  // 必须传一个 input（哪怕空对象）：zod 的 limit 带 default(50) 只让【属性】
  // 变可选，queryOptions 的【入参】本身仍是必填的。具体条数交给服务端默认值。
  const { data: apps, isPending, isError, error } = useQuery(
    trpc.apps.listApps.queryOptions({})
  );

  // find + ===：find 命中即返回，比 filter(...)[0] 少遍历一遍，
  // === 也避免 id 与字符串比较时的隐式转换。
  const currentApp = apps?.find((app) => app.id === appId);

  return (
    <div className="flex items-center">
      <DropdownMenuTrigger>
        <DropdownMenuButton variant="ghost">
          {isPending ? "载入中…" : currentApp ? currentApp.name : "选择应用"}
        </DropdownMenuButton>

        <DropdownMenu>
          {isError ? (
            <DropdownMenuLabel className="px-1.5 py-1 text-xs text-destructive">
              加载失败：{error.message}
            </DropdownMenuLabel>
          ) : apps?.length ? (
            apps.map((app) => (
              <DropdownMenuItem
                key={app.id}
                href={`/dashboard/apps/${app.id}`}
                className={app.id === appId ? "font-medium" : undefined}
                isDisabled={app.id === appId}
              >
                {/* children 是纯字符串，DropdownMenuItem 内部那句
                    textValue={typeof children === "string" ? children : ...}
                    能自动取到值，键盘 typeahead 正常，不用手动补。 */}
                {app.name}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuLabel className="px-1.5 py-1 text-xs text-muted-foreground">
              {isPending ? "载入中…" : "还没有应用"}
            </DropdownMenuLabel>
          )}
        </DropdownMenu>
      </DropdownMenuTrigger>
      {/* 用模板字符串而不是 JSX 文本，避免 JSX 把首尾空格折叠掉 */}
      {suffix ? <div>{` / ${suffix}`}</div> : null}
    </div>
  );
}
