"use client";

// ⚠️ 关键区分：
//   toast(...)  = 【发通知】——只往 sonner 内部的一个 store 里 push 一条数据，
//                 它自己不渲染任何 DOM。
//   <Toaster /> = 【收通知】——真正把 store 里的东西画到屏幕上的渲染器。
// 只 copy 了 toast 的调用、树上没挂 <Toaster />，就等于往队列里塞消息但没人消费：
// 不报错、不警告、控制台干净，就是什么都不出现。这就是「copy 没生效」的原因。
import { Toaster as SonnerToaster, toast } from "sonner";

import { Button } from "@/components/ui/Button";

/**
 * 必须【全局挂一个】——放在 RootLayout 里，而不是放进触发 toast 的那个页面/组件。
 * 挂两处会出现两份 toast；挂在局部组件里，组件卸载时正在显示的 toast 会一起消失。
 */
export function Toaster() {
  return (
    <SonnerToaster
      // 可选值：top-left / top-center / top-right /
      //        bottom-left / bottom-center / bottom-right
      // 这个属性只在这里改一处，全局生效，不用去每个 toast() 里传 position。
      position="bottom-center"
      richColors
      closeButton
      // sonner 自带样式，不依赖 next-themes。项目里没装 next-themes，
      // 别照抄 shadcn 官方那份 sonner.tsx（它 import next-themes 会直接编译报错）。
      theme="system"
    />
  );
}

/** 仅用于自测：点一下验证 toast 链路通不通。确认可用后可以从 layout 里去掉。 */
export function SonnerDemo() {
  return (
    <Button
      variant="outline"
      onClick={() =>
        toast("Event has been created", {
          description: "Sunday, December 03, 2023 at 9:00 AM",
          action: {
            label: "Undo",
            onClick: () => console.log("Undo"),
          },
        })
      }
    >
      Show Toast
    </Button>
  );
}
