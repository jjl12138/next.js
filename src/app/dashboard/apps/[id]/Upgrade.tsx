import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
// 定价页组件在 Plan.tsx（同目录）。
import { PlanPricing } from "./Plan";

export function UpgradeDialog({open, onOpenChange}: {open: boolean, onOpenChange: (f: boolean)=> void}){
    return <Dialog open={open} onOpenChange={onOpenChange}>
        {/* ⚠️ DialogContent 默认 sm:max-w-sm（384px），装不下双栏定价卡，
            必须传同断点的 sm:max-w-3xl 让 tailwind-merge 替换掉默认值
            （page.tsx 的 Make Url 弹窗踩过同一个坑）。 */}
        <DialogContent className="sm:max-w-3xl">
            {/* DialogTitle 要留在弹窗内，供无障碍（aria）关联 */}
            <DialogTitle>升级方案</DialogTitle>
            <DialogDescription>
                你现在是免费用户，无法上传更多文件，请升级
            </DialogDescription>
            <PlanPricing />
        </DialogContent>
    </Dialog>;
}
