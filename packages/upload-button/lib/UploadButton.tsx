import type { HTMLAttributes, RefObject } from "preact";
import { useRef } from "preact/hooks";

export type UploadButtonProps = HTMLAttributes<HTMLButtonElement> & {
  /** 由 preact-vue-connect 注入：回传一个 DOM 容器，Vue 的 Teleport 会把 slot 内容渲染进来 */
  setChildrenContainer?: (ele: HTMLElement) => void;
  /** 选中文件后回调（file input 的 change 事件转发） */
  onFileChosen?: (files: File[]) => void;
  /** 外部需要拿隐藏 file input 的引用（如上传完成后清 value）时传入。
   *  ⚠️ preact 没有 MutableRef 类型，用的就是 RefObject（{ current: T | null }） */
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function UploadButton({ onClick, setChildrenContainer, children, onFileChosen, inputRef: inputRefFromProps, ...props }: UploadButtonProps) {

  const inputRef = useRef<HTMLInputElement | null>(null);
  const handleClick = (e: MouseEvent) => {
    if (inputRef.current) {
      inputRef.current.click();
    }
    if (onClick) {
      onClick(e as any);
    }
  }

  return (
    <>
      <button
        {...props}
        onClick={handleClick}
        // ref 回调把 button 本身回传给 connect 层，
        // Vue 的 Teleport 会把 slot 内容直接渲染进按钮内部。
        // ⚠️ 这里只能动 setChildrenContainer，不要把 button 节点写进 inputRef：
        //   inputRef 是 <input> 的 ref，被 button 覆盖后 handleClick 里的
        //   inputRef.current.click() 会变成 button.click() → 无限递归
        ref={(el) => {
          if (el && setChildrenContainer) {
            setChildrenContainer(el);
          }
        }}
      >
        {children}
      </button>
      {/* file input 必须留在 button 外：放进 button 会因点击互相触发死循环 */}
      <input
        onChange={(e) => {
          const filesFromEvent = (e.target as HTMLInputElement).files;
          if (filesFromEvent && onFileChosen) {
            onFileChosen(Array.from(filesFromEvent));
          }
        }}
        // 内部 inputRef 供 handleClick 打开文件选择框；
        // 外部 inputRefFromProps 同步指向同一个 input（供外部上传完成后清 value）
        ref={(el) => {
          inputRef.current = el;
          if (inputRefFromProps) {
            // ⚠️ 不要写成 if (inputRefFromProps?.current)：外部 ref 初始就是 null，
            //   这个条件永远不成立，外部永远拿不到节点。判断 ref 对象本身即可
            inputRefFromProps.current = el;
          }
        }}
        tabIndex={-1}
        type="file"
        style={{ opacity: 0, position: 'fixed', left: -10000 }}
      ></input>
    </>
  );
}
