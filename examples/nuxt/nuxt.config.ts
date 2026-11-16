// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: {
    host: '0.0.0.0',
    port: 3456,
  },

  // ⚠️ 凭据只能走 runtimeConfig，不能写进源码。
  //    这些 key 没有放到 `public` 下面，所以【只在服务端可见】，
  //    不会被打进客户端 bundle —— 放 public 里等于把 api-key 发给每个访客。
  //
  //    覆盖方式（二选一，环境变量优先级更高）：
  //      · .env 文件：NUXT_IMAGE_SAAS_BASE_URL / NUXT_IMAGE_SAAS_API_KEY / NUXT_IMAGE_SAAS_DEFAULT_APP_ID
  //      · 部署平台的 env（生产环境必须用这个，.env 不进 git）
  runtimeConfig: {
    imageSaas: {
      // image-saas（Next.js）服务地址，末尾不要带 /api
      baseUrl: 'http://localhost:3000',
      // 在 image-saas 的「设置 → API Key」里创建
      apiKey: '',
      // 示例页默认用的应用 id，配了就不用手填
      defaultAppId: '',
    },
  },
})
