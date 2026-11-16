import { Suspense } from "react";
import { connection } from "next/server";
import { getServerSession } from "@/server/auth";
import { redirect } from "next/navigation";
import { ThemeProvider } from "./ThemeProvider";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { Plan } from "./Plan";

/**
 * ⚠️ 这条路由的预渲染策略，别被「instant = false」的老注释误导：
 *
 * cacheComponents 会为这条路由预渲染「静态外壳」用于 Partial Prefetching。
 * 历史坑：外壳渲染时真的会执行 getServerSession()，next-auth v4 内部第一步
 * 是 createCSRFToken → require('node:crypto').randomBytes(size)，于是报
 *   "Route \"/dashboard\": Next.js encountered the unstable value
 *    `require('node:crypto').randomBytes(size)` while prerendering."
 *
 * 当时用的解法是 export const instant = false（整段跳过预渲染）。现在改成
 * 更轻的做法：layout 保持同步、只返回 <Suspense>，动态部分下沉到下面那个
 * async 子组件，并在子组件里【先 await connection() 再 getServerSession()】
 * —— randomBytes 因此永远只会在请求期执行，外壳能正常预渲染，instant 保持默认开启。
 *
 * ⚠️ 所以下面的导出【不是】 instant = false（那会让整条路由阻塞、丢掉即时 UI）：
 *    Next 的 instant-config 只在 `instant === false` 时放行阻塞式渲染，
 *    传对象一律视为「要求存在静态外壳」。这里传对象只是为了关掉 dev 期的
 *    instant 校验噪音：这条路永远拿不到静态外壳的校验样本，dev 下 Next 会报
 *      "Could not validate `instant` because the target segment was prevented
 *       from rendering"
 *    （生产不报）。
 */
export const instant = { unstable_disableDevValidation: true } as const;

/**
 * ⚠️ props 类型是 LayoutProps<"/dashboard">，不是自己手写对象：
 * Next 16 的 typed routes 会根据 app 目录自动生成这个类型，
 * 它 = { params: Promise<{}>; children: ReactNode } & { nav: ReactNode }
 * —— 并行插槽 @nav 会自动作为 `nav` 出现在里面。
 * 手写 { children: LayoutProps<"/">; nav: ReactNode } 会过不了路由校验
 * （validator.ts 报 TS2344：不满足 LayoutConfig<"/dashboard">）。
 *
 * 字体不用在这里再引一次：Geist 已经在 src/app/layout.tsx 里挂到 <html>
 * 的 CSS 变量上了，这里再 new 一份纯属重复。
 */
export default function DashboardLayout({
  children,
  nav,
}: LayoutProps<"/dashboard">) {
  // ⚠️ layout 本身保持同步，动态部分下沉到 async 子组件（DashboardShell），
  // 并且必须包在 <Suspense> 里 —— cacheComponents 要求不可缓存数据的访问
  // 落在 Suspense 边界内，否则报 "accessed outside of <Suspense>"。
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-sm text-gray-500">
          载入中…
        </div>
      }
    >
      <DashboardShell nav={nav}>{children}</DashboardShell>
    </Suspense>
  );
}

async function DashboardShell({
  children,
  nav,
}: {
  children: React.ReactNode;
  nav: React.ReactNode;
}) {
  // ⚠️ 必须在 getServerSession() 【之前】：next-auth v4 内部第一步就是
  // createCSRFToken → randomBytes，早于任何 cookies() 访问，
  // 没有这行它会在预渲染阶段被真实执行并抛 "unstable value randomBytes"。
  await connection();

  const session = await getServerSession();

  if (!session?.user) {
    // 带上 callbackUrl，登录完能跳回 dashboard，而不是落在首页。
    redirect("/api/auth/signin?callbackUrl=%2Fdashboard");
  }

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
    <div className="flex h-screen flex-col">
      {/* shrink-0：不参与下面 main 的高度分配，否则导航会被内容挤扁 */}
      <nav className="relative h-[80px] shrink-0 border-b">
        {/* ⚠️ 必须写 mx-auto：本项目 Tailwind v4 的 container 只有
            width:100% + 各断点 max-width，【没有 margin-inline:auto】。
            少了 mx-auto，这一层就贴着窗口左边缘（left:0），
            而下面工具条是 container mx-auto（水平居中）→
            头像的右边缘会比 UploadButton 的右边缘靠左
            整整 (视口宽 - container 宽) / 2 个像素，窗口越宽差得越多
            （756px 视口差 58px，1440px 差 80px）。 */}
        <div className="container mx-auto flex gap-2 items-center justify-end h-full">
          <ThemeToggle></ThemeToggle>
          <div className="relative">
          {/* ⚠️ 用户菜单抽成 client 组件 UserMenu：退出登录要调 next-auth/react
              的 signOut，Server Component 里引不了。
              也顺带修掉了原来那段的结构问题 —— react-aria 的 Header 只有放在
              Section（DropdownMenuGroup）里才会进入集合，之前直接挂在 Menu 下，
              菜单渲染出来是空的（data-empty="true"），点开只有个名字、没有任何
              可点项，等于一个死的下拉。 */}
          <UserMenu
            name={session.user.name}
            image={session.user.image}
            email={session.user.email}
          />
            <Plan></Plan>
          </div>
        </div>
        {/* -translate-x-1/2 而不是 -translate-1/2：后者 x/y 各移 -50%，
            会把这块内容整体往上顶半格，垂直居中就没了 */}
        <div className="absolute top-0 left-1/2 flex h-full -translate-x-1/2 items-center justify-center">
          {nav}
        </div>
      </nav>
      {/* min-h-0 + flex-1：吃掉 80px 导航之外的剩余高度，并且允许内部滚动。
          原来是 h-[calc(100%-80px)]，没算 border-b 的 1px，整页会多出 1px 滚动 */}
      <main className="min-h-0 flex-1">{children}</main>
    </div>
    </ThemeProvider>
  );
}
