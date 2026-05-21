"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"

import { ColoredLabelView, coloredLabelVariants } from "#components/colored-label-view"
import { Button } from "#components/button"
import { cn } from "#lib/utils"
import type { TagValue } from "#hooks/use-tags-field"

const tagChipVariants = coloredLabelVariants

type TagChipProps<T extends TagValue = TagValue> = VariantProps<typeof tagChipVariants> & {
  tag: T
  displayLabel?: string
  onRemove?: () => void
  onClick?: () => void
  className?: string
}

function TagChipInner<T extends TagValue>(
  {
    tag,
    displayLabel = tag.label,
    onRemove,
    onClick,
    size,
    className,
  }: TagChipProps<T>,
  ref: React.ForwardedRef<HTMLSpanElement>
) {
  const label = onClick ? (
    <button
      type="button"
      className="max-w-[200px] truncate bg-transparent p-0 text-left"
      onClick={onClick}
    >
      {displayLabel}
    </button>
  ) : undefined

  return (
    <span ref={ref} className={cn("inline-flex items-center gap-0.5", className)}>
      {onClick ? (
        <span
          data-tag-color={tag.color}
          className={cn(
            coloredLabelVariants({
              size,
              tone: tag.color ? "colored" : "muted",
            }),
            tag.color && "border-transparent text-white"
          )}
          style={
            tag.color
              ? { backgroundColor: tag.color, borderColor: tag.color }
              : undefined
          }
        >
          {label}
        </span>
      ) : (
        <ColoredLabelView
          label={displayLabel}
          color={tag.color}
          size={size}
          data-entity-type="tag"
        />
      )}
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${tag.label}`}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className={cn(
            "size-7 shrink-0 hover:bg-transparent",
            tag.color && "text-white/90 hover:text-white"
          )}
        >
          <XIcon className="size-3.5" />
        </Button>
      ) : null}
    </span>
  )
}

const TagChip = React.forwardRef(TagChipInner) as <T extends TagValue>(
  props: TagChipProps<T> & { ref?: React.ForwardedRef<HTMLSpanElement> }
) => React.JSX.Element

;(TagChip as React.FC).displayName = "TagChip"

export { TagChip, tagChipVariants }
export type { TagChipProps }
