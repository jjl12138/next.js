import { redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { getServerSession } from "@/server/auth";
import { createCaller } from "@/server/router";
import { BackButton } from "./BackButton";
import { SubmitButton } from "./SubmitButton";

/**
 * 表单侧校验。
 * ⚠️ 原来是从 `@/server/db/validate-schema` import 的 `createAppSchema`，
 *    但那个模块只导出 insertUserSchema / updateUserSchema / filesCanOrderByColumns，
 *    从来没有 createAppSchema（TS2305，直接把整页编译崩掉）。
 *
 * 长度上限跟 schema.ts 里的 varchar(100) / varchar(500) 对齐，
 * 否则超长时 PG 会抛 value too long，而不是给出友好提示。
 */
const createAppFormSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(100, "名称过长"),
  description: z.string().trim().max(500, "描述过长").nullish(),
});

export default async function NewAppPage({
  searchParams,
}: PageProps<"/dashboard/apps/new">) {
  // searchParams 在 Next 15+ 是 Promise，必须 await。
  const { error } = await searchParams;

  // 可能是 string[]（URL 里写成 ?error=a&error=b），只取第一个。
  const errorMessage = Array.isArray(error) ? error[0] : error;

  /**
   * 内联 Server Action：直接挂在 <form action={...}> 上。
   * 不用 "use client" 也不需要 onSubmit / fetch，表单原生提交即可，
   * 且 JS 未加载时也能用（渐进增强）。
   */
  async function createApp(formData: FormData) {
    "use server";

    const rawName = formData.get("name");
    const rawDescription = formData.get("description");

    const parsed = createAppFormSchema.safeParse({
      name: rawName,
      // 空字符串归一成 undefined：后端 description 是 .nullish()，
      // 存 "" 会让「没填描述」和「填了空描述」变成两种状态。
      description:
        typeof rawDescription === "string" && rawDescription.trim() === ""
          ? undefined
          : rawDescription,
    });

    // ⚠️ 原来这里是 `if (parsed.success) { ... }`，失败分支什么都不做
    //    → 用户点了提交，页面纹丝不动，也没有任何提示。
    //    现在失败时带着错误信息跳回本页重新渲染。
    //
    // 注意不能 throw：Server Action 里抛异常 = 整页 500，
    // 用户只会看到一个错误页，比「没反应」更糟。
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "输入不合法";
      redirect(`/dashboard/apps/new?error=${encodeURIComponent(message)}`);
    }

    const session = await getServerSession();

    if (!session?.user) {
      // 兜一层：layout 理论上已经拦过未登录，但 Server Action 是可以被
      // 直接 POST 的（action id 泄露 / 旧页面），不能只依赖 layout。
      redirect("/api/auth/signin?callbackUrl=%2Fdashboard%2Fapps%2Fnew");
    }

    // redirect() 靠抛 NEXT_REDIRECT 工作，绝不能放进 try/catch ——
    // catch 会把这个内部错误吞掉，跳转就静默失效了。
    // 所以这里只包住「可能真出错」的调用，拿到 id 后再跳。
    let createdId: string | null = null;
    let failureMessage: string | null = null;

    try {
      const app = await createCaller({ session }).apps.createApp(parsed.data);
      createdId = app.id;
    } catch (error) {
      failureMessage =
        error instanceof Error ? error.message : "创建应用失败，请重试";
    }

    if (failureMessage) {
      redirect(
        `/dashboard/apps/new?error=${encodeURIComponent(failureMessage)}`
      );
    }

    // ⚠️ 必须用【反引号】。原来写的是单引号：
    //      redirect('/dashboard/apps/new/${newsApp.id}')
    //    单引号里 ${...} 不会被求值，字面量原样进 URL，
    //    结果跳到 /dashboard/apps/$%7BnewsApp.id%7D —— 一个不存在的路由。
    redirect(`/dashboard/apps/${createdId}`);
  }

  return (
    // ⚠️ h-full 而不是 h-screen：
    //    本页渲染在 dashboard/layout.tsx 的 <main className="min-h-0 flex-1"> 里，
    //    外层已经是 h-screen（80px 导航 + 1px border-b）。
    //    这里再写 h-screen = 把 100vh 塞进 100vh-81px 的格子 → 整页多出 81px 滚动。
    <div className="flex h-full items-center justify-center overflow-auto">
      <form className="flex w-full max-w-md flex-col gap-4" action={createApp}>
        <h1 className="text-center text-2xl font-bold">Create App</h1>

        {errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : null}

        <Input name="name" placeholder="App Name" required maxLength={100} />
        <Textarea name="description" placeholder="Description" maxLength={500} />
        {/* 取消/返回：走浏览器历史（可能从任意页面进来），没有历史时兜底回仪表盘。 */}
        <div className="flex gap-2">
          <SubmitButton></SubmitButton>
          <BackButton />
        </div>
      </form>
    </div>
  );
}
