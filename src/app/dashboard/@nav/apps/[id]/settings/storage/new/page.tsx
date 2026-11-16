"use client";

import { BreadCrumb } from "../../breadcrumb";

// 并行插槽每个子路由都要有自己的 page，否则硬导航到该 URL 时
// @nav 会退回 default.tsx，只剩一个 "Dashboard"，看起来像导航坏了。
// storage 的创建仍跳转到 ./new 表单页，所以这个文件必须保留。
export default function NewStorageNav() {
  return <BreadCrumb suffix="Storage / New" />;
}
