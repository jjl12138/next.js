"use client";

import { AppSwitcherNav } from "@/components/feature/AppSwitcherNav";

// 应用主页：只显示应用名，不加面包屑。
// 实现和所有踩坑说明都在 AppSwitcherNav 里（@nav 各插槽共用一份）。
export default function AppHomeNav() {
  return <AppSwitcherNav />;
}
