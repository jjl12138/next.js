// image-saas 开放 API 的调用封装。
//
// 为什么需要这一层：开放接口是 tRPC 的 batch 形态
//   POST /api/open/<router>.<procedure>?batch=1
//   Header: api-key
//   Body:   { "0": <input> }
//   Resp:   [{ "result": { "data": ... } }] 或 [{ "error": { "json": { ... } } }]
// 直接在每个路由里手写 fetch 的话，三件事一定会漏：超时、错误码映射、batch 数组解包。
//
// ⚠️ 这里【不接收 H3Event】，只接收配置对象：
//    event 的类型 H3Event 不是全局类型（nitro 只全局导出了 EventHandler），
//    在 helper 里写上 `event: H3Event` 就得 import from 'h3'，
//    而 h3 是 nuxt 的传递依赖，pnpm 的隔离 node_modules 下解析不到 →
//    TS2307，跑起来没事、类型检查一直红。

export interface ImageSaasConfig {
  baseUrl: string
  apiKey: string
  defaultAppId: string
}

export interface PresignResult {
  url: string
  method: 'PUT'
}

export interface SavedFile {
  id: string
  name: string
  path: string
  url: string
  type: string
  appId: string | null
}

interface BatchSuccess<T> {
  result: { data: T }
}

// ⚠️ tRPC v11 的 fetch adapter 返回的错误体有两种形状，必须都兼容：
//    · 直接形态（/api/open 实测）：{ error: { message, code, data: { code, httpStatus, ... } } }
//    · 嵌套形态（部分 link / transformer 下）：{ error: { json: { message, data } } }
//    只读 json.* 的话，直接形态会解析出 undefined → 所有错误都被兜成 502，
//    实测表现为「查一个不存在的 appId，返回 502 而不是 404」，很容易误判成服务挂了。
interface TrpcErrorPayload {
  message?: string
  code?: number
  data?: { code?: string, httpStatus?: number }
}

interface BatchFailure {
  error: TrpcErrorPayload & {
    json?: TrpcErrorPayload
  }
}

// tRPC 的错误码 → HTTP 状态码。
// 不映射的话全部变成 200（batch 响应的 HTTP 状态主要是 200/207），
// 前端 setStatus 判断会全部失效。
const STATUS_BY_CODE: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
}

// ⚠️ statusMessage 会【原样写进 HTTP 状态行】（HTTP/1.1 404 Not Found 的 "Not Found" 那一段），
//    而状态行只允许 ASCII。把中文塞进 statusMessage，Node 写响应头时要么抛
//    ERR_INVALID_CHAR、要么把非 ASCII 字符抹掉，实测表现是响应头后面直接断连
//    （curl 报 "Connection: close"、body 为空），前端完全拿不到错误信息。
//    所以：statusMessage 固定用英文短语，可读的中文放进 message。
const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
}

function fail(message: string, statusCode: number, data?: Record<string, unknown>): never {
  throw createError({
    statusCode,
    statusMessage: STATUS_TEXT[statusCode] ?? 'Error',
    message,
    data,
  })
}

/** 从 URL 里剥掉 query —— 签名参数不能存库、也不该回传给客户端。 */
export function stripQuery(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  }
  catch {
    return url
  }
}

interface BatchResponse {
  status: number
  payload: unknown
}

/**
 * 发一次 tRPC batch 请求，只负责「拿到 HTTP 响应」这件事：
 * 网络失败在这里转成 502，业务错误留给调用方解析。
 */
