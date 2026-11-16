'use client'

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
// ⚠️ react-aria 的链接（MenuItem href / Link 等）默认走【浏览器原生跳转】：
//    没有 RouterProvider 时，<MenuItem href="..."> 虽然渲染成 <a>，
//    点下去是整页刷新，Next 的客户端软导航完全不参与。
//    加上 RouterProvider 并把它接到 Next 的 router 上，才是软导航。
//    它只需挂一次（放在最外层 provider 里），所有嵌套的 RAC 组件自动生效。
import { RouterProvider } from "react-aria-components";

// 注意重命名：这个文件导出的组件叫 TRPCProvider，而 api.ts 里 createTRPCContext()
// 返回的也叫 TRPCProvider，同名会冲突，所以导入时改成 TRPCContext。
import { TRPCProvider as TRPCContext, trpcClient } from "@/utils/api";

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const router = useRouter();

  // 嵌套顺序是关键：QueryClientProvider 必须在【外层】。
  // 因为 TRPCContext 内部要调用 useQueryClient() 拿 queryClient，
  // 如果它在更外层，运行时会抛 "No QueryClient set, use QueryClientProvider to set one"。
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCContext trpcClient={trpcClient} queryClient={queryClient}>
        {/* RouterProvider 挂在最内层即可，它只给后代提供 context，
            跟外层两个 provider 没有依赖关系。
            ⚠️ navigate 的入参类型是 Href（string 的别名），直接透传给 router.push；
               第二个参数 routerOptions 默认推导为 never/undefined，不用处理。 */}
        <RouterProvider navigate={(href) => router.push(String(href))}>
          {children}
        </RouterProvider>
      </TRPCContext>
    </QueryClientProvider>
  );
}
