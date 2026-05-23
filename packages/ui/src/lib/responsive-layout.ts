/** Tailwind breakpoint helpers for consistent responsive layouts across apps. */
export const responsiveLayout = {
  /** Hide below md (768px). */
  hideBelowMd: "hidden md:contents",
  hideBelowMdBlock: "hidden md:block",
  hideBelowMdTableCell: "hidden md:table-cell",
  hideBelowLgTableCell: "hidden lg:table-cell",
  /** Show only below md. */
  showBelowMd: "md:hidden",
  showBelowMdBlock: "block md:hidden",
  /** Page body padding. */
  pageBodyPadding: "p-4 sm:p-6",
} as const
