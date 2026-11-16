<template>
    <div class="container">
        <!-- ⚠️ 必须用 @file-chosen（v-on），不能用 :on-file-chosen（v-bind）：
             v-bind 不做 camelize，attr key 是字面量 "on-file-chosen"，
             Preact 侧解构 onFileChosen 拿到 undefined，选文件后静默无反应 -->
        <!-- ⚠️ 事件回调必须用 @file-uploaded（v-on），不要用 :on-file-xxx（v-bind）：
             v-bind 不做 camelize，attr key 是字面量，Preact 侧解构不到。
             uploader 是普通对象 prop，用 :uploader 没问题 -->
        <!-- ⚠️ @file-uploaded 只挂在其中一个组件上（这里挂在 Dropzone）：
             两个 WithUploader 组件共用同一个 uppy 实例，都会在 uppy 上注册
             upload-success 监听 —— 两边都传的话一次上传 onFileUploaded 被调两次，
             /api/files 落库两条（DB 里成对出现的记录就是这么来的）。
             监听器在共享 uppy 上，文件不管从按钮还是拖拽上传，它都会触发 -->
        <!-- ⚠️ 样式类必须写 className 不能写 class：Preact 组件解构的是 className，
             写 class 会落到 divProps，再被后面的 className={cn(...)}（空串）覆盖，
             虚线框/按钮样式整个消失 -->
        <VueUploadButton :uploader="uppy" className="upload-button">
            Click To Choose File
        </VueUploadButton>
        <!-- ⚠️ 变量名是 uppy，不是 uploader —— 之前写 :uploader="uploader" 传的是 undefined，
             DropzoneWithUploader 的 onFileChosen 里 !uploader 直接 return，拖拽静默没反应 -->
        <!-- ⚠️ onDraggingChange 是 Dropzone 的必填 prop（useEffect 里直接调用），
             不传的话挂载即 TypeError 崩页；Vue 侧没有 UI 需要它，传个 no-op -->
        <!-- ⚠️ :style 对象里的值必须是 JS 值：200px 不是合法表达式 → 模板编译直接报错；
             属性之间用逗号不是分号；对象写法里 CSS 属性要 camelCase（background-color → backgroundColor） -->
        <!-- ⚠️ 预览要显示在虚线框里，就必须放进 VueDropzone 的插槽：
             slot 内容经 preact-vue-connect 的 Teleport 渲染进 Dropzone 的 div。
             放在外面（之前的写法）无论怎么调 CSS 都不可能出现在虚线框里 -->
        <VueDropzone
            @file-uploaded="onFileUploaded"
            @dragging-change="onDraggingChange"
            :uploader="uppy"
            className="dropzone"
        >
            <div v-if="uploaded" class="dropzone-preview">
                <img :src="uploaded" alt="上传结果预览" />
            </div>
            <div v-else :class="dropzoneInnerClass">
                {{dragging?"Drop Here to Upload":"Drag File Here"}}
            </div>
        </VueDropzone>
        <button v-if="uploaded" class="preview-close" @click="clearUploaded">X</button>
        <ol class="steps">
            <li :class="{ done: step > 0, active: step === 0 }">1. /api/presign 签名</li>
            <li :class="{ done: step > 1, active: step === 1 }">2. 浏览器 PUT 直传 COS</li>
            <li :class="{ done: step > 2, active: step === 2 }">3. /api/files 落库</li>
        </ol>
        <p v-if="objectKey" class="info">对象名：{{ objectKey }}</p>
        <p v-if="error" class="err">{{ error }}</p>
    </div>
</template>

