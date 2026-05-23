"use client"

import * as React from "react"

import {
  PageActions,
  PageHeaderSection,
  PageSecondaryBar,
  PageTitle,
} from "#components/page"
import { Skeleton } from "#components/skeleton"
import { useIsMobile } from "#hooks/use-mobile"
import { cn } from "#lib/utils"

export type PageHeaderProps = {
  /** Required when `breadcrumb` is omitted; with breadcrumb, used for screen readers only. */
  title?: React.ReactNode
  /** Native `title` tooltip on the heading (browser hover). */
  description?: string
  /** When set, renders on one line; `title` is used for screen readers only. */
  breadcrumb?: React.ReactNode
  leading?: React.ReactNode
  trailing?: React.ReactNode
  actions?: React.ReactNode
  toolbar?: React.ReactNode
  /**
   * When true, `toolbar` renders on the primary row on md+ viewports.
   * On smaller screens it moves to a full-width secondary bar automatically.
   */
  toolbarInline?: boolean
  className?: string
  /** When true, title renders as a skeleton (ignored when `breadcrumb` is set). */
  isLoading?: boolean
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  leading,
  trailing,
  actions,
  toolbar,
  toolbarInline = false,
  className,
  isLoading = false,
}: PageHeaderProps) {
  const isMobile = useIsMobile()
  const showTrailingOrActions = Boolean(trailing ?? actions)
  const useBreadcrumbLine = Boolean(breadcrumb)
  const showInlineToolbar = Boolean(toolbar && toolbarInline && !isMobile)
  const showStackedToolbar = Boolean(toolbar && toolbarInline && isMobile)
  const showBelowToolbar = Boolean(toolbar && !toolbarInline)
  const showCenterColumn =
    useBreadcrumbLine ||
    isLoading ||
    (title != null && title !== "") ||
    showInlineToolbar

  return (
    <PageHeaderSection className={className}>
      <div>
        <div className="flex h-14 flex-row items-center gap-1.5 px-4 sm:px-6">
          {leading ? (
            <div
              className={cn(
                "flex min-w-0 items-center gap-1",
                !title && !breadcrumb && !isLoading ? "flex-1" : "shrink-0"
              )}
            >
              {leading}
            </div>
          ) : null}
          {showCenterColumn ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {useBreadcrumbLine ? (
                <div
                  className={cn(
                    "min-w-0 shrink-0 [&_[data-slot=breadcrumb-list]]:flex-nowrap",
                    "[&_[data-slot=breadcrumb-page]]:font-semibold"
                  )}
                  title={description}
                >
                  {breadcrumb}
                </div>
              ) : isLoading ? (
                <Skeleton className="h-5 w-48 max-w-full shrink-0" />
              ) : title != null && title !== "" ? (
                <PageTitle className="shrink-0 truncate" title={description}>
                  {title}
                </PageTitle>
              ) : null}
              {useBreadcrumbLine && !isLoading && title ? (
                <span className="sr-only">
                  <PageTitle title={description}>{title}</PageTitle>
                </span>
              ) : null}
              {showInlineToolbar ? (
                <div className="min-w-0 flex-1">{toolbar}</div>
              ) : null}
            </div>
          ) : null}
          {showTrailingOrActions ? (
            <div className="flex shrink-0 items-center gap-2">
              {trailing}
              {actions ? <PageActions>{actions}</PageActions> : null}
            </div>
          ) : null}
        </div>
        {showStackedToolbar || showBelowToolbar ? (
          <PageSecondaryBar className="h-auto min-h-12 items-stretch py-3">
            {toolbar}
          </PageSecondaryBar>
        ) : null}
      </div>
    </PageHeaderSection>
  )
}
