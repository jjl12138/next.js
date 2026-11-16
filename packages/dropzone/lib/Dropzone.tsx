"use client";

import { useEffect, useRef, useState } from "preact/hooks";
import type { HTMLAttributes, ReactNode } from "preact/compat";

// ⚠️ 不要 import { cn } from "@/lib/utils"：那是 Next.js 应用（shadcn）的路径别名，
//   本包内不存在，vite/tsc 都会报 TS2307。这里只需要「拼接 + 覆盖排序」，
//   用简单的 filter-join 即可（不涉及 tailwind-merge 的冲突类去重）。
//
// ⚠️ 两个 TS7 坑（TS 5.9.3 不报、7.0.2 报，IDE 用的就是包内 7.0.2）：
//   1. value 兼容必须写 { value: string | undefined } —— preact 的 className 类型是
//      Signalish<string | undefined>，SignalLike<string|undefined> 装不进 { value: string }；
//   2. .filter(Boolean) 不会收窄类型，必须在 map 里先判空、再 filter 用类型谓词收窄成 string，
//      否则 join 时 c is possibly null。
function cn(...classes: Array<string | false | null | undefined | { value: string | undefined }>) {
  return classes
    .map((c) => (c && typeof c === "object" ? c.value : c))
    .filter((c): c is string => typeof c === "string")
    .join(" ");
}

type CommonPreactComponentProps = {
  /** 由 preact-vue-connect 注入：回传一个 DOM 容器，Vue 的 Teleport 会把 slot 内容渲染进来 */
  setChildrenContainer?: (ele: HTMLElement) => void;
};

export type DropzoneProps = {
  onDraggingChange: (dragging: boolean) => void;
  onFileChosen: (files: File[])=>void;
  children: ReactNode | ((dragging: boolean) => ReactNode);
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'> & CommonPreactComponentProps;

export function Dropzone({
  children,
  className,
  setChildrenContainer,
  onDraggingChange,
  onFileChosen,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  ...divProps
}: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(()=>{
    onDraggingChange(dragging);
  },[onDraggingChange, dragging])
  // dragenter / dragleave 会在拖过每个子元素时反复触发（冒泡），
  // 只靠布尔值会让高亮疯狂闪烁。用计数器：进一层 +1，出一层 -1，
  // 归零才算真的离开整个区域。
  const depth = useRef(0);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  return (
    <div 
      ref={(e) => {
        // ⚠️ Preact 卸载时 ref 回调会收到 null，直接传给 setChildrenContainer 类型不符；
        //   而且 setChildrenContainer 是可选 prop —— 不经 preact-vue-connect 直接用本组件时
        //   它是 undefined，不加 ?. 挂载即崩（Cannot read properties of undefined）
        if (e) setChildrenContainer?.(e);
      }}
      {...divProps}
      // 列表为空时这个 div 高度是 0，鼠标根本没地方放文件 —— 必须有最小高度
      // ⚠️ className 放最后并用 cn 合并：调用方（page.tsx 传 "relative"）的类名
      //    必须排在内置类名之后，否则会被内置的覆盖掉；直接用模板串拼接会丢外部类名。
      className={cn(
        "min-h-40 rounded-lg border-2 border-dashed p-2 transition-colors",
        dragging ? "border-blue-500 bg-blue-50" : "border-transparent",
        className
      )}
      onDragEnter={(e) => {
        e.preventDefault();
        // 进入子元素时也要取消 pending 的 leave 定时器，否则 50ms 内
        // 没有新 dragover 到来时高亮会提前熄灭（闪烁）
        if(timerRef.current){
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        depth.current += 1;
        setDragging(true);
        onDragEnter?.(e);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if(timerRef.current){
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        timerRef.current = setTimeout(()=>{
            setDragging(false);
        },50)
        depth.current -= 1;
        if (depth.current <= 0) reset();
        onDragLeave?.(e);
      }}
      onDragOver={(e) => {
        // 不 preventDefault 的话浏览器会在松手时直接打开这个文件（跳走页面）
        e.preventDefault();
        if(timerRef.current){
            clearTimeout(timerRef.current)
            timerRef.current = null;
        }
        onDragOver?.(e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        reset();
        onDrop?.(e);

        const dropped = Array.from(e.dataTransfer?.files || []);
        if (dropped.length === 0) return;
        // ⚠️ name 和 type 必须显式带上：
        //   name 丢了 → generateObjectKey 拿到 undefined，对象 key 变成 "unnamed"，
        //               COS 上一堆同名文件互相覆盖
        //   type 丢了 → 预签名用的 Content-Type 与实际 PUT 请求头不一致 → COS 返回 403
        //
        // addFiles 是批量 API（files-added 只触发一次，单个文件不符合限制不会中断整批），
        // 但它【没有】 addFile 那样的 File 重载，只收 Uppy 的文件描述符，
        // 所以必需字段得自己填 —— 直接 addFiles(dropped) 是过不了类型的。
        // ⚠️ 直接传 dropped：之前又用三元重新算了一遍 files（可能为 null），
        //   把 null 传给类型为 (files: File[]) => void 的 onFileChosen，属于死代码 + 类型违规
        onFileChosen(dropped);
        setDragging(false);
      }}
    >
      {typeof children == 'function' ? children(dragging) : children}
      {dragging && (
        <div className="pointer-events-none flex h-40 items-center justify-center text-sm text-blue-600">
          松手即可添加文件
        </div>
      )}
    </div>
  );
}
