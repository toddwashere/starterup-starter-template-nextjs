"use client"

import * as React from "react"

import { cn } from "#lib/utils"

export type ResponsiveDataViewProps = {
  /** Card/list layout for narrow viewports. */
  mobile: React.ReactNode
  /** Table or wide layout for md and up. */
  desktop: React.ReactNode
  /** Tailwind breakpoint prefix. Default `md`. */
  breakpoint?: "sm" | "md" | "lg"
  className?: string
}

const breakpointClasses = {
  sm: { mobile: "sm:hidden", desktop: "hidden sm:block" },
  md: { mobile: "md:hidden", desktop: "hidden md:block" },
  lg: { mobile: "lg:hidden", desktop: "hidden lg:block" },
} as const

/**
 * Renders different data layouts by viewport — e.g. cards on mobile, table on desktop.
 */
export function ResponsiveDataView({
  mobile,
  desktop,
  breakpoint = "md",
  className,
}: ResponsiveDataViewProps) {
  const classes = breakpointClasses[breakpoint]

  return (
    <div className={className}>
      <div className={classes.mobile}>{mobile}</div>
      <div className={classes.desktop}>{desktop}</div>
    </div>
  )
}

export type DataListCardProps = React.HTMLAttributes<HTMLDivElement> & {
  onActivate?: () => void
}

export function DataListCard({
  className,
  onActivate,
  onClick,
  onKeyDown,
  children,
  ...props
}: DataListCardProps) {
  const isInteractive = Boolean(onActivate ?? onClick)

  return (
    <div
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      className={cn(
        "rounded-md border p-3 space-y-1.5",
        isInteractive && "cursor-pointer transition-colors hover:bg-muted/50",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        onActivate?.()
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!isInteractive || (event.key !== "Enter" && event.key !== " ")) {
          return
        }
        event.preventDefault()
        onActivate?.()
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export type DataListCardHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  actions?: React.ReactNode
}

export function DataListCardHeader({
  className,
  actions,
  children,
  ...props
}: DataListCardHeaderProps) {
  return (
    <div
      className={cn("flex items-start justify-between gap-2", className)}
      {...props}
    >
      <div className="min-w-0 flex-1 font-medium leading-snug">{children}</div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  )
}

export type DataListCardMetaProps = React.HTMLAttributes<HTMLParagraphElement>

export function DataListCardMeta({ className, ...props }: DataListCardMetaProps) {
  return (
    <p
      className={cn("truncate text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export type DataListProps = React.HTMLAttributes<HTMLDivElement>

export function DataList({ className, ...props }: DataListProps) {
  return <div className={cn("space-y-2", className)} {...props} />
}
