"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 倒计时自动跳转。
 * 为什么做成客户端组件：服务端组件没有生命周期，
 * 定时跳转必须跑在浏览器里。
 * 卸载时清除定时器（StrictMode 下 effect 会跑两次，不清理会提前跳）。
 */
export function AutoRedirect({
  href = "/dashboard",
  delayMs = 3000,
}: {
  href?: string;
  delayMs?: number;
}) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(Math.round(delayMs / 1000));

  useEffect(() => {
    const jump = setTimeout(() => router.push(href), delayMs);
    const tick = setInterval(
      () => setSeconds((s) => Math.max(s - 1, 0)),
      1000
    );
    return () => {
      clearTimeout(jump);
      clearInterval(tick);
    };
  }, [href, delayMs, router]);

  return (
    <p className="text-xs text-muted-foreground">
      {seconds} 秒后自动跳转到仪表盘…
    </p>
  );
}
