import { type TRPCClient } from "@trpc/client";
import type { OpenRouter } from "./open-router-dts";
export declare const TRPC_ENDPOINT = "/api/trpc";
export declare const OPEN_TRPC_ENDPOINT = "/api/open";
export interface ApiClientOptions {
    /** 应用的 api-key，会作为 `api-key` 请求头发出去 */
    apiKey: string;
    /**
     * 服务端调用必须给绝对地址，例如 "http://localhost:3000"。
     * 浏览器同源调用可以省略，走相对路径。
     */
    baseUrl?: string;
    /**
     * 默认 /api/open —— 因为 createApiClient 存在的意义就是带 api-key 调外网接口。
     * ⚠️ 别图省事指到 /api/trpc：那条路由挂的是 appRouter（session 鉴权），
     *    带上 api-key 也只会拿到 401「请先登录」，跟你手里的 key 是否正确无关。
     */
    endpoint?: string;
    signedToken?: string;
}
export declare const apiClient: TRPCClient<OpenRouter>;
export declare const createApiClient: ({ apiKey, baseUrl, endpoint, signedToken, }: ApiClientOptions) => TRPCClient<OpenRouter>;
export type { OpenRouter };
