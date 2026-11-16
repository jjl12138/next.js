import { ComponentType } from "preact";
import type { DefineComponent } from "vue";
type CommonPreactComponentProps = {
    /** connect 会注入此回调；组件侧应声明为可选属性 */
    setChildrenContainer?: (ele: HTMLElement) => void;
};
type ConnectResult = DefineComponent<{}, {}, any>;
export declare function connect<P extends CommonPreactComponentProps>(component: ComponentType<P>): ConnectResult;
export {};
