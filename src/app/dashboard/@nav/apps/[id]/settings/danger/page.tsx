"use client";

import { BreadCrumb } from "../breadcrumb";

/**
 * ⚠️ 这个文件必须存在：并行插槽 @nav 里没有 danger 这个段时，
 *    软导航到 /settings/danger 的那一帧 Next 会沿用【上一个页面】的
 *    插槽内容（比如 storage / api keys 的面包屑），
 *    硬刷新才会退回 @nav/default.tsx（只剩一个 Dashboard）。
 *    两种表现都像「导航坏了」。每个子路由都要有自己的 page.tsx。
 */
export default function DeleteAppSettingsNav() {
  return <BreadCrumb suffix="Delete App" />;
}
