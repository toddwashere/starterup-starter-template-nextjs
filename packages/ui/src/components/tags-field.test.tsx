import "@testing-library/jest-dom/vitest"
import * as React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TagsField, type TagValue } from "#components/tags-field"

const catalog: TagValue[] = [
  { id: "ctag_vip", label: "VIP", color: "#6366f1" },
  { id: "ctag_beta", label: "Beta" },
]

function ControlledTagsField(
  props: Partial<React.ComponentProps<typeof TagsField>> & {
    initialTags?: TagValue[]
  }
) {
  const { initialTags = [], ...rest } = props
  const [tags, setTags] = React.useState<TagValue[]>(initialTags)

  return (
    <TagsField
      aria-label="Tags"
      placeholder="Add tag"
      tags={tags}
      onTagsChange={setTags}
      suggestions={catalog}
      {...rest}
    />
  )
}

describe("TagsField", () => {
  it("adds a tag from suggestion via Enter", async () => {
    const user = userEvent.setup()

    render(<ControlledTagsField />)

    const input = screen.getByRole("combobox", { name: "Tags" })
    await user.click(input)
    await user.type(input, "vip{Enter}")

    expect(screen.getByText("VIP")).toBeInTheDocument()
  })

  it("shows create option and adds a new tag", async () => {
    const user = userEvent.setup()

    render(<ControlledTagsField />)

    const input = screen.getByRole("combobox", { name: "Tags" })
    await user.click(input)
    await user.type(input, "Brand New")

    expect(await screen.findByText('Create "Brand New"')).toBeInTheDocument()

    await user.keyboard("{Enter}")

    expect(screen.getByText("Brand New")).toBeInTheDocument()
  })

  it("removes a tag and supports backspace on empty input", async () => {
    const user = userEvent.setup()

    render(
      <ControlledTagsField
        initialTags={[
          { id: "1", label: "alpha" },
          { id: "2", label: "beta" },
        ]}
      />
    )

    await user.click(screen.getByRole("button", { name: "Remove alpha" }))
    expect(screen.queryByText("alpha")).not.toBeInTheDocument()

    const input = screen.getByRole("combobox", { name: "Tags" })
    await user.click(input)
    await user.keyboard("{Backspace}")

    expect(screen.queryByText("beta")).not.toBeInTheDocument()
  })

  it("pastes comma-separated labels", async () => {
    const user = userEvent.setup()

    render(<ControlledTagsField suggestions={[]} />)

    const input = screen.getByRole("combobox", { name: "Tags" })
    await user.click(input)
    await user.paste("alpha, beta")

    expect(screen.getByText("alpha")).toBeInTheDocument()
    expect(screen.getByText("beta")).toBeInTheDocument()
  })

  it("prevents duplicates and respects maxTags", async () => {
    const user = userEvent.setup()

    render(
      <ControlledTagsField
        maxTags={1}
        initialTags={[{ id: "1", label: "alpha" }]}
        placeholderWhenFull="Full"
      />
    )

    expect(screen.getByPlaceholderText("Full")).toBeDisabled()

    await user.type(screen.getByRole("combobox", { name: "Tags" }), "alpha{Enter}")
    expect(screen.getAllByText("alpha")).toHaveLength(1)
  })

  it("calls onTagAdd and onTagRemove", async () => {
    const user = userEvent.setup()
    const onTagAdd = vi.fn()
    const onTagRemove = vi.fn()

    render(
      <ControlledTagsField
        onTagAdd={onTagAdd}
        onTagRemove={onTagRemove}
        initialTags={[{ id: "1", label: "alpha" }]}
      />
    )

    await user.type(screen.getByRole("combobox", { name: "Tags" }), "beta{Enter}")
    expect(onTagAdd).toHaveBeenCalledWith("Beta")

    await user.click(screen.getByRole("button", { name: "Remove alpha" }))
    expect(onTagRemove).toHaveBeenCalledWith("alpha")
  })

  it("selects suggestion from the menu", async () => {
    const user = userEvent.setup()

    render(<ControlledTagsField />)

    const input = screen.getByRole("combobox", { name: "Tags" })
    await user.click(input)
    await user.type(input, "bet")

    await user.click(await screen.findByText("Beta"))

    expect(screen.getByText("Beta")).toBeInTheDocument()
    expect(screen.queryByText("bet")).not.toBeInTheDocument()
  })

  it("does not mutate when disabled", async () => {
    const user = userEvent.setup()

    render(
      <ControlledTagsField
        disabled
        initialTags={[{ id: "1", label: "alpha" }]}
      />
    )

    expect(screen.queryByRole("button", { name: "Remove alpha" })).not.toBeInTheDocument()
    await user.type(screen.getByRole("combobox", { name: "Tags" }), "beta{Enter}")
    expect(screen.queryByText("beta")).not.toBeInTheDocument()
  })

  it("renders colored chips from tag color", () => {
    render(
      <ControlledTagsField
        initialTags={[{ id: "ctag_vip", label: "VIP", color: "#6366f1" }]}
      />
    )

    expect(screen.getByText("VIP").closest("[data-label-color]")).toHaveAttribute(
      "data-label-color",
      "#6366f1"
    )
  })
})
