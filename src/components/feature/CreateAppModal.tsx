"use client";

import { usePathname, useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/Dialog";

/**
 * 拦截路由（@intercepting 插槽）专用的客户端外壳。
 *
 * ⚠️ 为什么必须单独一个文件：
 *    Server Component 不能给 Client Component 传函数 —— props 需要序列化，
 *    React 会直接抛 "Functions cannot be passed directly to Client Components"。
 *    所以 `onOpenChange`（以及 useRouter / usePathname）只能活在有 "use client"
 *    的文件里；而表单那棵子树（含 Server Action）依旧留在服务端渲染，
 *    以 children 的形式传进来 —— 它是已经渲染好的 RSC 节点，不受序列化限制。
 */
export function CreateAppModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  /**
   * ⚠️ open 不能写死 `true`。
   *
   *    并行插槽在【软导航】下会保留它上一次的 active 状态，哪怕已经不匹配当前 URL
   *    （Next 官方对 default.tsx 的说明里写明了这一点）。
   *    所以 Server Action 里 redirect 到 /dashboard/apps/{id} 之后，
   *    这个插槽里的拦截内容仍然是挂载的 —— 实测：弹窗跟着新页面一起留在屏幕上。
   *
   *    让 open 跟着 URL 走是最省事且可靠的解法：路径不再是 /dashboard/apps/new，
   *    弹窗就该关掉。注意这不会触发 onOpenChange（那是用户操作才会调），
   *    所以不会和下面的 router.back() 打架。
   */
  const open = pathname === "/dashboard/apps/new";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // 关闭（点 × / 按 Esc / 点遮罩）＝ 退出拦截，回到触发跳转前的那条路由。
        // 用 back() 而不是 push()：从这里无从得知「上一个」具体是哪个 app 页，
        // push 到写死的地址会把用户甩到错误的 app。
        if (!isOpen) router.back();
      }}
    >
      <DialogContent
        // base-ui 的 Popup 会把 aria-labelledby 指向 DialogTitle 的 id；
        // 这里表单本身已经有可见的 <h1>Create App</h1>，再挂一个 DialogTitle
        // 读屏软件会念两遍，所以用 aria-label 直接给弹窗命名。
        aria-label="Create App"
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
