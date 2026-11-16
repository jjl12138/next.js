"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { useTRPC } from "@/utils/api";
import { useAppId } from "@/utils/useAppId";

/**
 * 危险操作页：目前只有「删除应用」。
 *
 * 删除是软删除（只写 deleted_at）：应用从列表里消失，文件记录保留。
 * 想改行为去 src/server/routes/apps.ts 的 deleteApp。
 */
export default function DangerZonePage() {
  const appId = useAppId();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [confirmOpen, setConfirmOpen] = useState(false);

  // ⚠️ React hook 必须由 useMutation(trpc.x.mutationOptions()) 组合出来，
  //    经典的 .useMutation() 语法糖在本项目客户端里没有（见 FileItemAction.tsx 注释）。
  const { mutate: deleteApp, isPending } = useMutation(
    trpc.apps.deleteApp.mutationOptions({
      onSuccess: () => {
        toast.success("应用已删除");
        setConfirmOpen(false);
        // ⚠️ 应用列表页是 /dashboard（dashboard/page.tsx 渲染 listApps），
        //    /dashboard/apps 这个路径没有 page.tsx，push 过去就是 404 ——
        //    之前写错成 /dashboard/apps，删完应用直接白屏 404。
        router.push("/dashboard");
        // 先跳列表页再失效缓存：人已经离开本页，列表重新拉取时
        // 已删的应用自然消失。invalidate 用 pathKey() 匹配 apps 下所有 query。
        return queryClient.invalidateQueries({
          queryKey: trpc.apps.pathKey(),
        });
      },
      onError: (error) => {
        toast.error(`删除失败：${error.message}`);
      },
    })
  );

  // ⚠️ appId 可能拿不到（Next 16 的 params 是 Promise，useAppId 内部处理了，
  //    但路由异常时仍可能为空）：没有合法 id 就不渲染危险区，避免对 undefined
  //    发起 mutation。
  if (!appId) {
    return (
      <div className="px-4 pt-10 text-sm text-muted-foreground">缺少应用 id</div>
    );
  }

  return (
    <div className="px-4 pt-10">
      <div className="rounded-lg border border-destructive/30 p-6">
        <h1 className="text-lg font-semibold text-destructive">Delete App</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          删除后应用会从列表中消失，API Key 立即失效（软删除：文件记录保留，不可恢复入口暂未提供）。
        </p>
        <Button
          variant="destructive"
          className="mt-4"
          onClick={() => setConfirmOpen(true)}
        >
          删除应用
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent aria-label="确认删除应用">
          <DialogHeader>
            <DialogTitle>确认删除这个应用？</DialogTitle>
            <DialogDescription>
              删除后应用将从列表消失，使用它 API Key 的客户端将全部 403。
              此操作在当前版本下无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteApp({ id: appId })}
              disabled={isPending}
            >
              {isPending ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
