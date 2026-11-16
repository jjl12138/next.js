"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAppId } from "@/utils/useAppId";

/**
 * /dashboard/apps/<id>/settings 本身没有内容 —— 它只是 settings 下两个子页
 * （storage / api-key）的公共布局。不补这个文件的话，直接在地址栏输到
 * /settings 会 404，「设置」这个入口等于半个坏的。
 *
 * ⚠️ 用客户端 replace 而不是服务端 redirect：
 *    settings/layout.tsx 已经是 client component（要靠 usePathname 做侧栏高亮），
 *    服务端 redirect 又要处理 Next 16 的 `params: Promise` + cacheComponents 的
 *    Suspense 约束，为一个纯跳转不值得。replace 也不往 history 里塞记录，
 *    用户按后退不会又弹回来。
 */
export default function SettingsIndexPage() {
  const appId = useAppId();
  const router = useRouter();

  useEffect(() => {
    if (appId) {
      router.replace(`/dashboard/apps/${appId}/settings/storage`);
    }
  }, [appId, router]);

  if (!appId) {
    return (
      <div className="px-4 pt-10 text-sm text-muted-foreground">
        缺少应用 id
      </div>
    );
  }

  return (
    <div className="px-4 pt-10 text-sm text-muted-foreground">正在打开设置…</div>
  );
}
