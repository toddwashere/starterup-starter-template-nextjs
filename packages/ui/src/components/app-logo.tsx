import type { HTMLAttributes } from "react";

import { cn } from "#lib/utils";
import { APP_BRAND } from "#lib/app-brand";
import { AppIcon } from "#components/app-icon";

const sizeStyles = {
  sm: {
    icon: "sm" as const,
    text: "text-sm font-semibold tracking-tight",
    gap: "gap-2",
  },
  md: {
    icon: "md" as const,
    text: "text-base font-semibold tracking-tight",
    gap: "gap-2.5",
  },
  lg: {
    icon: "lg" as const,
    text: "text-xl font-semibold tracking-tight",
    gap: "gap-3",
  },
} as const;

export type AppLogoProps = HTMLAttributes<HTMLDivElement> & {
  size?: keyof typeof sizeStyles;
  /** When false, renders only the mark (same as `AppIcon`). */
  showWordmark?: boolean;
  /** Override the default brand name from `APP_BRAND`. */
  name?: string;
};

/**
 * Brand mark + wordmark. Uses `APP_BRAND` from `#lib/app-brand` by default.
 */
function AppLogo({
  size = "md",
  showWordmark = true,
  name = APP_BRAND.name,
  className,
  ...props
}: AppLogoProps) {
  const styles = sizeStyles[size];

  return (
    <div
      className={cn("flex items-center", styles.gap, className)}
      {...props}
    >
      <AppIcon size={styles.icon} title={name} />
      {showWordmark ? (
        <span className={cn("text-foreground", styles.text)}>{name}</span>
      ) : null}
    </div>
  );
}

export { AppLogo };
