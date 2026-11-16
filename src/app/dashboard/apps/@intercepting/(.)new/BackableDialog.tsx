'use client'

import { Dialog } from "@/components/ui/Dialog";
import { useRouter } from "next/navigation";
import { ReactNode } from "react";

/**
 * 拦截路由：从 /dashboard/apps/[id] 软导航到 /dashboard/apps/new 时，
 * 这里接管渲染 —— children 那个插槽保持在原页面不动，
 * 本文件的内容由 apps/layout.tsx 的 `intercepting` 插槽渲染成弹窗。
 *
 * 目录关系：@intercepting 是 apps 段下的并行插槽（插槽名不占 URL 段），
 * 所以 (.)new 表示「拦截同级的 new」，即 /dashboard/apps/new ✓
 *
 * 硬刷新 / 直接访问该 URL 时不走这里，渲染的是 new/page.tsx 整页，
 * 插槽回落 @intercepting/default.tsx（返回 null）。
 */
/**
 * ⚠️ 不能是 async function：这是 "use client" 组件，React 不支持 async 客户端
 *    组件（@next/next/no-async-client-component），而且 useRouter() 就被塞进
 *    了 async 函数体里 → react-hooks/rules-of-hooks 直接报 error。
 *    函数体里本来也没有 await，同步即可。
 */
export default function InterceptedCreateApp(
  {children}: {children: ReactNode}
) {
  // ⚠️ props 必须往下传：PageProps 的 params / searchParams 都是【必填】，
  //    直接写 <NewAppPage /> 会 TS2739；运行时更糟 ——
  //    new/page.tsx 里 `const { error } = await searchParams` 拿到 undefined，
  //    解构 undefined 抛 TypeError，整棵 RSC 树炸掉，页面上只剩
  //    "This page couldn't load"。实测确认过。
  //
  // 传真实 props 而不是伪造的空值，是为了让校验失败时的 ?error=xxx
  // 在弹窗里也能正常显示，不用为此跳出去再回来。

  const router = useRouter();

  return (
    <Dialog open onOpenChange={()=>{router.back()}}>
        {children}
    </Dialog>
  );
}
