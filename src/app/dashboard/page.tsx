"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { UpgradeDialog } from "@/app/dashboard/apps/[id]/Upgrade";
import { Button } from "@/components/ui/Button";
import { useTRPC } from "@/utils/api";

/**
 * /dashboard 首页（原来的 404 页）。
 *
 * ⚠️ 这里刻意【不做「自动跳到第一个应用」的服务端 redirect】：
 *    1. dashboard/layout.tsx 已经是 `instant = { unstable_disableDevValidation: true }`
 *       的受保护路由，再加一层 redirect 会让「到底是没登录还是没应用」变得难判断；
 *    2. 自动跳转会让人失去「我有哪些应用」的全貌，且后退键行为很怪。
 *    做成应用列表 + 新建入口，用户点哪个进哪个。
 *
 * ⚠️ 这是客户端组件：listApps 是 protectedProcedure，依赖 session；
 *    在服务端预渲染它需要 connection() + Suspense 一整套（见 layout.tsx 的注释），
 *    一个纯列表页没必要付这个代价，React Query 在客户端拿数据就够了。
 */
export default function DashboardHomePage() {
  const trpc = useTRPC();
  const appsQuery = useQuery(trpc.apps.listApps.queryOptions({}));

  // 免费用户已有 1 个应用时点「新建应用」→ 弹升级框而不是放行到表单
  // （后端 createApp 也会拦，但前端先拦能直接给升级入口，不用空跑一趟表单）。
  const { data: currentPlan } = useQuery({
    ...trpc.user.getPlan.queryOptions(),
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const [showUpgrade, setShowUpgrade] = useState(false);

  // 后端 createApp 对 free 用户限 1 个应用。付费上限交给后端，这里只挡免费。
  const freeQuotaUsed =
    currentPlan === "free" && (appsQuery.data?.length ?? 0) >= 1;

  /**
   * ⚠️ 每一处都要 container mx-auto：
   *    dashboard/layout.tsx 的 <main> 是 min-h-0 flex-1，【不做居中】，
   *    宽高和居中由各页面自己负责。而 Tailwind v4 的 container 只有
   *    width:100% + 各断点 max-width，【没有 margin-inline:auto】，
   *    只写 container 会贴着窗口左边缘，必须再写 mx-auto。
   */
  if (appsQuery.isPending) {
    return (
      <div className="container mx-auto px-4 pt-10 text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (appsQuery.isError) {
    return (
      <div className="container mx-auto px-4 pt-10 text-sm text-destructive">
        加载失败：{appsQuery.error.message}
      </div>
    );
  }

  const apps = appsQuery.data ?? [];

  return (
    <div className="container mx-auto px-4 pt-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl">我的应用</h1>
        {/* ⚠️ base-ui 版 Button 走 render + nativeButton={false} 渲染成 <a>，
            不要写成 <Button><Link/></Button>（button 里嵌 a，嵌套可交互元素）。 */}
        <Button
          render={<Link href="/dashboard/apps/new" />}
          nativeButton={false}
          onClick={(e) => {
            // 免费额度用尽：拦下跳转，直接弹升级框（和 app 详情页的 new app 按钮同一行为）。
            if (freeQuotaUsed) {
              e.preventDefault();
              setShowUpgrade(true);
            }
          }}
        >
          <Plus />
          新建应用
        </Button>
      </div>

      <UpgradeDialog
        open={showUpgrade}
        onOpenChange={(f) => setShowUpgrade(f)}
      />

      {apps.length === 0 ? (
        // ⚠️ 空态必须写。没有它的话新用户进来是一片空白，看起来像接口挂了。
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          还没有应用，点右上角「新建应用」创建第一个。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <li key={app.id}>
              {/* 整张卡片可点：<Link> 撑满 li，而不是只让标题可点 */}
              <Link
                href={`/dashboard/apps/${app.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted"
              >
                <div className="font-medium">{app.name}</div>
                {app.description ? (
                  <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {app.description}
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-muted-foreground/60">
                    未填写描述
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
