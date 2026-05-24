import { describe, expect, it } from "vitest"
import type { Table } from "@tanstack/react-table"
import { getDataTableSelectedRowCount } from "#components/data-table"

function tableWithSelection(rowSelection: Record<string, boolean>) {
  return { getState: () => ({ rowSelection }) } as unknown as Table<unknown>
}

describe("getDataTableSelectedRowCount", () => {
  it("counts only truthy selection entries (across pages)", () => {
    expect(
      getDataTableSelectedRowCount(tableWithSelection({ a: true, b: false, c: true })),
    ).toBe(2)
  })

  it("returns 0 when nothing is selected", () => {
    expect(getDataTableSelectedRowCount(tableWithSelection({}))).toBe(0)
  })
})
