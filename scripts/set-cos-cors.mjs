// 给 COS 桶追加 CORS 允许的 Origin。
//
// 为什么需要它：浏览器直传 COS 前会先发一个 OPTIONS 预检，Origin 不在白名单里
// 就返回 403 AccessForbidden，浏览器只会抛一句 "Load failed"（Safari）或
// "Failed to fetch"（Chrome）—— 看不到任何 CORS 字样，非常容易误判成接口挂了。
// 换端口（3000 → 3456）、换域名、换局域网 IP 访问，都要来这里补一次。
//
// 用法：
//   node scripts/set-cos-cors.mjs                       # 只看当前规则
//   node scripts/set-cos-cors.mjs --add-origin=http://localhost:3456
//   node scripts/set-cos-cors.mjs --add-origin=http://localhost:3456,http://127.0.0.1:3456
//
// 凭据读根目录 .env 的 COS_APP_ID / COS_APP_SECRET / COS_BUCKET / COS_ENDPOINT。
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// @aws-sdk/client-s3 装在工作区里，用 createRequire 从项目根解析，
// 这样脚本不依赖自己所在目录有没有 node_modules。
const require = createRequire(`${ROOT}/package.json`);
const { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } = require("@aws-sdk/client-s3");

const env = {};
for (const line of readFileSync(`${ROOT}/.env`, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !env[m[1]]) env[m[1]] = m[2].trim();
}

if (!env.COS_BUCKET || !env.COS_APP_ID || !env.COS_APP_SECRET) {
  console.error("根目录 .env 缺少 COS_BUCKET / COS_APP_ID / COS_APP_SECRET");
  process.exit(1);
}

const client = new S3Client({
  endpoint: env.COS_ENDPOINT || "https://cos.ap-guangzhou.myqcloud.com",
  region: env.COS_REGION || "ap-guangzhou",
  credentials: { accessKeyId: env.COS_APP_ID, secretAccessKey: env.COS_APP_SECRET },
});

// ⚠️ 腾讯云 COS 对 PutBucketCors 强制要求 Content-MD5，缺了直接 400 InvalidRequest，
//    而错误文案里根本不提这件事 —— 只说 InvalidRequest，查半天。
//    AWS SDK v3 默认走 flexible checksums（CRC32），COS 不认这一套。
client.middlewareStack.add(
  (next) => async (args) => {
    const body = args.request?.body;
    const buf = typeof body === "string"
      ? Buffer.from(body, "utf8")
      : body instanceof Uint8Array ? Buffer.from(body) : null;
    if (buf && args.request?.headers && !args.request.headers["content-md5"]) {
      args.request.headers["content-md5"] = crypto.createHash("md5").update(buf).digest("base64");
    }
    return next(args);
  },
  { step: "build", name: "contentMd5", priority: "low", tags: ["contentMd5"] }
);

const write = process.argv.includes("--write");
const originArg = process.argv.find((a) => a.startsWith("--add-origin="))?.split("=")[1];
// 默认只读，必须显式 --write —— 改线上桶的配置不该是个"手滑就跑"的默认行为。
const originsToAdd = (originArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const current = await client.send(new GetBucketCorsCommand({ Bucket: env.COS_BUCKET }));
const rules = current.CORSRules ?? [];

console.log(`bucket = ${env.COS_BUCKET}`);
console.log(JSON.stringify(rules, null, 2));

if (!write) {
  console.log("\n（只读模式。加 Origin 请带 --write --add-origin=<url>）");
  process.exit(0);
}
if (!originsToAdd.length) {
  console.error("缺少 --add-origin=");
  process.exit(1);
}

// 补到「已有 PUT 规则」上，而不是新建一条：
// COS 对同一 method 的多条规则不做可靠并集，很容易出现新规则盖掉旧规则、
// 结果本地好了线上又坏的情况。
let touched = false;
const next = rules.map((rule) => {
  const methods = rule.AllowedMethods ?? [];
  if (!methods.includes("PUT")) return rule;
  const origins = rule.AllowedOrigins ?? [];
  const missing = originsToAdd.filter((o) => !origins.includes(o));
  if (!missing.length) return rule;
  touched = true;
  console.log("补到 PUT 规则上:", missing.join(", "));
  return { ...rule, AllowedOrigins: [...origins, ...missing] };
});

if (!touched) {
  console.log("没有可用的 PUT 规则，新建一条");
  next.push({
    AllowedOrigins: originsToAdd,
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["content-type"],
    ExposeHeaders: ["ETag", "Content-Length", "x-cos-request-id"],
    MaxAgeSeconds: 3000,
  });
}

const res = await client.send(
  new PutBucketCorsCommand({
    Bucket: env.COS_BUCKET,
    CORSConfiguration: { CORSRules: next },
  })
);
console.log("PutBucketCors ok, status =", res.$metadata?.httpStatusCode);
