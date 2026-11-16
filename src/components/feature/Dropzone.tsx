"use client";

import { Uppy } from "@uppy/core";
import { HTMLAttributes, ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function Dropzone({
  uppy,
  children,
  className,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  ...divProps
}: {
  uppy: Uppy;
  children: ReactNode | ((dragging: boolean) => ReactNode);
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const [dragging, setDragging] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // dragenter / dragleave 会在拖过每个子元素时反复触发（冒泡），
  // 只靠布尔值会让高亮疯狂闪烁。用计数器：进一层 +1，出一层 -1，
  // 归零才算真的离开整个区域。
  const depth = useRef(0);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  return (
    <div {...divProps}
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

        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length === 0) return;

        // ⚠️ name 和 type 必须显式带上：
        //   name 丢了 → generateObjectKey 拿到 undefined，对象 key 变成 "unnamed"，
        //               COS 上一堆同名文件互相覆盖
        //   type 丢了 → 预签名用的 Content-Type 与实际 PUT 请求头不一致 → COS 返回 403
        //
        // addFiles 是批量 API（files-added 只触发一次，单个文件不符合限制不会中断整批），
        // 但它【没有】 addFile 那样的 File 重载，只收 Uppy 的文件描述符，
        // 所以必需字段得自己填 —— 直接 addFiles(dropped) 是过不了类型的。
        uppy.addFiles(
          dropped.map((file) => ({
            name: file.name,
            type: file.type,
            data: file,
            source: "Dropzone",
          }))
        );
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
