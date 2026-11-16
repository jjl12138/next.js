import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Stripe } from "stripe";

import { Button } from "@/components/ui/Button";
import { db } from "@/server/db/db";
import { users } from "@/server/db/schema";
import { getServerSession } from "@/server/auth";

import { AutoRedirect } from "./AutoRedirect";

/**
 * Stripe Checkout 支付成功回调页。
 *
 * 没有配 webhook 的情况下，这是把 plan 写回 paid 的唯一时机：
 * 用 URL 里的 session_id 向 Stripe 反查支付状态（服务端发起，
 * 密钥不出后端），paid 才写库 —— 不能信任前端跳转本身。
 *
 * TODO(支付)：生产应改用 webhook（checkout.session.completed）落库，
 * 本页只负责展示结果；webhook 能覆盖「用户付了款但没回到回调页」的情况。
 */

// ⚠️ 本页读 searchParams（session_id）、查 Stripe、查数据库，必须每次请求
//    实时执行。Cache Components（next.config 开启）默认要求这类数据访问
//    包在 <Suspense> 里或显式声明为阻塞式路由——本页语义就是"阻塞+动态"，
//    用 instant=false 声明（无预渲染，不影响功能）。
export const instant = false;

export default async function PaySuccessPage({
  searchParams,
}: PageProps<"/pay/callback/success">) {
  const { session_id } = await searchParams;

  if (typeof session_id !== "string" || session_id === "") {
    redirect("/dashboard");
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  let paid = false;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    // subscription 模式下，卡类测试支付 payment_status 会是 'paid'；
    // 异步方式（银行转账等）可能 unpaid，那种情况等 webhook 补写。
    paid = session.payment_status === "paid";
  } catch {
    // session_id 无效/过期：不写库，按取消处理。
    redirect("/pay/callback/cancel");
  }

  let granted = false;
  let ownerMismatch = false;
  if (paid) {
    const session = await getServerSession();
    if (session?.user?.id) {
      // ⚠️ 越权防护：session_id 在 URL 里，谁拿到链接都能打开本页。
      //    getServerSession() 只能证明"正在看页面的人是谁"，不能证明
      //    "付款的人是谁"。必须回查订单表确认这笔 session 真的属于
      //    当前登录用户（userId 是创建 checkout 时写入的），不是就不写库
      //    —— 防止把成功链接发给别人、别人被白嫖升级。真正的升级由
      //    webhook 按订单归属完成。
      const order = await db.query.orders.findFirst({
        where: (orders, { eq }) => eq(orders.sessionId, session_id),
      });

      if (order?.userId === session.user.id) {
        granted = true;
        await db
          .update(users)
          .set({ plan: "paid" })
          .where(eq(users.id, session.user.id));
      } else if (order) {
        // 明确知道"看页面的人不是付款人"，如实告诉他，
        // 而不是让他以为自己的账号会升级（然后一直等不到）。
        ownerMismatch = true;
      }
      // order 查不到：可能是数据异常，保持含糊文案，不暴露订单信息。
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">
        {granted ? "升级成功" : paid ? "支付已完成" : "支付处理中"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {granted
          ? "你的账号已升级到 Pro，所有限制已解除。"
          : ownerMismatch
            ? "支付已完成，但当前登录的不是付款账号。升级将应用到发起支付的账号，请用该账号登录后查看。"
            : paid
              ? "支付已完成，升级将在短时间内自动生效。"
              : "支付还在确认中，确认后自动生效（可能需要几分钟）。"}
      </p>
      {granted ? <AutoRedirect /> : null}
      {/* base-ui Button 渲染成 <a> 时必须 nativeButton={false}，
          否则按 <button> 语义往 <a> 上注入 type 等属性（dev 会警告）。
          项目里其它 render={<Link/>} 的用法均带此 prop。 */}
      <Button render={<a href="/dashboard" />} nativeButton={false}>回到仪表盘</Button>
    </div>
  );
}
