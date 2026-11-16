import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
// AppRouter 从 server/router.ts 拿（唯一的聚合点）。
// 原来引 "./trpc" 会指到 src/utils/trpc.ts —— 那份已删除，
// 现在 tRPC 的服务端代码都在 src/server/ 下。
import type { AppRouter } from "@/server/router";

// ⚠️ 这两处都不能省：
// 1. <AppRouter> 泛型必须传。不传的话 TRouter 推断失败，useTRPC() 返回类型退化，
//    页面里 data.hello 会报 Property 'hello' does not exist on type '{}'。
// 2. useTRPC 必须一起解构出来。page.tsx 用它拿 options proxy，
//    漏掉会报 Module has no exported member 'useTRPC'。
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

const trpcUrl = "/api/trpc";

// 给 React Query hooks 用（配 useTRPC + useQuery）
export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: trpcUrl })],
});

// 给「非 React 环境」用：比如 Uppy 的 signRequest 回调里直接 .mutate()。
// 两个 client 实例相同，只是语义上区分使用场景。
// 用相对路径，别硬编码 localhost —— 换端口 / 部署 / 别人访问都会连错。
export const trpcPureClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: trpcUrl })],
});

export {AppRouter};
