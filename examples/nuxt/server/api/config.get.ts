// 配置探测接口：GET /api/config
//
// 只回答「这个示例项目到底读到了什么配置」，不做任何上游调用。
//
// ⚠️ 单独一个接口而不是塞进 /api/test，是因为两者语义完全不同：
//    · /api/config 只读本地 runtimeConfig，永远 200，用来在页头显示状态；
//    · /api/test 会真的拿 api-key 去 image-saas 换签名，上游挂了它就是 502。
//    原来页面用 /api/test 的结果判断「key 配没配」—— 一旦那个接口改成只返回
//    签名结果，`apiKeyConfigured` 就变成 undefined，页面立刻显示「未配置」，
//    而实际上 .env 里配得好好的。判断配置状态不该依赖一个会失败的接口。
//
// ⚠️ 这里只回 apiKeyConfigured 布尔值，绝不回 apiKey 本身。
//    这个路由是浏览器可访问的（同源 GET），回明文等于把密钥发给每个访客。
//    runtimeConfig.imageSaas 没有放在 public 下，也只能挡住 SSR 注入这一层，
//    挡不住「我自己写个接口把它 return 出去」—— 所以这里必须显式转成布尔。
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event).imageSaas

  return {
    baseUrl: config.baseUrl || '',
    apiKeyConfigured: Boolean(config.apiKey && config.apiKey.trim()),
    appId: config.defaultAppId || '',
    // 页面直接展示这句话，省得用户去翻 README 找「要在哪个目录建 .env」。
    message: config.apiKey
      ? undefined
      : '未读到 api-key：请在 examples/nuxt/.env 里设置 NUXT_IMAGE_SAAS_API_KEY，改完重启 dev server',
  }
})
