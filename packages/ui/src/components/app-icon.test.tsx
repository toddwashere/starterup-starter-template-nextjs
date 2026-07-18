import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppIcon } from "#components/app-icon";
import { APP_BRAND } from "#lib/app-brand";

describe("AppIcon", () => {
  it("renders an accessible brand mark", () => {
    render(<AppIcon />);
    expect(
      screen.getByRole("img", { name: APP_BRAND.name }),
    ).toBeInTheDocument();
  });
});
