import type { SVGProps } from "react";

import { cn } from "#lib/utils";
import { APP_BRAND } from "#lib/app-brand";

const sizeClass = {
  sm: "size-6",
  md: "size-8",
  lg: "size-10",
} as const;

export type AppIconProps = SVGProps<SVGSVGElement> & {
  size?: keyof typeof sizeClass;
  title?: string;
};

/**
 * Brand mark only. Customize the SVG paths (or swap the implementation) when
 * adopting the template — keep `APP_BRAND.name` in sync via `#lib/app-brand`.
 */
function AppIcon({
  size = "md",
  title = APP_BRAND.name,
  className,
  ...props
}: AppIconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={cn(sizeClass[size], "shrink-0", className)}
      {...props}
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      {/* Ascending bars — “starter up” mark; replace when branding the product. */}
      <path
        className="fill-primary-foreground"
        d="M8 22h3.25v-6.5H8V22Zm6.375 0h3.25V10h-3.25v12Zm6.375 0H24V7.5h-3.25V22Z"
      />
    </svg>
  );
}

export { AppIcon };