async function requestBatch(
  target: string,
  apiKey: string,
  input: unknown,
  path: string,
): Promise<BatchResponse> {
  try {
    const response = await $fetch.raw(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      // batch 请求体：key 是 batch 内的调用序号，单条就是 "0"
      body: { 0: input },
      // 15s：不设超时的话，image-saas 卡住时这个路由会一直挂着，
      // 前端只能看到一个转不完的圈，日志里什么也没有。
      signal: AbortSignal.timeout(15_000),
      // 4xx/5xx 不抛异常，交给 callOpenApi 统一解析 tRPC 错误体。
      // 否则业务错误（比如 appId 不存在）会被 ofetch 包成一层
      // "500 <html>..." 的 FetchError，真实原因彻底丢失。
      ignoreResponseError: true,
      retry: 0,
    })

    // $fetch 会按 content-type 解析：JSON 已是对象，HTML 是字符串。
    // 上游返回 HTML（404 页 / 报错页）时，若直接 JSON.parse 就又是一层看不懂的错误。
    return { status: response.status, payload: (response as { _data?: unknown })._data }
  }
  catch (error) {
    // 走到这里只有网络层问题：image-saas 没启动、端口不对、DNS 失败、超时。
    const cause = error instanceof Error ? error.message : String(error)
    return fail(`无法连接 image-saas：${cause}`, 502, {
      target,
      path,
      hint: '确认 image-saas 的 dev server 已在 3000 端口启动',
    })
  }
}

export async function callOpenApi<T>(
  config: ImageSaasConfig,
  path: string,
  input: unknown,
): Promise<T> {
  // 缺 key 时必须【明确报出来】。原实现把 key 硬编码在源码里，一旦仓库公开
  // 或截图外泄就等于把整套上传权限交出去；改成配置后又容易忘配，
  // 所以这里直接给一条能照着做的错误信息。
  if (!config.apiKey) {
    fail(
      '缺少 API Key：请在 .env 里配置 NUXT_IMAGE_SAAS_API_KEY',
      500,
      { hint: '在 image-saas 的「设置 → API Key」创建后填入 .env' },
    )
  }

  const base = config.baseUrl.replace(/\/+$/, '')
  const target = `${base}/api/open/${path}?batch=1`

  // 网络层与业务层必须分开处理（见下面的 catch）：
  // 原来的 `return fetch(url, ...)` 把两者糊在一起，image-saas 一停，
  // 这个路由就抛 TypeError: fetch failed → 500，报错里既没有目标地址也没有原因。
  const { status, payload } = await requestBatch(target, config.apiKey, input, path)
  const first = (Array.isArray(payload) ? payload[0] : payload) as
    | BatchSuccess<T>
    | BatchFailure
    | undefined

  if (!first || typeof first !== 'object') {
    fail(
      `image-saas 返回了非 JSON 响应（HTTP ${status}）`,
      502,
      { target, body: typeof payload === 'string' ? payload.slice(0, 500) : payload },
    )
  }

  if ('error' in first && first.error) {
    // 两种形态取其一：优先直接形态，没有再退回 json 包装
    const body: TrpcErrorPayload = (first.error.data || first.error.message)
      ? first.error
      : (first.error.json ?? first.error)
    const httpStatus = body.data?.httpStatus
      ?? STATUS_BY_CODE[body.data?.code ?? '']
      ?? 502
    fail(body.message || 'image-saas 返回未知错误', httpStatus, {
      code: body.data?.code,
      target,
      path,
    })
  }

  if (!('result' in first) || !first.result) {
    fail('image-saas 响应格式不符合 tRPC batch 约定', 502, { target, payload })
  }

  return first.result.data
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function assertAppId(appId: string): string {
  const value = appId.trim()
  if (!value) {
    fail('缺少 appId：请填写 image-saas 里的应用 id', 400)
  }
  // 提前拦一道：不合法的话会一路发到 PG，报的是
  // invalid input syntax for type uuid，看不出是参数问题。
  if (!UUID_RE.test(value)) {
    fail('appId 不是合法的 uuid', 400, { appId: value })
  }
  return value
}

/**
 * 生成对象键，规则跟 image-saas 后台一致：`<yyyy-mm-dd>/<uuid>-<文件名>`。
 *
 * ⚠️ uuid 后缀不能省：只用 日期/文件名 的话，同一天传两个同名文件
 *    （两次截图都叫 image.png）会算出同一个 key → COS 上后者覆盖前者，
 *    而数据库里留下两条记录指向同一个对象，前一张图无声消失。
 */
export function generateObjectKey(filename: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const unique = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  // 空格换成下划线：不是必须，但 COS 控制台里更好认。
  // / 也要挡掉，否则文件名里的斜杠会凭空多出一层「目录」。
  const safeName = (filename || 'unnamed')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 100)
  return `${date}/${unique}-${safeName}`
}
