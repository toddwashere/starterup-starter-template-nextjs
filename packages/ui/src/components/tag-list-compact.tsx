"use client"

import * as React from "react"

import { TagView } from "#components/entity-label-views"
import { Badge } from "#components/badge"
import { cn } from "#lib/utils"

export type TagListCompactItem = {
  id: string
  name: string
  color: string
}

export type TagListCompactProps = {
  tags: TagListCompactItem[]
  /** Max tags to show before "+N more". Default 2. */
  limit?: number
  size?: React.ComponentProps<typeof TagView>["size"]
  className?: string
  emptyPlaceholder?: React.ReactNode
}

export function TagListCompact({
  tags,
  limit = 2,
  size,
  className,
  emptyPlaceholder = "—",
}: TagListCompactProps) {
  if (tags.length === 0) {
    return (
      <span className={cn("text-muted-foreground", className)}>{emptyPlaceholder}</span>
    )
  }

  const visible = tags.slice(0, limit)
  const remaining = tags.length - visible.length

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {visible.map((tag) => (
        <TagView key={tag.id} name={tag.name} color={tag.color} size={size} />
      ))}
      {remaining > 0 ? (
        <Badge variant="secondary" className="text-xs font-normal">
          +{remaining}
        </Badge>
      ) : null}
    </div>
  )
}
