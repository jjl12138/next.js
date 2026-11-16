'use client';

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/utils/api";

export function Plan() {
    // ⚠️ 本项目用的是 tRPC v11 + @trpc/tanstack-react-query 的标准模式：
    //    useTRPC() 拿 options proxy，再配 @tanstack/react-query 的 useQuery。
    //    原来写的 trpcClientReact 在整个项目里不存在（谁都没导出过它），
    //    这段代码从未编译通过过。
    const trpc = useTRPC();

    const { data: plan } = useQuery({
        ...trpc.user.getPlan.queryOptions(),
        retry: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
    });

    return (
        <span className="absolute -right-3 top-0 bg-gray-600 rounded-md text-xs inline-block px-2">
            {plan ?? "Loading..."}
        </span>
    );
}
