import { describe, expect, it } from "vitest"
import { createDataTableSelectColumn } from "#components/data-table-select-column"

describe("createDataTableSelectColumn", () => {
  it("returns a non-sortable, non-hideable select column", () => {
    const col = createDataTableSelectColumn()
    expect(col.id).toBe("select")
    expect(col.enableSorting).toBe(false)
    expect(col.enableHiding).toBe(false)
  })
})
