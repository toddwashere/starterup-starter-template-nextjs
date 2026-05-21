"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "#lib/utils"

export const coloredLabelVariants = cva(
  "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md border px-2 font-medium",
  {
    variants: {
      size: {
        sm: "h-6 text-xs",
        md: "h-7 text-sm",
      },
      tone: {
        colored: "border-transparent text-white",
        muted: "border-transparent bg-secondary text-secondary-foreground",
      },
    },
    defaultVariants: {
      size: "md",
      tone: "muted",
    },
  }
)

export type ColoredLabelEntityType = "tag" | "stage" | "task-status"

export type ColoredLabelViewProps = VariantProps<typeof coloredLabelVariants> & {
  label: string
  color?: string | null
  suffix?: React.ReactNode
  className?: string
  title?: string
  "data-entity-type"?: ColoredLabelEntityType
}

export function ColoredLabelView({
  label,
  color,
  suffix,
  size,
  tone,
  className,
  title,
  "data-entity-type": entityType,
}: ColoredLabelViewProps) {
  const hasColor = Boolean(color)
  const resolvedTone = hasColor ? "colored" : (tone ?? "muted")

  return (
    <span
      data-entity-type={entityType}
      data-label-color={color ?? undefined}
      title={title ?? label}
      className={cn(coloredLabelVariants({ size, tone: resolvedTone }), className)}
      style={
        hasColor
          ? { backgroundColor: color ?? undefined, borderColor: color ?? undefined }
          : undefined
      }
    >
      <span className="max-w-[200px] truncate">{label}</span>
      {suffix ? <span className="shrink-0 opacity-90">{suffix}</span> : null}
    </span>
  )
}
