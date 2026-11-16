"use client"

import type { ComponentProps } from "react";
import {useSession, SessionProvider as NextAuthProvider} from "next-auth/react";

export function UserInfo() {
  const session = useSession();

  console.log("session", session);

  return <div>
    {session.data?.user?.name}
  </div>
}

// ✅ props: any 会踩 @typescript-eslint/no-explicit-any。
// 透传组件的正确写法是 ComponentProps<typeof 被包装的组件>：
// 既不丢类型，也不用自己抄一遍 next-auth 的 props 定义。
export function SessionProvider(props: ComponentProps<typeof NextAuthProvider>) {
    return <NextAuthProvider {...props}></NextAuthProvider>
};