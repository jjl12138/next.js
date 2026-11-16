"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useAppId } from "@/utils/useAppId";

/**
 * ⚠️ 原来第一行写的是 `'use-client'`（连字符）——那不是 React 指令，
 *    只是一句普通字符串表达式，会被直接忽略，整个文件仍按 Server Component 编译。
 *    于是 usePathname() 在服务端执行，Next 直接抛：
 *      "You're importing a module that depends on `usePathname` into a
 *       React Server Component module."
 *    settings 下【所有】页面（api-key / storage / 各自的 new）因此全部 500。
 *    指令必须是 `'use client'`，中间是空格。
 *
 * ⚠️ 不要从 props 解构 params：Next 16 里 layout 的 params 是 Promise，
 *    `{params: {id}}` 拿到的是 Promise 实例本身，id 恒为 undefined，
 *    拼出来的 /dashboard/apps/undefined/settings/... 点一下就 404。
 *    统一走 useAppId()（settings 下各页面的写法一致）。
 */
export default function SettingLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const appId = useAppId();

  /**
   * ⚠️ 原来从 react-aria-components 导入 Button，却传了 asChild / variant / disabled：
   *    · asChild 是 Radix 的 API，RAC 的 Button 没有；它用 render prop；
   *    · variant / size 也不是 RAC Button 的 props（那是本项目 cva 版 Button 的）；
   *    · RAC 的禁用叫 isDisabled，写 disabled 只会被当 DOM 属性透传。
   *    结果：按钮没有任何样式、禁用也不生效，还会渲染成 <button> 里嵌 <a>
   *    （嵌套可交互元素，键盘和读屏都会乱）。
   *    项目里统一用 base-ui 版 Button：跳转写 render={<Link/>} + nativeButton={false}，
   *    参考 apps/[id]/page.tsx 里那几个 render 用法。
   */
  const items = appId
    ? [
        {
          href: `/dashboard/apps/${appId}/settings/storage`,
          label: "Storage",
        },
        {
          href: `/dashboard/apps/${appId}/settings/api-key`,
          label: "API Keys",
        },
        {
          href: `/dashboard/apps/${appId}/settings/danger`,
          label: "Delete App",
        },
      ]
    : [];

  return (
    <div className="container mx-auto flex justify-start">
      <div className="flex w-60 flex-shrink-0 flex-col gap-4 pt-10">
        {/* settings 各页面没有出口，之前只能靠浏览器返回键。
            返回目标是该 app 的详情页（apps/[id]/page.tsx），
            不是 /dashboard —— settings 是 app 的下一级，回上一层才符合直觉。
            用 Link 而不是 router.back()：用户可能从收藏夹/直链进来，
            history 里没有上一页，back() 会把他踢出站点。 */}
        <Button
          size="lg"
          variant="ghost"
          className="justify-start"
          render={<Link href={appId ? `/dashboard/apps/${appId}` : "/dashboard"} />}
          nativeButton={false}
          aria-label="返回应用详情"
        >
          <ArrowLeft />
          返回
        </Button>
        {items.map((item) => {
          const active = path === item.href;
          return (
            <Button
              key={item.href}
              size="lg"
              /**
               * ⚠️ 当前项不要用 disabled：禁用会把链接从 Tab 顺序里摘掉，
               *    键盘用户无法在侧栏感知「我在哪一页」。改用 aria-current 表达，
               *    视觉上靠 variant 区分。
               */
              variant={active ? "outline" : "ghost"}
              aria-current={active ? "page" : undefined}
              className="justify-start"
              render={<Link href={item.href} />}
              nativeButton={false}
            >
              {item.label}
            </Button>
          );
        })}
      </div>
      <div className="flex-grow pl-4">
        {children}
      </div>
    </div>
  );
}
