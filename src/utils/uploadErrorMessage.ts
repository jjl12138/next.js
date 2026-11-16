import { TRPCClientError } from "@trpc/client";

// 把 Uppy / tRPC 抛出来的原始错误翻成「用户能照着排查」的话。
//
// 为什么需要这一层：@uppy/aws-s3 在 XHR 拿不到任何响应时（status === 0）
// 只会抛一句 `Network error during S3 request`。这句话既不说是哪个域名、
// 也不说是 CORS 还是配置错，用户唯一的反应就是「网络问题？我网没断啊」。
// 实际上最常见的原因是存储配置里的 bucket 名不合法（腾讯云 COS 必须是
// `<名字>-<APPID>`，写成 `seeds` 会让预检直接 400），或者桶的 CORS 没放行
// 当前页面域名 —— 两者都和「网络」无关。
//
// 返回的文案刻意带上【下一步该看哪里】，报错条只有一行，说清原因比复述
// 原始英文更重要。原始错误仍然 append 在末尾，方便贴给后端排查。
const RULES: Array<{ test: RegExp; hint: string }> = [
  {
    test: /network error during s3 request/i,
    hint:
      "浏览器没拿到存储服务的响应。按这个顺序查：① 应用绑定的存储里 bucket 是否写全（COS 必须是「名称-APPID」，例如 test-image-1420857858）；② 桶的跨域 CORS 是否放行了当前页面地址；③ 是否开着代理/VPN 拦了存储域名。",
  },
  {
    test: /preflight|access-control-allow-origin|cors/i,
    hint: "跨域预检被存储服务拒绝：到云控制台的桶设置里把当前页面地址加进 CORS 的 AllowedOrigins。",
  },
  {
    test: /not bound|未绑定存储/i,
    hint: "这个应用还没绑定存储配置，先去「设置 - 存储」绑定一个再传。",
  },
  {
    test: /未配置|missing required|credential/i,
    hint: "存储配置里的密钥不完整或不可用，去「设置 - 存储」重新填一份。",
  },
  {
    test: /nosuchbucket|invalidbucketname|appid/i,
    hint: "存储里填的 bucket 不存在或格式不对（COS 格式是「名称-APPID」），检查一下有没有拼错。",
  },
  {
    test: /failed to fetch|load failed/i,
    hint: "请求在中途被中断，检查网络或代理，然后重试。",
  },
];

export function explainUploadError(err: {
  name?: string;
  message?: string;
  details?: string;
}): string {
  const raw = err?.message || err?.details || err?.name || "未知错误";

  // tRPC 的 zod 校验错误，message 里是 JSON 数组，直接显示会变成一坨。
  // 这里挑出第一条 issue 的 message，那才是人写的那句话。
  if (err instanceof TRPCClientError) {
    const issues = (err.data as { zodError?: { issues: Array<{ message: string }> } })
      ?.zodError?.issues;
    if (issues?.length) {
      return issues.map((i) => i.message).join("；");
    }
  }

  const hit = RULES.find((r) => r.test.test(raw));
  // 命中了就给「人话 + 原始信息」；没命中就原样返回，别硬编一句误导人的话。
  return hit ? `${hit.hint}\n（原始错误：${raw}）` : raw;
}
