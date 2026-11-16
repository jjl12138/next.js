import { db } from "@/server/db/db";
import { AuthOptions, getServerSession as nextAuthGetServerSession } from "next-auth"
// DefaultSession 必须显式 import。
// 它不会因为写了 declare module "next-auth" 就自动进作用域 ——
// 模块增强只是把声明【合并】进 next-auth，不会把它的导出拉到本文件。
import type { DefaultSession, DefaultUser } from "next-auth"
import type { Adapter } from "next-auth/adapters"
import GithubProvider from "next-auth/providers/github"
import { DrizzleAdapter } from "@auth/drizzle-adapter"

declare module "next-auth" {
    interface Session extends DefaultSession{
        user: {
            id: string;
        } & DefaultSession["user"];
    }
 }

export const authOptions: AuthOptions = {
    // next-auth v4 的 Adapter 是自己重新声明的（方法可选、签名不同），
    // 和 @auth/core 的 Adapter 是两套独立类型，官方推荐的用法就是显式断言。
    // 运行时二者方法名/参数一致，断言不影响行为。
    adapter: DrizzleAdapter(db) as unknown as Adapter,
    callbacks: {
        async session({session, user}){
            if(session.user && user){
                session.user.id = user.id;
            }
            return session;
        }
    },
    // Configure one or more authentication providers
    providers: [
        GithubProvider({
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        }),
        // ...add more providers here   
    ]
}

export function getServerSession() {
    return nextAuthGetServerSession(authOptions);
}