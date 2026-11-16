import * as _trpc_server from '@trpc/server';
import { Session } from 'next-auth';

interface Context {
    /** 未登录时为 null，由各 resolver / middleware 自己决定怎么处理 */
    session: Session | null;
}

declare const openRouter: _trpc_server.TRPCBuiltRouter<{
    ctx: Context;
    meta: object;
    errorShape: _trpc_server.TRPCDefaultErrorShape;
    transformer: false;
}, _trpc_server.TRPCDecorateCreateRouterOptions<{
    file: _trpc_server.TRPCBuiltRouter<{
        ctx: Context;
        meta: object;
        errorShape: _trpc_server.TRPCDefaultErrorShape;
        transformer: false;
    }, _trpc_server.TRPCDecorateCreateRouterOptions<{
        saveFile: _trpc_server.TRPCMutationProcedure<{
            input: {
                name: string;
                path: string;
                type: string;
                appId: string;
            };
            output: {
                path: string;
                type: string;
                id: string;
                name: string;
                userId: string;
                createdAt: Date | null;
                deletedAt: Date | null;
                url: string;
                contentType: string;
                appId: string | null;
            };
            meta: object;
        }>;
        createPresignedUrl: _trpc_server.TRPCMutationProcedure<{
            input: {
                key: string;
                contentType: string;
                appId: string;
            };
            output: {
                url: string;
                method: "PUT";
            };
            meta: object;
        }>;
        listFiles: _trpc_server.TRPCQueryProcedure<{
            input: {
                appId: string;
            };
            output: {
                path: string;
                type: string;
                id: string;
                name: string;
                userId: string;
                createdAt: Date | null;
                deletedAt: Date | null;
                url: string;
                contentType: string;
                appId: string | null;
            }[];
            meta: object;
        }>;
        infinityQueryFiles: _trpc_server.TRPCQueryProcedure<{
            input: {
                appId: string;
                cursor?: string | null | undefined;
                limit?: number | undefined;
                orderBy?: {
                    field: "type" | "name" | "createdAt" | "contentType";
                    order: "asc" | "desc";
                } | undefined;
            };
            output: {
                items: {
                    id: string;
                    name: string;
                    type: string;
                    createdAt: Date | null;
                    deletedAt: Date | null;
                    path: string;
                    url: string;
                    userId: string;
                    contentType: string;
                    appId: string | null;
                }[];
                nextCursor: string | null;
            };
            meta: object;
        }>;
        deleteFile: _trpc_server.TRPCMutationProcedure<{
            input: string;
            output: {
                id: string;
            };
            meta: object;
        }>;
    }>>;
}>>;
type OpenRouter = typeof openRouter;

export type { OpenRouter };
