"use client";

import { AppIcon } from "@workspace/ui/components/app-icon";
import { AppLogo } from "@workspace/ui/components/app-logo";
import { useSidebar } from "@workspace/ui/components/sidebar";

export function SidebarBrand() {
  const { state } = useSidebar();

  if (state === "collapsed") {
    return (
      <div className="flex items-center justify-center px-2 py-2">
        <AppIcon size="sm" />
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      <AppLogo size="sm" />
    </div>
  );
}
