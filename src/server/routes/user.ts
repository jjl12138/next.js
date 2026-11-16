import { db } from "../db/db";
import { protectedProcedure, router } from "../trpc";
import { orders, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {Stripe} from "stripe";
import { TRPCError } from "@trpc/server";

export const userRouter = router({
    getPlan: protectedProcedure
      .query(async ({ ctx }) => {
        // ctx.session.user.id 由 protectedProcedure 保证非空。
        const result = await db.query.users.findFirst({
          where: eq(users.id, ctx.session.user.id),
          columns: { plan: true },
        });

        // ⚠️ plan 列在 schema 里是可空的：GitHub 新用户注册后 plan 为 null。
        //    如果把 null 原样返回，前端 `plan ?? "Loading..."`
        //    会把「已登录的免费用户」永远显示成 Loading —— 看起来像接口挂了。
        //    业务上新用户默认 free，在这里兜底（后续 schema 加 .default("free")
        //    后这行可以简化，但需要一次迁移，先不动表结构）。
        return result?.plan ?? "free";
      }),

    // ⚠️ 模拟升级/降级：没有支付流程，直接改库里的 plan。
    //    TODO(支付)：接入支付后，这里不能信任客户端传入的目标档位，
    //    应改为由支付回调（webhook）在验证订单后写入 plan，
    //    本 mutation 要么删掉要么只允许服务端内部调用。
    //    枚举和 schema 的 plan 列（'free' | 'paid'）保持一致，
    //    传别的值 zod 直接 BAD_REQUEST，不会写脏数据。
    setPlan: protectedProcedure
      .input(z.object({ plan: z.enum(["free", "paid"]) }))
      .mutation(async ({ ctx, input }) => {
        // ⚠️ 降级免费不需要付钱：原来不管传什么都创建 checkout，
        //    paid 用户点「降级到 Free」也会被拉去付款页。降级直接改库。
        if (input.plan === "free") {
          await db
            .update(users)
            .set({ plan: "free" })
            .where(eq(users.id, ctx.session.user.id));
          // url 为 null 表示无需跳转，前端据此走 invalidate 刷新。
          return { url: null };
        }

        // 升级 paid：走 Stripe Checkout。密钥只从环境变量读（.env 已配置），
        // ⚠️ 原来带 `?? "sk_test_..."` 硬编码 fallback —— 密钥写进源码即泄露，
        //    一旦进 Git 必须作废换新。缺失时直接 500，绝不落一个默认值。
        if (!process.env.STRIPE_SECRET_KEY) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "支付服务未配置（缺少 STRIPE_SECRET_KEY）",
          });
        }
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const session = await stripe.checkout.sessions.create({
            line_items: [
            {
                // Provide the exact Price ID (for example, price_1234) of the product you want to sell
                price: 'price_1UbiI9QL0WQOh3aQgJ0FD2fJ',
                quantity: 1,
            },
            ],
            mode: 'subscription',
            // ⚠️ 成功页带 session_id 回来，success 页用它向 Stripe 反查
            //    支付状态后再写 plan（见 /pay/callback/success）。
            success_url: `http://localhost:3000/pay/callback/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `http://localhost:3000/pay/callback/cancel`,
            // ⚠️ 原来 `integration_identifier: '{{INTEGRATION_ID}}'` 是从 Stripe
            //    文档原样复制的占位符，花括号不是合法字符（只允许字母数字-_.），
            //    SDK 直接抛 "must only consist of alphanumeric characters..."
            //    → 点「升级到 Pro」必报错。这是可选项，直接删掉。
        });

        if(!session.url){
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
            })
        }

        await db.insert(orders).values({
            sessionId: session.id,
            userId: ctx.session.user.id,
            status: "created",
        })

        return {
            url: session.url,
        };

        // await db
        //   .update(users)
        //   .set({ plan: input.plan })
        //   .where(eq(users.id, ctx.session.user.id));

        // return input.plan;
      }),
    })
