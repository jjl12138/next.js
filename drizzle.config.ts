import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",

//   driver: "pglite",
  dbCredentials: {
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "123123",
    database: "postgres",
    // 本地 Docker postgres 默认未开启 SSL，必须显式关闭；
    // 否则 drizzle-kit 会注入 ssl:{} 导致握手失败（错误被吞，只返回 exit 1）
    ssl: false,
  },

  breakpoints: true,
  verbose: true,
});
