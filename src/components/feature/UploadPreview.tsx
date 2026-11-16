import Uppy from "@uppy/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/Dialog";
import { useUppyState } from "@/app/dashboard/useUppyState";
// ⚠️ 必须用项目自己的 Button（带 cva 样式）。
// 从 "@base-ui/react" 直接导入的是【无样式】的原生 primitive，
// 渲染出来是个裸 <button>，跟页面其他按钮完全不是一个画风。
import { Button } from "@/components/ui/Button";
// FileItem 不再从这里引入：它是「已入库文件」的缩略图（走 /image/:id），
// 待上传文件只有本地 blob URL，用不上它会拼出 /image/undefined。

export function UploadPreview({ uppy }: { uppy: Uppy }) {
  const files = useUppyState(uppy, (s) => Object.values(s.files));
  const progress = useUppyState<number>(uppy, (s) => s.totalProgress);

  // 只预览「还没传完」的文件：
  //   1. 传完的已经在下方列表里了，弹窗里再放一遍是重复；
  //   2. 更关键的是——不过滤的话上传结束后弹窗不会消失，一直挡着页面。
  const pending = useMemo(
    () => files.filter((f) => !f.progress?.uploadComplete),
    [files]
  );

  // 用「这批文件的 id 指纹」记住用户关掉的是哪一批：
  //   同一批关掉后不再骚扰；新文件进来指纹变了 → 弹窗重新出现。
  // ⚠️ 别改成「useEffect 里监听文件数去重置 dismissed」——
  //    set-state-in-effect 是 error，会直接让 next build 失败。
  const fingerprint = pending.map((f) => f.id).join("|");
  const [dismissed, setDismissed] = useState("");

  // ⚠️ open 必须把 dismissed 算进去，否则 onOpenChange 里的 setState 毫无作用，
  //    弹窗会变成「关不掉」（点关闭 / 按 ESC 都没反应）。
  const open = pending.length > 0 && dismissed !== fingerprint;

  const [index, setIndex] = useState(0);

  // ⚠️ 不能写 const file = files[index] 然后直接 file.data.type：
  //   文件被移除、或上传完离开 pending 后，index 会越界拿到 undefined，
  //   再读 .data 就是 "Cannot read properties of undefined (reading 'type')" —— 整页白屏。
  //   这里用 clamp 派生出安全下标，而不是用 useEffect 去重置 index
  //   （set-state-in-effect 是 error，会让 next build 失败）。
  const safeIndex = pending.length > 0 ? Math.min(index, pending.length - 1) : 0;
  const file = pending[safeIndex];

  // 用 file.type 而不是 file.data.type：data 不一定是 Blob（恢复的会话里可能是 undefined）。
  // ⚠️ isImage 交给 FileItem 自己判（它收 contentType），这里不重复算一遍。
  const blob = file?.data instanceof Blob ? file.data : null;

  // ⚠️ 不能裸写 src={URL.createObjectURL(file.data)}：上传中每秒重渲染几十次，
  //    就会每秒泄漏几十个 URL，且 src 一直变会让图片疯狂闪烁。
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  // ⚠️ 也不能在 cleanup 里「立刻」revoke：App Router 默认开 Strict Mode，挂载是
  //    setup → cleanup → setup，而 useMemo 不会重跑，第二次挂载拿到的会是同一个
  //    已被 revoke 的 URL → 裂图（只在 dev 复现，生产正常，极难查）。
  //    延迟一帧释放；组件又挂载回来就把定时器取消掉。
  // ⚠️ 定时器里必须【带上它对应的是哪个 url】。
  //   原来的写法只存 timer，切文件时是这样的：
  //     cleanup(A) → 排一个「撤销 A」的定时器
  //     setup(B)   → 看到有定时器就 clearTimeout → A 的撤销被取消
  //   而 A 再也没有别的地方会撤销它 → 每切换一次预览就泄漏一个 blob URL
  //   （blob 会一直被浏览器持有到刷新页面，传一堆大图时内存涨得很明显）。
  const pendingRevoke = useRef<{
    url: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  useEffect(() => {
    if (!url) return;

    if (pendingRevoke.current) {
      clearTimeout(pendingRevoke.current.timer);
      if (pendingRevoke.current.url === url) {
        // 同一个 URL → 是 Strict Mode 的 setup→cleanup→setup，撤销取消掉，继续复用
        pendingRevoke.current = null;
      } else {
        // URL 真的换了 → 上一张图不会再用到，立刻释放，别等定时器
        URL.revokeObjectURL(pendingRevoke.current.url);
        pendingRevoke.current = null;
      }
    }

    return () => {
      // 延迟一帧再撤销：Strict Mode 第二次挂载会在同一 tick 内回到上面把它取消掉
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        pendingRevoke.current = null;
      }, 0);
      pendingRevoke.current = { url, timer };
    };
  }, [url]);

  // ⚠️ 不能只靠 totalProgress 判断「是否正在上传」：上传失败时进度会卡在中间某个数
  //    （比如 43），`progress > 0 && progress < 100` 永远为真 → 两颗按钮永久
  //    disabled → 用户既不能重试也不能删除，彻底卡死。
  //
  // 两个来源取或：
  //   1. currentUploads —— Uppy 自己维护的「进行中的上传」映射，upload() 开始登记、
  //      完成或失败移除。用它才能让弹窗跟页面顶部的 Upload 按钮状态同步
  //      （否则从顶部按钮发起上传时，弹窗按钮还是可点的，能在传输中途删文件）。
  //   2. manualBusy —— 点击时置位、Promise settle 时复位的兜底，
  //      保证即使 currentUploads 没按预期清空也不会死锁。
  //      setState 发生在事件回调 / Promise 回调里，不是 effect 里，
  //      不会被 react-hooks/set-state-in-effect 拦。
  const hasActiveUpload = useUppyState(
    uppy,
    (s) => Object.keys(s.currentUploads).length > 0
  );
  const [manualBusy, setManualBusy] = useState(false);
  const busy = manualBusy || hasActiveUpload;

  const handleUploadAll = () => {
    setManualBusy(true);
    uppy
      .upload()
      .then(() => {
        // 上传成功后把已完成的清出 uppy state，否则文件会一直堆在内存里
        // （下方列表是服务端 trpc 数据，不依赖 uppy state，清掉不影响列表）。
        // ⚠️ 必须用 uppy.getFiles() 拿最新状态，别用闭包里的 files（可能已过期）。
        // ⚠️ 只清 uploadComplete 的：失败的必须留着让用户重试或删除。
        for (const f of uppy.getFiles()) {
          if (f.progress?.uploadComplete) uppy.removeFile(f.id);
        }
      })
      // ⚠️ 原来是 .catch().then()：catch 把失败「消化」成 resolved 之后，
      //    then 照样执行 → 上传失败的文件也被静默删掉，用户东西没了还没提示。
      .catch((err) => console.error("上传失败", err))
      .finally(() => setManualBusy(false));
  };

  const handleDeleteCurrent = () => {
    if (!file) return;
    uppy.removeFile(file.id);
  };

  const clear = () => {
    // 用 getFiles() 拿【点击当下】的最新状态：files 是渲染闭包的快照，
    // 从渲染到点击之间 state 可能已经变过（用户又删了文件 / 上一批刚传完）。
    // 另外遍历做副作用别用 map —— 它会白造一个 [undefined, ...] 数组再丢掉。
    for (const f of uppy.getFiles()) {
      uppy.removeFile(f.id);
    }
    setIndex(0);
    // ⚠️ 必须同时清掉 dismissed，否则「同一个文件第二次选不弹窗」：
    //    Uppy 的文件 id 是【内容决定】的（generateFileID = 实例名 + name 小写
    //    + type + size + lastModified，见 @uppy/core/utils/generateFileID.js），
    //    跟第几次选无关 —— 同一个文件第二次选进来，id 和 fingerprint 完全相同。
    //    dismissed 还记着上一批的 fingerprint → dismissed === fingerprint
    //    → open 恒为 false → 弹窗再也不出现（换一个文件就正常，所以很难联想到）。
    //    批次清空后，「我关掉的是哪一批」这个记忆就该失效。
    setDismissed("");
  }

  const name = file?.name ?? "unnamed";
  // UppyFile 本身就带 error?: string | null（@uppy/core/lib/utils/UppyFile.d.ts:11），
  // 不需要 as 强转。null 在 JSX 里不渲染，直接短路即可。
  const error = file?.error;

  // ⚠️ 不能写 return file ? <Dialog/> : null。
  //   让 Dialog 本体随 file 一起卸载会引发两个问题：
  //     1. 关闭动画被跳过（base-ui 的 Popup 靠 mounted 状态做退场动画，
  //        父组件直接返回 null 是硬卸载，动画来不及播）；
  //     2. Dialog 的焦点归还 / 滚动锁等副作用依赖正常卸载流程，硬卸载可能残留。
  //   可见性一律交给 open 控制（open 已经包含了 pending.length > 0），
  //   内容层面再用 file && 兜底。
  return (
    <Dialog
      open={open}
      // ⚠️ base-ui 没有 onPointerDownOutside（那是 Radix 的 API）。
      //    「点击外部不关闭」要用 Root 上的 disablePointerDismissal。
      //    关键是它还会把 Popup 的 closeOnFocusOut 置为 false：
      //    点击外部会【同时】触发 outsidePress 和 focusOut 两条关闭路径，
      //    只在 onOpenChange 里对 reason === 'outside-press' 调 cancel()
      //    拦不住 focusOut 那条，所以弹窗照样关 —— 必须用这个 prop。
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) {
          // 关闭 = 丢弃这一批：清文件 + 复位 index + 让 dismissed 记忆失效，
          // 三件事都在 clear() 里，别拆成两处写（之前这里和 handleUploadAll
          // 各删一遍，逻辑重复）。
          clear();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>
          待上传 {pending.length} 个文件
          {pending.length > 1 && `（第 ${safeIndex + 1} / ${pending.length} 个）`}
        </DialogTitle>

        {/* 预览区 + 底部按钮用 file 包起来：pending 空了之后不该留下
            一个只剩两颗按钮的空壳弹窗（base-ui 的 Popup 关闭时是
            hidden 而非卸载，children 照样渲染）。 */}
        {file && (
          <>
            <div className="flex flex-col items-center gap-2">
              {/* ⚠️ 这里【不能】用 FileItem：它的签名已改成 { contentType, id, name }，
                  src 走 /image/:id —— 那是【已入库文件】的缩略图路由（要查库 + 回源 COS）。
                  而待上传的文件还没有数据库 id，只有本地 blob URL，
                  套 FileItem 会拼出 /image/undefined。所以这里直接渲染本地预览。 */}
              {url ? (
                file.type.startsWith("image/") ? (
                  <img
                    src={url}
                    alt={name}
                    className="h-56 w-full bg-gray-50 object-contain"
                  />
                ) : (
                  <img
                    src="/unknown-file-types.svg"
                    alt="未知文件类型"
                    className="h-56 w-full bg-gray-50 object-contain p-10"
                  />
                )
              ) : (
                <div className="h-56 w-full overflow-hidden rounded-lg border bg-gray-50">
                  <img
                    src="/unknown-file-types.svg"
                    alt="未知文件类型"
                    className="h-full w-full object-contain p-10"
                  />
                </div>
              )}
              <div className="w-full truncate text-xs text-gray-600" title={name}>
                {name}
              </div>
            </div>

            {pending.length > 1 && (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  // 以 safeIndex 为基准取模，index 越界时也不会跳到奇怪的位置
                  onClick={() =>
                    setIndex((safeIndex - 1 + pending.length) % pending.length)
                  }
                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                >
                  上一个
                </button>
                <button
                  type="button"
                  onClick={() => setIndex((safeIndex + 1) % pending.length)}
                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                >
                  下一个
                </button>
              </div>
            )}

            {busy && (
              <div className="text-sm text-gray-600">上传中 {progress}%</div>
            )}

            {error && !busy && (
              <div className="text-sm text-destructive">{error}</div>
            )}

            <DialogFooter>
              <Button
                variant="destructive"
                // ⚠️ 原来这颗按钮接的是 clear() —— 文案写着「Delete This」，
                //    实际行为却是【清空全部待上传文件】。用户只想删当前这一张，
                //    点完发现整批都没了。handleDeleteCurrent 之前定义了却没接线
                //    （死代码，eslint 报 unused）。
                onClick={handleDeleteCurrent}
                disabled={busy}
              >
                Delete This
              </Button>
              <Button
                variant="outline"
                onClick={clear}
                disabled={busy}
              >
                Discard All
              </Button>
              {/* 之前这颗按钮没接 onClick，点了完全没反应 */}
              <Button onClick={handleUploadAll} disabled={busy}>
                Upload All
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
