// 对外开放 API（/api/open）的「类型面」。
//
// 这个文件是给外部消费者（比如 packages/api 里的 SDK）用的稳定入口：
// 他们不该直接 import "@/server/open-router" —— 那是服务端内部实现，
// 里面挂着 db、next-auth、drizzle 一堆只该在服务端存在的东西。
//
// ⚠️ 只导出 type，不要在这里写任何运行时代码（export const / function）：
//    它要被 `tsup --dts-only` 编译成独立的 .d.ts，一旦掺进值，
//    产物的 import 图就会把 @trpc/client、@trpc/server 的实现也拖进来。
//
// ⚠️ 这个文件曾被建成 0 字节空文件，于是 `tsup --dts-only` 报：
//    RollupError: "OpenRouter" is not exported by "src/utils/open-api.ts"
//    —— 空文件在 TS 里是合法模块（不报错），但没有任何导出，下游一 re-export 就炸。
export type { OpenRouter } from "../server/open-router";
