// 落库：POST /api/files
//
// 上传成功后必须再调一次 file.saveFile，否则对象只在 COS 里，
// image-saas 的列表 / 权限 / 关联应用都查不到它 ——
// 这是 Uppy 的 upload-success 里做的事情，在服务端 SDK 里同样不能省。
//
// 请求体：
//   { "appId": "<uuid>", "url": "https://<bucket>.cos.../<key>", "name": "logo.png", "type": "image/png" }
// 响应：image-saas 落库后的文件记录
import { callOpenApi, stripQuery } from '../utils/image-saas'
import type { SavedFile } from '../utils/image-saas'

interface SaveFileBody {
  appId?: string
  url?: string
  name?: string
  type?: string
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event).imageSaas
  // 空 body 时 readBody 返回 undefined 而不是报错，必须自己兜住
  const body: SaveFileBody = (await readBody<SaveFileBody>(event).catch(() => null)) ?? {}

  if (!body.url) {
    // statusMessage 必须是 ASCII（会被写进 HTTP 状态行），中文放在 message
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '缺少 url（PUT 用的那个对象地址）',
    })
  }

  // ⚠️ 必须剥掉 query：presign 返回的 URL 里带着 X-Amz-Signature，
  //    那是 90 秒就失效的临时凭据。原样存进数据库的话，
  //    过一会儿列表里点开的全是 403；而且签名参数也不该落盘。
  //    （image-saas 侧也会再剥一次，两边都做是为了不依赖对方实现。）
  const publicUrl = stripQuery(body.url)

  // name 在库里是 varchar(100)，超长会一路穿到 PG 报 500，
  // 在这里按同一个长度截断，报错点留在能看懂的地方。
  const name = (body.name?.trim() || publicUrl.split('/').pop() || 'untitled').slice(0, 100)

  // ⚠️ 不传 appId：image-saas 侧用 api-key 反查出 app（ctx.app.id），
  //    客户端伪造别人的 appId 从接口层面就不可能。
  const saved = await callOpenApi<SavedFile>(config, 'file.saveFile', {
    name,
    path: publicUrl,
    // 空 type 会被上游的 contentTypeSchema 拒掉
    type: body.type?.trim() || 'application/octet-stream',
  })

  return saved
})
