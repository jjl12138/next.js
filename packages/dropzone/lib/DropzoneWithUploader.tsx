import type { Uppy, UppyEventMap, UppyFile } from "@uppy/core";
import type { RefObject } from "preact";
import { useRef, useEffect } from "preact/hooks";
// ⚠️ 不要从 "." 导入：index.ts 现在也导出本文件，"." 自引用会形成
//   index → 本文件 → index 的循环依赖，改成直接路径更稳
import { Dropzone, type DropzoneProps } from "./Dropzone";

type DropzoneWithUploaderProps = DropzoneProps & {
  /** 已配置好 AWSS3 插件的 uppy 实例（如 @image-saas/uploader 的 createUploader 返回值） */
  uploader: Uppy;
  /**
   * 每个文件上传成功后回调；url 是带签名 query 的临时 URL。
   * ⚠️ 必须可选 + 调用处 ?.：多个 WithUploader 组件共用同一个 uppy 实例时，
   * upload-success 会在每个组件上都触发一次，没传这个 prop 的组件
   * （如页面只把回调挂给 Dropzone）调用 undefined 会直接 TypeError
   */
  onFileUploaded?: (url: string, file: UppyFile<any, any>) => void;
  /**
   * 可选：外部传入的 file input ref（供 UploadButton 场景共用）。
   * ⚠️ preact 没有 MutableRef 类型，用的就是 RefObject（{ current: T | null }）。
   * Dropzone 本身不渲染 input，需要把 UploadButton 放进 children 并给它传
   * 同一个 ref，complete 时清 value 的逻辑才真正生效；不传则是内部兜底（永远为 null，无害）。
   */
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function DropzoneWithUploader({
  uploader,
  onFileUploaded,
  inputRef: externalInputRef,
  ...dropzoneProps
}: DropzoneWithUploaderProps) {
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = externalInputRef ?? internalInputRef;

  useEffect(() => {
    // ⚠️ @uppy/core v6 没有 UploadSuccessCallback/UploadCompleteCallback 这两个类型导出，
    //   要从 UppyEventMap 里取，回调参数才有正确类型推断
    const successCallback: UppyEventMap<Record<string, unknown>, Record<string, unknown>>["upload-success"] = (
      file,
      resp,
    ) => {
      if (resp?.uploadURL && file) {
        onFileUploaded?.(resp.uploadURL, file);
      }
    };
    // 上传批次全部结束后清掉 input 的 value：
    // 否则选同一个文件第二次，浏览器不触发 change 事件
    const completeCallback: UppyEventMap<Record<string, unknown>, Record<string, unknown>>["complete"] = () => {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    };

    uploader.on("upload-success", successCallback);
    uploader.on("complete", completeCallback);

    return () => {
      // ⚠️ off 的事件名必须和 on 一字不差：
      //   之前写成 "upload-duvvess"（拼写错误）和 "completed"（应为 complete），
      //   off 什么都卸不掉 → 监听器泄漏
      uploader.off("upload-success", successCallback);
      uploader.off("complete", completeCallback);
    };
    // ⚠️ 必须带依赖数组：不写的话每次渲染都重新注册一遍监听器，
    //   叠加 cleanup 失效，监听器无限累积 → 一次上传 onFileUploaded 被调 N 次 → 落库 N 条记录
  }, [uploader, onFileUploaded, inputRef]);

  // UploadButton 的 file input 变化 → 塞给 Uppy 并开传
  function onFileChosen(files: File[]) {
    if (!uploader || !files.length) return;
    uploader.addFiles(
      files.map((file) => ({
        source: "UploadButtonWithUploader",
        name: file.name,
        type: file.type,
        data: file,
      })),
    );
    uploader.upload();
  }

  return (
    // ⚠️ 其余 props 必须展开到组件上（{...uploadButtonProps} 写在 children 里
    //   只会把整个对象当成一个子节点渲染出来，什么都显示不了）
    <Dropzone {...dropzoneProps} onFileChosen={onFileChosen}>
      {dropzoneProps.children}
    </Dropzone>
  );
}
