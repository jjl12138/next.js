import { Uppy } from "@uppy/core";
// AWSS3 是 default 导出（v6 没有 { AWSS3 } 具名导出）
import AWSS3 from "@uppy/aws-s3";
/**
 * 创建一个"预签名上传器"。
 *
 * @param signRequest 签名回调。⚠️ v6 的参数是待签名的请求（{method, key, contentType}），
 *                    【拿不到 UppyFile】——要控制 key 格式用 uppy 的 generateObjectKey，
 *                    要传额外信息走 Uppy 的 meta。返回预签名 URL：
 *                    { url, method?, key?, headers?, fields? }
 * @returns 配好 aws-s3 插件的 Uppy 实例（调用方负责 addFiles / upload / destroy）
 */
export function createUploader(signRequest) {
    const uppy = new Uppy();
    uppy.use(AWSS3, {
        shouldUseMultipart: false,
        signRequest,
    });
    // ⚠️ 必须 return：不返回的话调用方拿到 undefined，后续 addFiles 直接炸。
    return uppy;
}
