"use client"

import { forwardRef } from "react"
import type { LucideProps } from "lucide-react"
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bold,
  Bot,
  Building2,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  CreditCard,
  Globe,
  Italic,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListFilter,
  LogOut,
  Mail,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Phone,
  Sun,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  Underline,
  Unlink,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react"
import { cn } from "#lib/utils"

export const IconForDashboard = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <LayoutDashboard ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForDashboard.displayName = "IconForDashboard";

export const IconForOrganization = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Building2 ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForOrganization.displayName = "IconForOrganization";

export const IconForSettings = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Settings ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForSettings.displayName = "IconForSettings";

export const IconForMembers = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Users ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForMembers.displayName = "IconForMembers";

export const IconForSecurity = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Shield ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForSecurity.displayName = "IconForSecurity";

export const IconForBilling = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <CreditCard ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForBilling.displayName = "IconForBilling";

export const IconForProfile = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <BadgeCheck ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForProfile.displayName = "IconForProfile";

export const IconForNotifications = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Bell ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForNotifications.displayName = "IconForNotifications";

export const IconForSignOut = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <LogOut ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForSignOut.displayName = "IconForSignOut";

export const IconForExpand = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <ChevronsUpDown ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForExpand.displayName = "IconForExpand";

export const IconForFilter = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <ListFilter ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForFilter.displayName = "IconForFilter";

export const IconForAdd = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Plus ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForAdd.displayName = "IconForAdd";

export const IconForInvite = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <UserPlus ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForInvite.displayName = "IconForInvite";

export const IconForRemove = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <UserMinus ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForRemove.displayName = "IconForRemove";

export const IconForMore = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <MoreHorizontal ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForMore.displayName = "IconForMore";

export const IconForClose = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <X ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForClose.displayName = "IconForClose";

export const IconForChevronRight = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <ChevronRight ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForChevronRight.displayName = "IconForChevronRight";

export const IconForBold = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Bold ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForBold.displayName = "IconForBold";

export const IconForItalic = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Italic ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForItalic.displayName = "IconForItalic";

export const IconForUnderline = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Underline ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForUnderline.displayName = "IconForUnderline";

export const IconForEmail = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Mail ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForEmail.displayName = "IconForEmail";

export const IconForPassword = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <KeyRound ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForPassword.displayName = "IconForPassword";

export const IconForVerified = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <CheckCircle2 ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForVerified.displayName = "IconForVerified";

export const IconForWarning = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <AlertTriangle ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForWarning.displayName = "IconForWarning";

export const IconForConnect = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Link2 ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForConnect.displayName = "IconForConnect";

export const IconForDisconnect = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Unlink ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForDisconnect.displayName = "IconForDisconnect";

export const IconForDevice = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Monitor ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForDevice.displayName = "IconForDevice";

export const IconForSun = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Sun ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForSun.displayName = "IconForSun";

export const IconForMoon = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Moon ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForMoon.displayName = "IconForMoon";

export const IconForKey = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <KeyRound ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForKey.displayName = "IconForKey";

export const IconForAi = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Bot ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForAi.displayName = "IconForAi";

export const IconForSearch = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Search ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForSearch.displayName = "IconForSearch";

export const IconForContacts = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Users ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForContacts.displayName = "IconForContacts";

export const IconForPhone = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Phone ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForPhone.displayName = "IconForPhone";

export const IconForWebsite = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Globe ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForWebsite.displayName = "IconForWebsite";

export const IconForDelete = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Trash2 ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForDelete.displayName = "IconForDelete";

export const IconForEdit = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Pencil ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForEdit.displayName = "IconForEdit";