<script setup>
    import { ref } from "vue";
    import { UploadButtonWithUploader } from "@image-saas/upload-button";
    import { connect } from "@image-saas/preact-vue-connect";
    import { createUploader } from "@image-saas/uploader";
    import {DropzoneWithUploader} from "@image-saas/dropzone"

    // ⚠️ 浏览器端不要 import @image-saas/api 直接调 image-saas：
    //   1. 那样必须把 api-key 写进浏览器代码，任何人 F12 都能拿走，
    //      等于把上传权限公开（还能离线爆破你的 key）。
    //   2. 也不需要 JWT：api-key 只在服务端（.env）存在，
    //      前端调自己服务器的 /api/presign，由服务端代为请求 image-saas。
    // 正确链路：presign（3456，同源）→ PUT 直传 COS → files 落库。

    const step = ref(0);
    const objectKey = ref("");
    const error = ref("");
    const VueUploadButton = connect(UploadButtonWithUploader);
    const VueDropzone = connect(DropzoneWithUploader);

    // Uppy 依赖浏览器环境，SSR 下不创建；相关 handler 也只在客户端触发
    const uppy = import.meta.client
        ? createUploader(async (req) => {
              // ⚠️ v6 签名回调参数是 { method, key, contentType }，拿不到 File 对象。
              //   服务端 /api/presign 支持 key 覆盖，直接透传即可。
              error.value = ""; // 新一轮上传开始，清掉上一次的报错
              const res = await $fetch("/api/presign", {
                  method: "POST",
                  body: { key: req.key, contentType: req.contentType },
              });
              step.value = 1;
              objectKey.value = res.key;
              // PresignedResponse 只需要 { url }；PUT 方法是 aws-s3 固定行为，不用传
              return { url: res.url };
          })
        : null;

    function clearUploaded() {
        // 预览还停留在本地 blob（上传未完成就点了 X）时，要 revoke 释放内存
        if (blobUrl && uploaded.value === blobUrl) {
            URL.revokeObjectURL(blobUrl);
            blobUrl = "";
        }
        uploaded.value = "";
    }

    const uploaded = ref("");
    const dragging = ref(false);

    watchEffect(()=>{
        console.log(dragging.value)
    })

    const dropzoneInnerClass = computed(()=>dragging.value?"dropzone-inner dragging": "dropzone-inner")

    // Dropzone 的必填 prop；Vue 侧不用它做高亮 UI，只同步到 dragging 方便调试
    function onDraggingChange(flag) {
        dragging.value = flag;
    }

    // 松手/选完文件瞬间就预览：file-added 在上传开始前就触发，
    // 用 URL.createObjectURL 把本地文件转成 blob URL 秒显（零网络请求）。
    // 上传成功后 onFileUploaded 再换成 COS 签名 URL，旧 blob 记得 revoke 释放内存
    let blobUrl = "";
    if (uppy) {
        uppy.on("file-added", (file) => {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            blobUrl = URL.createObjectURL(file.data);
            uploaded.value = blobUrl;
        });
    }

    // 每个文件 PUT 成功后由 UploadButtonWithUploader 回调（url 带签名 query）。
    // ⚠️ 这里必须落库：不调 /api/files 的话对象只在 COS 里，dashboard 列表永远查不到
    function onFileUploaded(url, file) {
        // 本地 blob 预览替换为 COS 签名 URL，并释放 blob 内存
        if (blobUrl && uploaded.value === blobUrl) {
            URL.revokeObjectURL(blobUrl);
            blobUrl = "";
        }
        uploaded.value = url;
        step.value = 2;
        $fetch("/api/files", {
            method: "POST",
            body: {
                // 签名 URL 带 query，服务端会剥掉
                url,
                name: file?.name,
                type: file?.type || "application/octet-stream",
            },
        })
            .then(() => {
                step.value = 3;
            })
            .catch((e) => {
                error.value = e?.data?.message ?? String(e);
            });
    }

    // 失败提示（uppy 实例在客户端才有）
    if (uppy) {
        uppy.on("upload-error", (_file, err) => {
            // ⚠️ v6 的 upload-error 签名是 (file, error, response?)，错误在第 2 参
            error.value = err?.message ?? "上传失败";
            step.value = 0;
        });
    }
</script>

<style>
html, body {
    margin: 0;
    padding: 0;
}
.steps { list-style: none; padding: 0; }
.steps li { color: #888; }
.steps li.active { color: #d85a30; }
.steps li.done { color: #0f6e56; }
.err { color: #a32d2d; white-space: pre-wrap; }
.info { color: #444; font-family: monospace; }
.upload-button {
    appearance: none;
    padding: 8px;
    border: 0;
    border-radius: 4px;
    background: #030303;
    color: #efefef;
    cursor: pointer;
}

.upload-button:hover {
    background: #222222;
    color: #efefef;
}

.dropzone {
    border-style: dashed;
    border-width: 2px;
    width: 50vw;
    height: 50vh;
}

.dropzone-inner {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 24px;
}

.dropzone-inner.dragging {
    background: #e6abab;
}

/* 插槽里的上传结果预览：铺满 dropzone，图片等比缩放不裁切 */
.dropzone-preview {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
}

.dropzone-preview > img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    z-index: 10;
}

.container {
    /* X 按钮是 position:absolute，需要一个定位祖先，否则会相对整个视口定位 */
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100vh;
    box-sizing: border-box;
}

.preview-close {
    appearance: none;
    width: 40px;
    height: 40px;
    display: flex;
    justify-content: center;
    align-items: center;
    background: white;
    position: absolute;
    right: 10%;
    top: 10%;
    z-index: 10;
    border-radius: 20px;
    border: 0;
}

.preview-close:hover {
    background: #eaeaea;
}
</style>
