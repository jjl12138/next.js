"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import {
  DropdownMenu,
  DropdownMenuButton,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";

/**
 * 右上角的用户菜单（头像 + 下拉）。
 *
 * ⚠️ 必须是 client 组件：signOut 来自 next-auth/react（浏览器端），
 *    Server Component 里 import 不了。
 *
 * ⚠️ 结构是 react-aria 的 MenuTrigger：「触发器」和「菜单内容」是它的
 *    两个兄弟子节点，MenuTrigger 只负责把二者关联起来：
 *      <DropdownMenuTrigger>
 *        <DropdownMenuButton>头像</DropdownMenuButton>   ← 触发器
 *        <DropdownMenu>…</DropdownMenu>                  ← 弹出的菜单
 *      </DropdownMenuTrigger>
 *
 * ⚠️ Header（DropdownMenuLabel）必须包在 Section（DropdownMenuGroup）里：
 *    react-aria 的集合只收集 Section / Item，直接挂在 Menu 下的 <Header>
 *    不会进入集合（截图里菜单 data-empty="true"、只有标题没有任何可点项），
 *    Header 只在 Section 内部才会被正确识别为分组标题。
 *
 * ⚠️ 主题为什么必须在这里给入口：ThemeProvider 的 defaultTheme 是 "system"，
 *    没有手动切换控件时，页面永远只跟随操作系统 —— 系统是浅色，用户就会以为
 *    「暗黑模式没生效」。next-themes 会把 data-theme 写到 <html> 上，
 *    globals.css 的 [data-theme="dark"] 才会覆盖 :root 的变量。
 *    切换组用 Section 级别的 selectionMode，而不是整个 Menu 单选用：
 *    整菜单单选会把下面的「退出登录」也变成可选中项。
 */
export function UserMenu({
  name,
  image,
  email,
}: {
  name?: string | null;
  image?: string | null;
  email?: string | null;
}) {
  const { theme, setTheme } = useTheme();
  // ⚠️ 挂载前不读 theme：next-themes 只能从 localStorage / 系统偏好里取值，
  //    服务端渲染拿不到（theme 是 undefined）。直接把它塞进 selectedKeys，
  //    会让「勾」在 SSR 和首帧客户端不一致 → hydration mismatch。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <DropdownMenuTrigger>
      {/* 触发按钮必须用 DropdownMenuButton（react-aria 版），
          项目里 base-ui 的 Button 接不住 MenuTrigger 的 press 事件。
          ⚠️ 按钮里只有一张头像图，没有文字 → 屏幕阅读器拿不到名字，
          必须显式给 aria-label。 */}
      <DropdownMenuButton aria-label="账号菜单">
        <Avatar>
          {/* 原来是非空断言 image!，image 为 null 时会塞给 img 一个 null src；
              用 ?? undefined，AvatarImage 内部会走 onError 显示 Fallback */}
          <AvatarImage src={image ?? undefined} />
          <AvatarFallback>{name?.slice(0, 2) ?? "?"}</AvatarFallback>
        </Avatar>
      </DropdownMenuButton>

      <DropdownMenu>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{name ?? "我的账号"}</DropdownMenuLabel>
          {email ? (
            <DropdownMenuItem isDisabled textValue={email}>
              {email}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* 外观：单选组，选中项右侧自动出现对勾（由 DropdownMenuItem 的
            selectionMode 分支渲染）。keys 直接对应 next-themes 的 theme 值 */}
        <DropdownMenuGroup
          selectionMode="single"
          selectedKeys={mounted && theme ? [theme] : []}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (typeof next === "string") setTheme(next);
          }}
        >
          <DropdownMenuLabel>外观</DropdownMenuLabel>
          <DropdownMenuItem id="light" textValue="浅色">
            <Sun />
            浅色
          </DropdownMenuItem>
          <DropdownMenuItem id="dark" textValue="深色">
            <Moon />
            深色
          </DropdownMenuItem>
          <DropdownMenuItem id="system" textValue="跟随系统">
            <Monitor />
            跟随系统
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onAction={() => {
            // callbackUrl 给首页：登出后停在 /dashboard 会立刻被 layout 的
            // 守卫再踢回登录页，看起来像「没登出成功」。
            void signOut({ callbackUrl: "/" });
          }}
        >
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
}
