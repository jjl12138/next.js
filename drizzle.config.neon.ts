import { defineConfig } from "drizzle-kit";

/**
 * Neon 远程库的 drizzle-kit 配置。
 * 用法：pnpm exec drizzle-kit push --config=drizzle.config.neon.ts
 *
 * ⚠️ 两处修复（原文件编译不过 + 密钥裸奔）：
 *   1. postgresql 方言的凭证联合类型里【没有 connectionString 这个键】
 *      （TS2345：Object literal may only specify known properties...），
 *      这个版本的 drizzle-kit（0.31.11）认的是 `url`（远程串）或
 *      host/port/user/password/database（分字段形式，见 drizzle.config.ts）。
 *   2. 连接串硬编码在源码里 —— 密码已经进过终端日志/对话，等价于泄露。
 *      改为从 .env 的 NEON_DB_URL 读（drizzle-kit 内置 dotenv，会自动加载
 *      项目根目录的 .env，不用手动 require）。既然串已经外泄过，
 *      建议去 Neon 控制台 reset 一次密码。
 */
export default defineConfig({
  out: "./drizzle",
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",

  dbCredentials: {
    url: process.env.NEON_DB_URL!,
  },

  breakpoints: true,
  verbose: true,
});
