"use client"

import * as React from "react"

import { Button } from "#components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#components/dropdown-menu"
import { IconForMore } from "#components/icon-for"
import { PageActions } from "#components/page"
import { cn } from "#lib/utils"

export type ResponsivePageActionsProps = {
  /** Always visible — typically the primary CTA. */
  primary: React.ReactNode
  /** Shown inline from md up; collapsed into an overflow menu below md. */
  secondary?: React.ReactNode
  /** Accessible label for the mobile overflow trigger. */
  overflowLabel?: string
  className?: string
}

/**
 * Page header actions that keep the primary CTA visible on mobile while
 * tucking secondary actions into an overflow menu.
 */
export function ResponsivePageActions({
  primary,
  secondary,
  overflowLabel = "More actions",
  className,
}: ResponsivePageActionsProps) {
  return (
    <PageActions className={className}>
      {secondary ? (
        <div className="hidden items-center gap-2 md:flex">{secondary}</div>
      ) : null}
      {primary}
      {secondary ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="md:hidden">
              <IconForMore />
              <span className="sr-only">{overflowLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="flex w-48 flex-col gap-1 p-2">
            {secondary}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </PageActions>
  )
}

export type ResponsivePageActionProps = React.HTMLAttributes<HTMLDivElement>

/** Wrapper so secondary actions stack cleanly in the mobile overflow menu. */
export function ResponsivePageAction({
  className,
  ...props
}: ResponsivePageActionProps) {
  return (
    <div
      className={cn(
        "w-full [&>button]:w-full md:w-auto md:[&>button]:w-auto",
        className
      )}
      {...props}
    />
  )
}
