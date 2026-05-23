"use client"

import * as React from "react"

import { Badge } from "#components/badge"
import { Button } from "#components/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "#components/drawer"
import { IconForFilter } from "#components/icon-for"
import { useIsMobile } from "#hooks/use-mobile"
import { cn } from "#lib/utils"

export type PageToolbarProps = React.HTMLAttributes<HTMLDivElement>

/** Full-width filter/search row for page headers (secondary bar or inline). */
export function PageToolbar({ className, ...props }: PageToolbarProps) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-row flex-wrap items-center gap-2",
        className
      )}
      {...props}
    />
  )
}

export type PageToolbarFiltersProps = React.HTMLAttributes<HTMLDivElement>

/** Inline filter fields for md+ viewports. */
export function PageToolbarFilters({ className, ...props }: PageToolbarFiltersProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-row flex-wrap items-center gap-2",
        className
      )}
      {...props}
    />
  )
}

export type ResponsivePageToolbarFiltersProps = {
  children: React.ReactNode
  /** Number of active filters (shown as a badge on the mobile trigger). */
  activeCount?: number
  drawerTitle?: string
  drawerDescription?: string
  /** Footer actions inside the mobile drawer (e.g. clear filters). */
  drawerFooter?: React.ReactNode
  triggerLabel?: string
  className?: string
}

/**
 * Inline filter fields on md+; a compact Filters button (same row as search) that
 * opens a bottom drawer on smaller screens. Write filter controls once as `children`.
 */
export function ResponsivePageToolbarFilters({
  children,
  activeCount = 0,
  drawerTitle = "Filters",
  drawerDescription,
  drawerFooter,
  triggerLabel = "Filters",
  className,
}: ResponsivePageToolbarFiltersProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)

  if (!isMobile) {
    return <PageToolbarFilters className={className}>{children}</PageToolbarFilters>
  }

  const description =
    drawerDescription ?? `Adjust ${drawerTitle.charAt(0).toLowerCase()}${drawerTitle.slice(1)}`

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("h-9 shrink-0", className)}
        onClick={() => setOpen(true)}
      >
        <IconForFilter className="sm:mr-2" />
        <span className="hidden sm:inline">{triggerLabel}</span>
        {activeCount > 0 ? (
          <Badge variant="secondary" className="ml-1.5 font-normal sm:ml-2">
            {activeCount}
          </Badge>
        ) : null}
        <span className="sr-only sm:hidden">{triggerLabel}</span>
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{drawerTitle}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-3 px-4 pb-2 [&_[data-slot=select-trigger]]:w-full">
            {children}
          </div>
          <DrawerFooter className="flex-row flex-wrap gap-2">
            {drawerFooter}
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}
