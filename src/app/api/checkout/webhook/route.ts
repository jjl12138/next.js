import { db } from "@/server/db/db";
import { orders, users } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      sig ?? "",
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("", { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const sessionId = (event.data.object as Stripe.Checkout.Session).id;

    const order = await db.query.orders.findFirst({
      where: (orders, { eq }) => eq(orders.sessionId, sessionId),
    });

    // 不认识的 session，让 Stripe 重试
    if (!order) {
      return new Response("", { status: 400 });
    }

    // 已完成过 → 幂等成功，返回 200 防止 Stripe 重复重试
    if (order.status === "completed") {
      return new Response(null, { status: 200 });
    }

    // 只在仍是 created 时更新：where 必须带上 status 条件（原来注释声称
    // 「最多执行一次」但 where 只有 sessionId，status === "canceled" 的订单
    // 收到 completed 事件也会被翻转成 completed 并把用户升到 paid）。
    // 并发回调下第二个请求 update 不到行，自然幂等。
    const updated = await db
      .update(orders)
      .set({ status: "completed" })
      .where(and(eq(orders.sessionId, order.sessionId), eq(orders.status, "created")))
      .returning();

    if (updated.length === 0) {
      // 没更新到行 = 已经处理过（completed）或订单已取消，直接幂等返回
      return new Response(null, { status: 200 });
    }

    await db
      .update(users)
      .set({ plan: "paid" })
      .where(eq(users.id, order.userId));

    console.log(
      `Order ${updated[0]?.sessionId} completed, user ${order.userId} upgraded to paid`,
    );
  }

  return new Response(null, { status: 200 });
}
