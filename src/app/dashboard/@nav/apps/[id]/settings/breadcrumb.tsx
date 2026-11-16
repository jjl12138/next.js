"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Home } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuButton,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useTRPC } from "@/utils/api";
import { useAppId } from "@/utils/useAppId";

/**
 * 面包屑导航（settings 各 @nav 插槽共用）。
 *
 * 第一级【应用名】保留了应用切换下拉（和 app 主页顶部一样的行为：
 * 点开列出所有应用，点击跳到对应应用），只是把触发器从「按钮样式」
 * 换成面包屑文字样式 —— 解决「一半按钮一半文字」的视觉断裂。
 * 注意触发器不再是链接：点应用名是展开菜单，选菜单里的项才跳转。
 *
 * ⚠️ 触发器样式覆盖：
 *    DropdownMenuButton 默认走 buttonVariants 的 ghost variant，
 *    hover/展开时会有 bg-muted 的按钮底色。要做成「纯文字」观感，
 *    必须同时覆盖 hover:bg-transparent 和 aria-expanded:bg-transparent，
 *    只改文字颜色的话悬停时仍会浮出一块灰色底。
 *
 * ⚠️ 结构坑（详见 AppSwitcherNav 注释，这里同款）：
 *    MenuTrigger 的直接子元素必须是 react-aria 的可按压元素
 *    （DropdownMenuButton），塞裸 <Link>/<span> 会
 *    "PressResponder was rendered without a pressable child" 点了没反应；
 *    Menu 的 children 只认注册过 collection 的组件，空态/错误态
 *    必须用 DropdownMenuLabel（RAC Header）。
 */
export function BreadCrumb({ suffix }: { suffix?: string }) {
  const appId = useAppId();
  const trpc = useTRPC();
  const { data: apps, isPending, isError, error } = useQuery(
    trpc.apps.listApps.queryOptions({})
  );

  const currentApp = apps?.find((app) => app.id === appId);

  return (
    <nav className="flex items-center" aria-label="Breadcrumb">
      <ol className="inline-flex items-center gap-1 text-sm font-medium">
        <li className="inline-flex items-center">
          {/**
           * 首页图标：点回当前 app 的首页（/dashboard/apps/[id]）。
           * 注意别放成 /dashboard —— 那是应用列表，不是「当前 app 的首页」。
           * appId 还没就绪时先禁用（渲染成不可点的灰图标），就绪后可点。
           */}
          <Link
            href={appId ? `/dashboard/apps/${appId}` : "#"}
            aria-disabled={!appId}
            aria-label="应用首页"
            className="inline-flex items-center rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
          </Link>
        </li>
        <li
          aria-hidden="true"
          className="inline-flex items-center text-muted-foreground"
        >
          /
        </li>
        <li className="inline-flex items-center">
          <DropdownMenuTrigger>
            <DropdownMenuButton
              variant="ghost"
              className="h-auto rounded-md px-1 py-0.5 text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground"
            >
              {isPending ? "…" : currentApp ? currentApp.name : "选择应用"}
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
                    {app.name}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuLabel className="px-1.5 py-1 text-xs text-muted-foreground">
                  还没有应用
                </DropdownMenuLabel>
              )}
            </DropdownMenu>
          </DropdownMenuTrigger>
        </li>
        {suffix ? (
          <li
            aria-current="page"
            className="inline-flex items-center gap-1.5"
          >
            <ChevronRight
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="inline-flex items-center text-foreground">
              {suffix}
            </span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
