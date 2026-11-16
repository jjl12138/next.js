"use client";

// 独立定价页路由：/dashboard/apps/[id]/plan
// 直接渲染 PlanPricing（组件本体在同目录 Plan.tsx），
// 升级弹窗（Upgrade.tsx）里的内容和这里是同一个组件。
import { PlanPricing } from "../Plan";

export default function PlanPage() {
  return <PlanPricing />;
}
