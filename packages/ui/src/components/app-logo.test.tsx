import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppLogo } from "#components/app-logo";
import { APP_BRAND } from "#lib/app-brand";

describe("AppLogo", () => {
  it("renders the brand icon and wordmark", () => {
    render(<AppLogo />);
    expect(
      screen.getByRole("img", { name: APP_BRAND.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(APP_BRAND.name)).toBeInTheDocument();
  });

  it("can hide the wordmark", () => {
    render(<AppLogo showWordmark={false} />);
    expect(screen.queryByText(APP_BRAND.name)).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: APP_BRAND.name }),
    ).toBeInTheDocument();
  });

  it("allows overriding the displayed name", () => {
    render(<AppLogo name="Acme" />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});
