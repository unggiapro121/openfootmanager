import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NegotiationFeedbackPanel, {
  type NegotiationFeedbackPanelData,
} from "./NegotiationFeedbackPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "common.reputationDiscountApplied") {
        return `Reputation: -${String(params?.pct)}%`;
      }
      return key;
    },
  }),
}));

function feedback(params?: Record<string, string>): NegotiationFeedbackPanelData {
  return {
    mood: "calm",
    headline_key: "headline",
    tension: 20,
    patience: 80,
    round: 1,
    params,
  };
}

function renderPanel(data: NegotiationFeedbackPanelData) {
  return render(
    <NegotiationFeedbackPanel
      feedback={data}
      titleKey="title"
      roundKey="round"
      patienceKey="patience"
      tensionKey="tension"
    />,
  );
}

describe("NegotiationFeedbackPanel", () => {
  it("says when the manager's reputation lowered the player's ask", () => {
    renderPanel(feedback({ reputationDiscountPct: "7.5" }));

    expect(screen.getByText("Reputation: -7.5%")).toBeInTheDocument();
  });

  it("says nothing about reputation when it lowered nothing", () => {
    renderPanel(feedback());

    expect(screen.queryByText(/Reputation:/)).not.toBeInTheDocument();
  });
});
