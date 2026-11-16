import { Button } from "@/components/ui/Button";

/**
 * Stripe Checkout 用户取消支付回调页。
 * 只做展示：plan 未变，用户可以回定价页重新发起。
 */
export default function PayCancelPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">已取消支付</h1>
      <p className="text-sm text-muted-foreground">
        你的账号保持在当前方案，随时可以再次升级。
      </p>
      <Button render={<a href="/dashboard" />} nativeButton={false}>回到仪表盘</Button>
    </div>
  );
}
