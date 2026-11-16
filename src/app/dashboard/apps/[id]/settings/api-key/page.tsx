"use client";

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Copy, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { useTRPC } from "@/utils/api";
import { useAppId } from "@/utils/useAppId";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/Accordion";
import copy from "copy-to-clipboard";

export default function ApiKeysPage() {
  // ⚠️ 必须有 "use client"：useQuery 是 hook，写在 Server Component 里会直接报
  //    "Hooks are not supported in Server Components"。

  // ⚠️ 走 useAppId()，不要自己 useParams()/解构 props.params：
  //    Next 16 的 params 是 Promise，{params: {id}} 拿到的是 Promise 本身，
  //    id 恒为 undefined；而路由校验类型是 ComponentType<{params: Promise<...>} & any>，
  //    那个 & any 让 tsc 完全兜不住，编译期一声不吭、运行时才炸。
  const appId = useAppId();

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // ⚠️ listApiKeys 的 input 是 z.uuid()，传 undefined 会稳定拿回 400
  //    "expected string, received undefined" → 页面直接显示「加载失败」。
  //    拿不到合法 id 时用 skipToken 让查询保持 disabled，而不是挂一个假错误。
  //    skipToken 必须放在 queryOptions 的【input 位置】，直接当 useQuery 的参数会 TS2769。
  const apiKeysQuery = useQuery(
    trpc.apiKeys.listApiKeys.queryOptions(appId ? { appId } : skipToken)
  );

  // —— Popover 内联创建 ——
  // ⚠️ 之前这段是半改造状态：Button 既挂 PopoverTrigger(asChild)，又写
  //    onClick={() => router.push(".../new")} —— 点一下既弹层又跳走，
  //    Popover 根本来不及用。现在创建完全在本页完成，useRouter 已删除。
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // 列表里逐行复制 clientId 的反馈状态：存「刚复制完的那行 id」，
  // 2 秒后自动复位。不用 navigator.clipboard —— 那个在非安全上下文
  // （http:// 局域网 IP 打开）下直接 reject，copy-to-clipboard 内部做了降级。
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const handleCopyClientId = (apiKeyId: number, clientId: string) => {
    // copy() 同步返回 boolean：false 表示降级路径也失败了
    if (!copy(clientId)) return;
    setCopiedId(apiKeyId);
    window.setTimeout(() => {
      // 只清掉自己这次的状态，避免连续复制时把新状态也复位掉
      setCopiedId((cur) => (cur === apiKeyId ? null : cur));
    }, 2000);
  };

  // ⚠️ 后端是 z.string().trim().min(3).max(100)。前端不 trim 就校验的话，
  //    "  a  " 会被前端放过、后端 trim 后只剩 1 个字符 → 400 且没有任何提示。
  const trimmed = name.trim();
  const nameValid = trimmed.length >= 3 && trimmed.length <= 100;

  // ⚠️ 项目用的是 @trpc/tanstack-react-query 的 options proxy，
  //    没有 `trpc.xxx.yyy.useMutation()` 这种 API（那是旧版 createTRPCReact 的）。
  //    统一写法是 useMutation(trpc.xxx.mutationOptions({...}))，
  //    参照 settings/storage/page.tsx。
  const createApiKey = useMutation(
    trpc.apiKeys.createApiKey.mutationOptions({
      onSuccess: (data) => {
        // ⚠️ data.key 是明文密钥，而且是【唯一一次】能拿到完整值的机会：
        //    listApiKeys 只回 id / name / createdAt，之后再也查不到 key。
        //    原来把 data 直接塞进列表缓存就完事 —— 列表又只渲染 name，
        //    结果密钥创建了却拿不到值，等于白建，只能删掉重建。
        //    必须先留在本页展示给用户。
        setCreated({ name: data.name, key: data.key });
        setName("");
        setCopied(false);
        setCopyFailed(false);
        setOpen(false);

        // 让列表刷新出刚建的那条。key 必须和上面 useQuery 用同一个表达式。
        // ⚠️ 原来写 utils.apiKeys.listApiKeys.setData(...) —— utils 根本没定义，
        //    而且 setData 的 updater 里还塞了 setName("") 这种副作用
        //    （StrictMode 下 updater 可能执行两次，缓存为 undefined 时又根本不执行）。
        if (appId) {
          void queryClient.invalidateQueries({
            queryKey: trpc.apiKeys.listApiKeys.queryOptions({ appId }).queryKey,
          });
        }
      },
    })
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    // 三重保护：没有合法 appId / 名称不合法 / 上一次请求还在飞，都不发。
    if (!appId || !nameValid || createApiKey.isPending) return;
    createApiKey.mutate({ name: trimmed, appId });
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // 非安全上下文或浏览器拒绝授权：不静默失败，提示手动选中复制
      setCopyFailed(true);
    }
  };

  // ⚠️ 页面根节点用 flex-1，别用 container，也别只写 mx-auto（含下面三个提前 return）：
  //   · settings/layout.tsx 外层已经是 `container mx-auto flex`，页面是它的 flex item，
  //     再套一层 container 就是嵌套容器（无意义，px 还会叠两层）；
  //   · 只写 `mx-auto` 更糟：flex item 宽度 auto → 收缩到内容宽，auto margin 又把它
  //     推到中间，整页变成一条居中的窄条，右上角的 + 跟着缩到中间，
  //     和 storage 页（撑满剩余宽度、+ 贴右边缘）完全对不上；
  //   · flex-1 才是「占满侧栏以外的剩余宽度」，两页必须一致。
  if (!appId) {
    return (
      <div className="flex-1 px-4 pt-10 text-sm text-muted-foreground">
        缺少应用 id
      </div>
    );
  }

  // skipToken 下 isPending 恒为 true，但上面 !appId 已经提前返回了，
  // 走到这里一定是 enabled 的正常查询。
  if (apiKeysQuery.isPending) {
    return (
      <div className="flex-1 px-4 pt-10 text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (apiKeysQuery.isError) {
    return (
      <div className="flex-1 px-4 pt-10 text-sm text-destructive">
        加载失败：{apiKeysQuery.error.message}
      </div>
    );
  }

  const apiKeys = apiKeysQuery.data;

  return (
    <div className="flex-1 space-y-2 px-4 pt-10">
      {/* ⚠️ h1 上不能留 mb-6：外层是 items-center，标题自带下边距会把
          这一行撑高、标题视觉中心上移，右侧按钮（无外边距）就跟着偏下，
          看起来「按钮掉下去一截」。行间距交给外层的 space-y-2。 */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">API Keys</h1>

        {/* 受控 open：创建成功后要主动关掉弹层，否则它会压住下面的明文密钥卡片 */}
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setName("");
              // 清掉上一次的服务端错误，下次打开别还显示着旧报错
              createApiKey.reset();
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button aria-label="新建密钥">
              <Plus />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end">
            <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
              <Input
                autoFocus
                aria-label="密钥名称"
                placeholder="名称（3–100 字符）"
                maxLength={100}
                // 受控：提交后清空 state 时输入框也要跟着清空
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                type="submit"
                // 提交中必须禁用：连点会创建出多条重复密钥
                disabled={!nameValid || createApiKey.isPending}
              >
                {createApiKey.isPending ? "创建中…" : "创建"}
              </Button>
              {createApiKey.isError && (
                <p className="text-xs text-destructive">
                  创建失败：{createApiKey.error.message}
                </p>
              )}
            </form>
          </PopoverContent>
        </Popover>
      </div>

      {/* 一次性明文密钥。用 amber 而不是 destructive：这不是错误，是「请立刻保存」 */}
      {created && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            密钥 <strong>{created.name}</strong> 已创建。下面的值
            <span className="font-semibold">只显示这一次</span>
            ，关闭或刷新后无法再查到，请立刻复制保存。
          </p>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border bg-background p-2 font-mono text-xs select-all">
              {created.key}
            </code>
            <Button
              variant="outline"
              className="shrink-0"
              aria-label="复制密钥"
              onClick={handleCopy}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
          {copyFailed && (
            <p className="text-xs text-destructive">
              复制失败（可能是浏览器限制了剪贴板权限），请手动选中上面的密钥复制。
            </p>
          )}
          <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
            我已保存，关闭
          </Button>
        </div>
      )}

      {apiKeys.length === 0 ? (
        // 空态：一个密钥都没有时页面一片空白，看起来像接口挂了
        <div className="text-sm text-muted-foreground">
          还没有 API 密钥，点右上角 + 新建一个
        </div>
      ) : (
        // ⚠️ 三处都是 Radix 的硬约束：
        //   1. Accordion 必须给 type（"single" | "multiple"），不传 TS2322；
        //      collapsible 让展开的项可以再点收起。
        //   2. AccordionItem 的 value 是 string，apiKey.id 是 number → String()。
        //   3. 空态放 Accordion 外面：Accordion 的 children 必须是 Item，
        //      塞普通 div 会破坏它的 ARIA 结构。
        <Accordion type="single" collapsible className="space-y-2">
          {apiKeys.map((apiKey) => (
            <AccordionItem key={apiKey.id} value={String(apiKey.id)}>
              <AccordionTrigger>{apiKey.name}</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1.5 text-sm mb-4">
                  <div className="flex justify-between items-center">
                    <span>clientId</span>
                    {/* code 和按钮包在同一个右侧容器里：三个直接子元素
                        会被 justify-between 摊成三栏，clientId 反而被挤到中间 */}
                    <span className="flex items-center gap-1">
                      <code className="font-mono text-xs">
                        {apiKey.clientId}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`复制 clientId（${apiKey.name}）`}
                        onClick={() => handleCopyClientId(apiKey.id, apiKey.clientId)}
                      >
                        {copiedId === apiKey.id ? (
                          <Check className="text-emerald-600" />
                        ) : (
                          <Copy />
                        )}
                      </Button>
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>创建时间</span>
                    <span>
                      {apiKey.createdAt
                        ? new Date(apiKey.createdAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span>key</span>
                    <span className="text-xs">
                      只在创建时显示一次，不在此回显
                    </span>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
