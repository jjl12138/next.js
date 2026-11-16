// 签发上传 URL：POST /api/presign
//
// 这是「真正拿去做业务」的接口（/api/test 只是冒烟检查）。
// 一次调用只负责签名，不碰文件内容 —— 文件本身由浏览器直接 PUT 到 COS，
// 不经过这台 Nuxt 服务器，所以大文件也不会把 Node 内存吃满、也不会占带宽。
//
// 请求体：
//   {
//     "appId":       "<uuid>",          // 必填，image-saas 里的应用 id
//     "filename":    "logo.png",        // 可选，用来生成对象键 & 推断 content-type
//     "contentType": "image/png",       // 可选，浏览器给的 file.type 优先
//     "key":         "2026-11-03/x.png" // 可选，完全自定义对象键（传了就覆盖 filename）
//   }
// 响应：
//   { "url": "https://<bucket>.cos...&X-Amz-Signature=...", "method": "PUT",
//     "key": "...", "appId": "...", "contentType": "image/png" }
//
// ⚠️ url 里的签名 90 秒后就失效：拿到立刻 PUT，不要缓存。
import { callOpenApi, generateObjectKey } from '../utils/image-saas'
import type { PresignResult } from '../utils/image-saas'

// image-saas 侧的 contentTypeSchema 要求 type/subtype 形状，
// 浏览器给的 file.type 可能是空串（比如 .md / 无扩展名文件），
// 空串直接发过去会被 400 拒掉，这里兜一个通用二进制类型。
const CONTENT_TYPE_RE = /^[a-z]+\/[a-z0-9.+-]+$/i

interface PresignBody {
  appId?: string
  filename?: string
  contentType?: string
  key?: string
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event).imageSaas
  // ⚠️ 必须兜 null：请求体为空时 readBody 返回 undefined（不是抛错），
  //    接着 body.key 就会 TypeError → 500，看起来像服务端坏了，
  //    其实只是客户端少传了 body。
  const body: PresignBody = (await readBody<PresignBody>(event).catch(() => null)) ?? {}

  const filename = (body.filename ?? '').trim()

  // 自定义 key 优先；否则按 image-saas 后台同一套规则生成。
  // 两者的合法性（不能以 / 开头、不能有 ..、不能有控制字符）都由上游再校验一次，
  // 这里不重复实现规则，避免两边哪天不一致。
  const key = body.key?.trim() || generateObjectKey(filename)

  const contentType = CONTENT_TYPE_RE.test(body.contentType ?? '')
    ? body.contentType!
    : guessContentType(filename)

  // ⚠️ 不传 appId：image-saas 侧用 api-key 反查出 app（ctx.app.id），
  //    客户端伪造别人的 appId 从接口层面就不可能。
  const result = await callOpenApi<PresignResult>(config, 'file.createPresignedUrl', {
    key,
    contentType,
  })

  return {
    url: result.url,
    // 后端返回什么 method 就用什么，别在前端写死 PUT
    method: result.method,
    key,
    contentType,
    expiresInSeconds: 90,
  }
})

/** 只认常见的几类：猜错 content-type 不会报错，但浏览器预览会出问题。 */
function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    txt: 'text/plain',
    json: 'application/json',
    md: 'text/markdown',
  }
  return map[ext] ?? 'application/octet-stream'
}
