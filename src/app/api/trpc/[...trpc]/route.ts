import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { connection } from "next/server";

// appRouter 是聚合后的完整路由（server/router.ts），
// createTRPCContext 是 context 工厂（server/trpc.ts）。
// 两个文件职责不同：router.ts 组装，trpc.ts 提供基础件。
import { appRouter } from "@/server/router";
import { createTRPCContext } from "@/server/trpc";

const handler = async (request: NextRequest) => {
  // Next 16 + cacheComponents：createContext 里的 getServerSession() 是动态数据
  // （内部含 randomBytes），必须显式声明，否则 Next 可能把这个路由当静态 GET
  // 预渲染掉 —— 那样所有请求都命中缓存，createContext / resolver 一次都不执行。
  await connection();

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    // 复用 server/trpc.ts 的 createTRPCContext，避免两份 context 逻辑各写各的。
    createContext: () => createTRPCContext(),
  });
};

export { handler as GET, handler as POST };
