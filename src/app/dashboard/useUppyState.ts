import { Uppy, State, Meta, Body } from "@uppy/core";
import { useEffect, useMemo, useRef } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";

// 注意 @uppy/core v6 的类型跟 v3/v4 差别很大：
//   - 没有 IndexedObject（v6 移除）
//   - State<M, B> 和 Uppy<M, B> 都要两个泛型（Meta / Body）
//   - new Uppy() 推导出的 B 是 Record<string, never>，不是 Body，
//     所以 B 的默认值必须跟它对齐，否则传进去会报
//     "Uppy<Meta, Record<string, never>> is not assignable to Uppy<Meta, Body>"
//     （Uppy 的 opts 里有以 B 为参数的函数，逆变导致不兼容）。
// 照旧教程写会连环报 TS2614 / TS2314 / TS2345。
export function useUppyState<
  T,
  M extends Meta = Meta,
  B extends Body = Record<string, never>,
>(uppy: Uppy<M, B>, selector: (state: State<M, B>) => T) {
  // Uppy 内部是个 Redux 风格的 store，没有公开的 getState 文档，
  // 但 store 属性是稳定的（@uppy/react 等官方包也这么用）。
  // ✅ 不用 as any：v6 的类型里 store 是【公有】字段
  //    （Uppy.d.ts:284 `store: NonNullableUppyOptions<M, B>['store']`），
  //    直接读就有完整类型，any 会同时踩到 no-explicit-any。
  const store = uppy.store;

  // ⚠️ 关键：selector 必须是稳定引用。
  // useSyncExternalStoreWithSelector 内部用 useMemo 缓存 selector 的计算结果，
  // 依赖数组含 selector。调用方传的是内联箭头函数 (s) => Object.values(s.files)，
  // 每次 render 都是新引用 → useMemo 缓存被重置 → Object.values() 每次返回
  // 【新数组】→ React 认为 external state 变了 → 重渲染 → 又新数组 → 死循环。
  //
  // 用 ref 把 selector 包一层稳定函数，缓存才能生效。
  const selectorRef = useRef(selector);
  // ⚠️ 不能在 render 期间写 ref（selectorRef.current = selector 会被
  //    react-hooks/refs 直接判 error，且并发渲染下可能读到别的 render 的值）。
  //    放进 effect 更新：commit 之后才写，render 期间只读 —— 这是 React 官方
  //    "latest ref" 模式。首帧用的是 useRef(selector) 的初值，本身就是最新的。
  useEffect(() => {
    selectorRef.current = selector;
  }, [selector]);

  const stableSelector = useMemo(
    () => (state: State<M, B>) => selectorRef.current(state),
    []
  );

  const subscribe = useMemo(() => store.subscribe.bind(store), [store]);
  const getSnapshot = useMemo(() => store.getState.bind(store), [store]);

  // 导出名是 useSyncExternalStoreWithSelector（External 有 al），
  // 拼成 useSyncExternStore... 会直接 ReferenceError。
  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getSnapshot,
    stableSelector
  );
}
