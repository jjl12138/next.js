"use client";

import { useParams, usePathname } from "next/navigation";

/**
 * 从 /dashboard/apps/[id]/... 里取应用 id。
 *
 * ⚠️ 不能只靠 useParams()：
 *    1. 它的类型是 { [key: string]: string | string[] }，
 *       并行插槽（本项目 dashboard 有 @nav）下同名动态段可能合并成数组；
 *    2. 更麻烦的是【软导航】：new 页 router.push 回列表页的那一瞬，
 *       params 可能还没就绪（实测硬导航正常，软导航会读到空/undefined），
 *       于是页面一进来就命中 `!appId` 早返回，显示「缺少应用 id」——
 *       刷新一下又好了，看起来像玄学。
 *    3. 这些路由在 .next/types/routes.d.ts 里根本没有登记（只登记了 "/dashboard"），
 *       没有任何编译期校验兜底，全靠运行时。
 *
 * 所以这里双路取值：params 优先，取不到再从 pathname 里解一次。
 * pathname 在 URL 变化后一定是对的，不受 params 时序影响。
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APP_PATH_RE = /\/dashboard\/apps\/([^/]+)/;

export function useAppId(): string | undefined {
  const params = useParams();
  const pathname = usePathname();

  const raw = params?.id;
  const candidates: Array<string | string[] | undefined> = Array.isArray(raw)
    ? raw
    : [raw];

  const fromPath = pathname?.match(APP_PATH_RE)?.[1];
  if (fromPath) candidates.push(fromPath);

  // 必须是 uuid 形状才认：bindStorage / unbindStorage 的入参是 z.uuid()，
  // 拿非 uuid 去 mutate 只会被服务端 zod 拦下，表现为「点了弹出绑定失败」。
  return candidates.find(
    (v): v is string => typeof v === "string" && UUID_RE.test(v)
  );
}
