import { redirect } from "next/navigation";

// Next 16 cacheComponents 开启后，dev 阶段会对 "/" 做预渲染校验：
// 预渲染执行到 redirect() 时抛 NEXT_REDIRECT，校验层把它当成
// "Could not validate `instant`" 的噪音刷屏（实际 307 是成功的）。
// 该开关只关掉 dev 校验，不影响生产行为；unstable 前缀版本升级若失效删掉即可。
export const instant = { unstable_disableDevValidation: true } as const;

export default function Home() {
  return redirect('/dashboard');
}
