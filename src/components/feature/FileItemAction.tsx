"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Copy } from "lucide-react";
import { useTRPC } from "@/utils/api";
import { Button } from "../ui/Button";
import copy from "copy-to-clipboard"
import { toast } from "sonner";

export function DeleteFile({ fileId }: { fileId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // tRPC v11 + @trpc/tanstack-react-query 的 mutation 写法：
  // 语法糖 .useMutation() 在经典 @trpc/react-query 里才有，本项目的客户端
  // （createTRPCClient）只有 .mutate()/.mutation()，不带 React hook。
  // React hook 必须由 useMutation(trpc.x.mutationOptions()) 组合出来。
  const { mutate: deleteFile, isPending } = useMutation(
    trpc.file.deleteFile.mutationOptions({
      // ⚠️ 之前没弹 toast 就是因为这里只有 invalidate —— 
      //    mutationOptions 不会自带任何通知，成功/失败都得自己 toast。
      onSuccess: () => {
        toast.success("文件已删除");
        // 软删后让文件列表重新拉一次。
        // pathKey() 返回 ["file"] 这一层的前缀，能匹配 file 下所有 query，
        // 包括 infinityQueryFiles 的 infinite query key（分页请求全部失效）。
        return queryClient.invalidateQueries({
          queryKey: trpc.file.pathKey(),
        });
      },
      onError: (error) => {
        toast.error(`删除失败：${error.message}`);
      },
    })
  );

  const handleRemoveFile = () => {
    deleteFile(fileId);
  };

  return (
    <Button variant="ghost" aria-label="删除文件" onClick={handleRemoveFile} disabled={isPending}>
      <Trash2 />
    </Button>
  );
}

export function CopyUrl({
  url,
  onMakeUrl,
}: {
  url: string;
  // 可选：复制成功后再回调（page.tsx 拿它打开 Make Url 弹窗）。
  onMakeUrl?: () => void;
}) {
  // ⚠️ copy-to-clipboard v4 的 copy() 返回的是 Promise<boolean>（v3 才是同步 boolean）。
  //    原来「copy(url) 写完立刻 toast 成功」的写法，无论复制是否真的成功都会弹成功。
  //    必须 await 到结果再决定弹哪种 toast。
  const handleCopy = async () => {
    try {
      const ok = await copy(url);
      if (ok) {
        toast.success("Url Copy Succeed!");
        // 复制成功后再打开 Make Url 弹窗；失败就不弹，避免「弹窗开了但原始链接没进剪贴板」的困惑。
        onMakeUrl?.();
      } else {
        // 常见失败场景：非安全上下文（用 http://局域网 IP 访问）、浏览器权限被拒。
        toast.error("复制失败，请手动复制");
      }
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  return (
    // ⚠️ 原来写的是 onClick={onClick}：props 里根本没有 url，handleCopy 定义了
    //    却没被绑定 —— 点了永远不会复制。复制逻辑必须挂到按钮自己的 onClick 上。
    <Button variant="ghost" aria-label="复制文件链接" onClick={handleCopy}>
      <Copy />
    </Button>
  );
}
