import { createTRPCClient, httpBatchLink } from "@trpc/client";
// 浏览器端（同源）用的相对路径。
// ⚠️ 相对 URL 只有浏览器能解析：Node / Nitro / Edge 里的 fetch 需要绝对地址，
//    传 "/api/trpc" 会直接抛
//    TypeError: Failed to parse URL from /api/trpc/file.createPresignedUrl?batch=1
//    —— 报错里连主机名都没有，很容易误判成「后端挂了」。
//    所以要在服务端用的场景请走 createApiClient 的 baseUrl 参数。
const BROWSER_TRPC_ENDPOINT = "/api/trpc";
// 内部（session 鉴权）与对外（api-key 鉴权）是两个挂载点。
export const TRPC_ENDPOINT = "/api/trpc";
export const OPEN_TRPC_ENDPOINT = "/api/open";
// 给「非 React 环境」用：比如 Uppy 的 signRequest 回调里直接 .mutate()。
// 两个 client 实例相同，只是语义上区分使用场景。
// 用相对路径，别硬编码 localhost —— 换端口 / 部署 / 别人访问都会连错。
//
// ⚠️ 这里必须手写 `TRPCClient<OpenRouter>` 注解，不能靠推断：
//    tsconfig 开了 declaration: true，tsc 要为这个导出变量生成 .d.ts。
//    推断出的类型会一路展开到 router 的 ctx，而 ctx 依赖 open-router-dts 里
//    那个【没有 export】的 interface Context —— 于是报
//    TS4023: Exported variable 'apiClient' has or is using name 'Context'
//    from external module ... but cannot be named.
//    写上显式注解后，产物里只有一行 `TRPCClient<OpenRouter>`，不再展开 Context。
export const apiClient = createTRPCClient({
    links: [httpBatchLink({ url: BROWSER_TRPC_ENDPOINT })],
});
export const createApiClient = ({ apiKey, baseUrl = "", endpoint = OPEN_TRPC_ENDPOINT, signedToken, }) => {
    // 去掉结尾的 /，避免拼出 "http://host//api/open" —— 有的反向代理会把双斜杠
    // 当成独立路径，直接 404，而本地 dev 又是好的，只在部署后爆。
    const origin = baseUrl.replace(/\/+$/, "");
    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const headers = {};
    if (apiKey) {
        headers["api-key"] = apiKey;
    }
    if (signedToken) {
        headers["signed-token"] = signedToken;
    }
    return createTRPCClient({
        links: [httpBatchLink({ url: `${origin}${path}`, headers: headers })],
    });
};
