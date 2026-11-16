import { Uppy } from "@uppy/core";
// AWSS3 是 default 导出（v6 没有 { AWSS3 } 具名导出）
import AWSS3 from "@uppy/aws-s3";
import type { AwsS3Options } from "@uppy/aws-s3";

// ⚠️ @uppy/aws-s3 v6 删掉了旧版 Uppy v1~v4 时代的 getUploadParameters(file) 选项。
//    v6 的签名配置是三选一：getCredentials / signRequest / companionEndpoint
//    （lib/index.js:101 会对三者全缺抛 TypeError）。
//    这里用 Extract 从 Options 联合类型里把 signRequest 的函数类型挖出来，
//    避免依赖包内未导出的子路径（@uppy/aws-s3/lib/s3-client/types.js 不在 exports 里）。
type SignRequestFn = Extract<AwsS3Options<any, any>, { signRequest: unknown }>["signRequest"];

/**
 * 创建一个"预签名上传器"。
 *
 * @param signRequest 签名回调。⚠️ v6 的参数是待签名的请求（{method, key, contentType}），
 *                    【拿不到 UppyFile】——要控制 key 格式用 uppy 的 generateObjectKey，
 *                    要传额外信息走 Uppy 的 meta。返回预签名 URL：
 *                    { url, method?, key?, headers?, fields? }
 * @returns 配好 aws-s3 插件的 Uppy 实例（调用方负责 addFiles / upload / destroy）
 */
export function createUploader(signRequest: SignRequestFn): Uppy {
  const uppy = new Uppy();

  uppy.use(AWSS3, {
    shouldUseMultipart: false,
    signRequest,
  });

  // ⚠️ 必须 return：不返回的话调用方拿到 undefined，后续 addFiles 直接炸。
  return uppy;
}
