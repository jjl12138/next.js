"use client";

// Pricing Page（ChatGPT / Claude 风格的双栏定价卡）
//
// ⚠️ 这是组件不是路由：文件放在 [id]/ 目录下但叫 Plan.tsx，Next 只认 page.tsx。
//    当前接入了两个渲染点：
//      · UpgradeDialog（Upgrade.tsx）—— free 用户触发 FORBIDDEN 时弹出；
//    想做成独立页面的话，新建 [id]/plan/page.tsx 导入并渲染 <PlanPricing /> 即可。
//
// ⚠️ 当前是【模拟升级】：user.setPlan 直接改库里的 plan，没有支付流程。
//    接入真支付后：Pro 的 CTA 应改为发起支付（生成订单 → 跳转/扫码），
//    由支付回调写 plan，本页的 onClick 全部要换。

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/api";
import { Button } from "@/components/ui/Button";
import { cn } from "cn";

// 两档方案的功能清单。⚠️ Free 的「每个应用 1 个文件」是后端真实执行的规则
//（files.ts / files-open.ts 的 createPresignedUrl），文案必须和实际行为一致，
// 别写成营销上好看但代码里没实现的限制。
const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    price: "¥0",
    period: "/月",
    description: "适合个人轻度使用，体验完整的图片托管流程",
    features: [
      "每个应用最多上传 1 个文件",
      "图片直链访问（/image/{id}）",
      "自定义对象存储（S3 / COS 兼容）",
      "开放 API（api-key 调用）",
    ],
  },
  {
    id: "paid" as const,
    name: "Pro",
    price: "¥20",
    period: "/月",
    description: "面向频繁使用图床的创作者与团队",
    features: [
      "每个应用不限文件数量",
      "更高优先级的图片处理转码",
      "批量生成外链与过期时间控制",
      "优先技术支持",
    ],
  },
];

export function PlanPricing() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // 和 dashboard/Plan.tsx（头像旁的小徽章）同一套约定：
  // plan 列可空，新用户后端已兜底返回 "free"。
  const { data: currentPlan } = useQuery({
    ...trpc.user.getPlan.queryOptions(),
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  // 升级/降级：
  //   · 升级 → 后端创建 Stripe Checkout 会话，前端跳收银台；
  //     成功页（/pay/callback/success）反查支付状态后写库。
  //   · 降级 → 后端直接改库返回 url=null，invalidate getPlan：
  //     本页「当前方案」高亮和头像旁徽章（dashboard/Plan.tsx，同一个 key）
  //     立刻刷新；免费限制读的是登录会话实时查库，下一次操作即生效。
  const setPlan = useMutation(
    trpc.user.setPlan.mutationOptions({
      onSuccess: (resp) => {
        if (resp.url) {
          window.location.href = resp.url;
        } else {
          void queryClient.invalidateQueries({
            queryKey: trpc.user.getPlan.queryKey(),
          });
          toast.success("已降级到 Free");
        }
      },
      onError: (err) => {
        toast.error(`切换失败：${err.message}`);
      },
    })
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h2 className="text-center text-3xl font-semibold tracking-tight">
        选择适合你的方案
      </h2>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        随时升级或降级，按月计费
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          // Pro 是推荐档（ChatGPT/Claude 都是右栏高亮），除非用户已经是 paid。
          const isRecommended = plan.id === "paid" && !isCurrent;

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-6",
                isRecommended && "border-primary shadow-lg ring-2 ring-primary/30"
              )}
            >
              {isRecommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  推荐
                </span>
              )}

              <h3 className="text-lg font-semibold">{plan.name}</h3>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">
                  {plan.price}
                </span>
                <span className="text-sm text-muted-foreground">
                  {plan.period}
                </span>
              </div>

              <p className="mt-2 min-h-10 text-sm text-muted-foreground">
                {plan.description}
              </p>
              {/* ⚠️ min-h-10（=2 行 text-sm）：两张卡的描述长短不一，
                  行数不同会把 CTA 和下面的功能清单顶得不齐。
                  锁定两行高后，两卡的按钮起点、清单每一行都在同一水平线上。 */}

              {/* CTA：
                  · 当前档位 → outline 禁用「当前方案」；
                  · 另一档 → 实心按钮，点击调 setPlan（模拟切换，无支付）。 */}
              {isCurrent ? (
                <Button
                  variant="outline"
                  className="mt-6"
                  disabled
                  aria-label="你当前使用的方案"
                >
                  当前方案
                </Button>
              ) : (
                <Button
                  className="mt-6"
                  disabled={setPlan.isPending}
                  onClick={() => setPlan.mutate({ plan: plan.id })}
                >
                  {setPlan.isPending
                    ? "切换中..."
                    : plan.id === "paid"
                      ? "升级到 Pro"
                      : "降级到 Free"}
                </Button>
              )}

              <ul className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        切换立即生效，文件数量限制自动调整
      </p>
    </div>
  );
}
