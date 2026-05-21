import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StageView, TagView, TaskStatusView } from "#components/entity-label-views"
import { ColoredLabelView } from "#components/colored-label-view"

describe("ColoredLabelView", () => {
  it("renders muted label without color", () => {
    render(<ColoredLabelView label="Draft" data-entity-type="tag" />)

    expect(screen.getByText("Draft")).toBeInTheDocument()
    expect(screen.getByText("Draft").closest("[data-entity-type='tag']")).not.toHaveAttribute(
      "data-label-color"
    )
  })

  it("applies inline color when provided", () => {
    render(<ColoredLabelView label="VIP" color="#6366f1" data-entity-type="tag" />)

    const chip = screen.getByText("VIP").closest("[data-label-color]")
    expect(chip).toHaveAttribute("data-label-color", "#6366f1")
    expect(chip?.getAttribute("style") ?? "").toContain("background-color")
  })
})

describe("entity label views", () => {
  it("renders TagView, StageView, and TaskStatusView with entity markers", () => {
    const { rerender } = render(<TagView name="Partner" color="#22c55e" />)
    expect(screen.getByText("Partner").closest("[data-entity-type='tag']")).toBeInTheDocument()

    rerender(<StageView name="Qualified" color="#3b82f6" />)
    expect(screen.getByText("Qualified").closest("[data-entity-type='stage']")).toBeInTheDocument()

    rerender(<TaskStatusView name="Done" color="#64748b" isTerminal />)
    expect(screen.getByText("Done").closest("[data-entity-type='task-status']")).toBeInTheDocument()
    expect(screen.getByText("✓")).toBeInTheDocument()
  })
})
