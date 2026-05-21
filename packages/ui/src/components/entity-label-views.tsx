"use client"

import { ColoredLabelView, type ColoredLabelViewProps } from "#components/colored-label-view"

type EntityLabelProps = Omit<
  ColoredLabelViewProps,
  "label" | "data-entity-type" | "suffix"
> & {
  name: string
}

export function TagView({ name, color, ...props }: EntityLabelProps) {
  return (
    <ColoredLabelView
      {...props}
      label={name}
      color={color}
      data-entity-type="tag"
    />
  )
}

export function StageView({ name, color, ...props }: EntityLabelProps) {
  return (
    <ColoredLabelView
      {...props}
      label={name}
      color={color}
      data-entity-type="stage"
    />
  )
}

export function TaskStatusView({
  name,
  color,
  isTerminal = false,
  ...props
}: EntityLabelProps & { isTerminal?: boolean }) {
  return (
    <ColoredLabelView
      {...props}
      label={name}
      color={color}
      data-entity-type="task-status"
      suffix={isTerminal ? "✓" : undefined}
    />
  )
}
