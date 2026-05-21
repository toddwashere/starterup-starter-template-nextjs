# Date Formatting Convention

Always use `formatDate()` from `@workspace/common` when displaying any date or timestamp in UI code.

**Never use raw JS date methods in component code:**
- ❌ `new Date(x).toLocaleString()`
- ❌ `new Date(x).toLocaleDateString()`
- ❌ `new Date(x).toLocaleTimeString()`

**Use formatDate instead:**
- `formatDate(date)` → "May 18, 2026"
- `formatDate(date, { includeTime: true })` → "May 18, 2026, 10:49 PM"
- `formatDate(date, { relative: true })` → "3 days ago" / "just now" / "in 2 days"

**Import:**
```ts
import { formatDate } from "@workspace/common";
// or subpath:
import { formatDate } from "@workspace/common/format-date";
```

Apply `relative: true` for activity feeds, notes, and timestamps where recency matters. Use the default absolute format for due dates, scheduled dates, and any date the user might need to look up on a calendar.
