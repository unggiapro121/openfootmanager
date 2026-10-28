import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import OnlineSidebar from "./OnlineSidebar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

describe("OnlineSidebar", () => {
  /**
   * Given a window shorter than the sidebar's fifteen entries, when the
   * sidebar is drawn, then its entry list scrolls inside the screen-high
   * panel instead of spilling below its background and scrolling the page.
   */
  it("scrolls its entry list inside the panel", () => {
    render(
      <MemoryRouter initialEntries={["/online"]}>
        <OnlineSidebar />
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "online.nav.label" });
    expect(nav).toHaveClass("min-h-0", "overflow-y-auto");
  });
});
