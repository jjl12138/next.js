"use client";

import { AppSwitcherNav } from "@/components/feature/AppSwitcherNav";

// 定价页（/dashboard/apps/[id]/plan）的顶部导航插槽。
// ⚠️ 并行插槽 @nav 每个子路由都要有自己的 page，否则软导航到该 URL 时
//    会沿用上一个页面的插槽内容，硬刷新则退回 default.tsx（只剩 "Dashboard"），
//    两种表现都像「导航坏了」（settings/danger 的同名坑）。
export default function PlanNav() {
  return <AppSwitcherNav suffix="Plan" />;
}
