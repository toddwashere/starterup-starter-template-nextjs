"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@workspace/ui/components/sidebar";
import { OrgSwitcher } from "./org-switcher";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { SidebarBrand } from "./sidebar-brand";
import type { NavConfig } from "@/types/nav";

export function AppSidebar({
  navConfig,
  ...props
}: { navConfig: NavConfig } & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarBrand />
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain config={navConfig} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
