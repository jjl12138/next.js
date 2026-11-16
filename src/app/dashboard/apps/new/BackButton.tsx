"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";

/**
 * 返回上一页按钮。
 *
 * 为什么不能用 <a href>：上一页是动态的（可能从仪表盘来，
 * 也可能从某个 app 详情页来），只能交给浏览器历史栈。
 *
 * history.length <= 1 说明没有可退的历史（比如直接输入地址进来），
 * 此时兜底跳仪表盘，避免点了没反应。
 */
export function BackButton({ fallbackHref = "/dashboard" }: { fallbackHref?: string }) {
  const router = useRouter();

  return (
    <Button
      variant="outline"
      className="flex-1"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
    >
      取消
    </Button>
  );
}
