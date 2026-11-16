"use client";

// ⚠️ 包名是 react-hook-form（不是 rect-hook-form），而且它是后加的依赖：
//    之前 package.json 里根本没有，光改拼写仍然 TS2307，得先 pnpm add react-hook-form。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { SubmitHandler, useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { S3StorageConfiguration } from "@/server/db/schema";
import { useTRPC } from "@/utils/api";
import { useAppId } from "@/utils/useAppId";

type StorageFormValues = S3StorageConfiguration & { name: string };

// ⚠️ 必须定义在【模块作用域】，不能写在组件函数体里：
//    写在里面的话每次 render 都是一个新的函数身份 → React 认为组件类型变了 →
//    整棵子树卸载重建 → 输入框每敲一个字就失焦一次。
function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </label>
  );
}

export default function NewStoragePage() {
  // ⚠️ 必须把 errors 取出来并渲染：register 里写的 required 提示
  //    【只存在于 formState.errors】，不显示的话校验确实拦住了提交，
  //    但界面上什么都不出现 —— 表现就是「点 Submit 没反应」。
  const {
    register,
    formState: { errors },
    handleSubmit,
  } = useForm<StorageFormValues>();

  const router = useRouter();

  // ⚠️ 不能像 Server Component 那样写 `params: { id }` 同步解构：
  //    Next 15/16 里 page 的 params 是 Promise，客户端组件同步解构拿到的是
  //    Promise 实例 → id 变成 "[object Promise]"，拼出来的 URL 直接 404。
  //    统一走 useAppId()（跟列表页 storage/page.tsx 一致）。
  const appId = useAppId();

  // ⚠️ 不是 trpcClientReact（utils/api.ts 根本没有这个导出，TS2304）。
  //    项目里统一的写法是 useTRPC() + useMutation(trpc.xxx.mutationOptions(...))。
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const createStorage = useMutation(
    trpc.storages.createStorage.mutationOptions({
      // ⚠️ 必须在【成功后】再跳回列表页。原来写的是 mutate(data) 紧接着
      //    router.push(...) —— mutate 是异步的，push 会先执行，列表页可能在
      //    数据还没写入时就渲染完，回到列表看不到刚建的这条。
      onSuccess: () => {
        // 顺手让列表缓存失效，避免回列表后短暂显示旧数据。
        void queryClient.invalidateQueries({
          queryKey: trpc.storages.listStorages.queryOptions().queryKey,
        });
        router.push(`/dashboard/apps/${appId}/settings/storage`);
      },
    })
  );

  const fieldError = (name: keyof StorageFormValues) =>
    errors[name]?.message as string | undefined;

  const onSubmit: SubmitHandler<StorageFormValues> = (data) => {
    if (!appId) return;
    createStorage.mutate(data);
  };

  if (!appId) {
    return (
      <div className="container mx-auto px-4 pt-10 text-sm text-muted-foreground">
        缺少应用 id
      </div>
    );
  }

  return (
    // ⚠️ container 必须配 mx-auto：Tailwind v4 的 container 只有
    //    width:100% + 各断点 max-width，【没有 margin-inline:auto】，
    //    只写 container 会贴着窗口左边缘（跟列表页 / 其它页面不一致）。
    <div className="container mx-auto px-4 pt-10">
      <h1 className="text-3xl mb-6 max-w-md mx-auto">Create Storage</h1>
      <form
        className="flex flex-col gap-4 space-y-3 max-w-md mx-auto"
        onSubmit={handleSubmit(onSubmit)}
      >
        <Field label="Name" error={fieldError("name")}>
          <Input
            {...register("name", {
              required: "Name is required",
              maxLength: { value: 100, message: "名称最长 100 字符" },
            })}
          />
        </Field>

        <Field label="Bucket" error={fieldError("bucket")}>
          <Input
            {...register("bucket", {
              required: "Bucket is required",
              maxLength: { value: 100, message: "Bucket 最长 100 字符" },
            })}
          />
        </Field>

        <Field label="AccessKeyId" error={fieldError("accessKeyId")}>
          <Input
            {...register("accessKeyId", { required: "AccessKeyId is required" })}
          />
        </Field>

        <Field label="SecretAccessKey" error={fieldError("secretAccessKey")}>
          {/* type=password：密钥不该明文显示在屏幕上，也不该进浏览器的表单记忆 */}
          <Input
            type="password"
            {...register("secretAccessKey", {
              required: "SecretAccessKey is required",
            })}
          />
        </Field>

        <Field label="Region" error={fieldError("region")}>
          <Input {...register("region", { required: "Region is required" })} />
        </Field>

        <Field label="ApiEndpoint" error={fieldError("apiEndpoint")}>
          {/* 选填：files.ts 里 endpoint / region 有全局兜底默认值 */}
          <Input {...register("apiEndpoint")} />
        </Field>

        {/* ⚠️ 提交中必须禁用：连点会创建出多条重复记录 */}
        <Button type="submit" disabled={createStorage.isPending}>
          {createStorage.isPending ? "提交中…" : "Submit"}
        </Button>

        {/* ⚠️ 服务端校验（重名 / 字段不合法）必须显示出来，否则点了没反应 */}
        {createStorage.isError && (
          <p className="text-xs text-destructive">
            创建失败：{createStorage.error.message}
          </p>
        )}
      </form>
    </div>
  );
}
