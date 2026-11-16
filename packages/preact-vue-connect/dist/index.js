import { render, h as hp } from "preact";
import { defineComponent, h as hv, onBeforeUnmount, ref, Teleport, watchEffect, } from "vue";
export function connect(component) {
    return defineComponent({
        name: `Preact(${component.displayName || component.name || "Anonymous"})`,
        inheritAttrs: false,
        setup(_, { attrs, slots }) {
            const containerRef = ref();
            const childrenContainerRef = ref();
            // attrs 变化（父组件传新 props）→ 重新用 preact 渲染
            watchEffect(() => {
                if (containerRef.value) {
                    render(hp(component, {
                        ...attrs,
                        setChildrenContainer: (ele) => {
                            childrenContainerRef.value = ele;
                        },
                    }), containerRef.value);
                }
            });
            // 卸载时清掉 preact 渲染的 DOM 与事件监听，防泄漏
            onBeforeUnmount(() => {
                if (containerRef.value) {
                    render(null, containerRef.value);
                }
            });
            // ⚠️ 必须返回渲染函数（箭头函数包裹），直接返回 VNode 会被 Vue
            // 当作 expose 的绑定而不是 render，组件将渲染不出任何东西。
            // 渲染函数内读取 childrenContainerRef，preact 回传容器后
            // Vue 自动重渲染并挂上 Teleport。
            return () => hv("div", { ref: containerRef }, [
                childrenContainerRef.value
                    ? hv(Teleport, { to: childrenContainerRef.value }, [
                        slots.default?.(),
                    ])
                    : null,
            ]);
        },
    });
}
