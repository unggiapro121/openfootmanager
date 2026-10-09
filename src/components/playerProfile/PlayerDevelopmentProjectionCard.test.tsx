import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PlayerProjection } from "../../store/types";
import PlayerDevelopmentProjectionCard from "./PlayerDevelopmentProjectionCard";

/** Echoes keys, with their options, so a test can read what was asked for. */
const t = (key: string, options?: Record<string, string | number>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

const projection: PlayerProjection = {
  player_id: "p1",
  assessor: { staff_id: "s1", name: "Ann Scout", role: "Scout" },
  estimate: {
    prospect_id: "p1",
    ovr_low: 58,
    ovr_high: 58,
    ovr_band: 0,
    potential_low: 74,
    potential_high: 86,
    potential_band: 8,
  },
  wonderkid: false,
  projection: {
    points: [
      { season: 0, age: 17, low: 58, expected: 58, high: 58 },
      { season: 1, age: 18, low: 61, expected: 62, high: 63 },
      { season: 2, age: 19, low: 64, expected: 66, high: 67 },
      { season: 3, age: 20, low: 67, expected: 69, high: 71 },
      { season: 4, age: 21, low: 70, expected: 73, high: 75 },
    ],
    peak_expected: 80,
    peak_age: 24,
  },
  reference: { playing_time: 67, match_form: 70, coaching: "Club" },
};

describe("PlayerDevelopmentProjectionCard", () => {
  it("shows the read ceiling, the next three seasons and the expected peak", () => {
    render(<PlayerDevelopmentProjectionCard projection={projection} error={null} t={t} />);

    expect(screen.getByText("74–86")).toBeInTheDocument();
    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.getByText("61–63")).toBeInTheDocument();
    expect(screen.getByText("69")).toBeInTheDocument();
    expect(screen.queryByText("73")).not.toBeInTheDocument();
    expect(
      screen.getByText('playerProfile.projection.peakValue {"ovr":80,"age":24}'),
    ).toBeInTheDocument();
  });

  it("names who made the read and the conditions the forecast assumes", () => {
    render(<PlayerDevelopmentProjectionCard projection={projection} error={null} t={t} />);

    expect(
      screen.getByText('playerProfile.projection.assessedBy {"name":"Ann Scout"}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('playerProfile.projection.assumptions {"rating":"7.0"}'),
    ).toBeInTheDocument();
    expect(screen.getByText("playerProfile.projection.coachingClub")).toBeInTheDocument();
    expect(screen.getByText("playerProfile.projection.disclaimer")).toBeInTheDocument();
  });

  it("assumes average coaching for a player the club does not coach", () => {
    render(
      <PlayerDevelopmentProjectionCard
        projection={{
          ...projection,
          assessor: null,
          reference: { ...projection.reference, coaching: "Standard" },
        }}
        error={null}
        t={t}
      />,
    );

    expect(screen.getByText("playerProfile.projection.coachingStandard")).toBeInTheDocument();
    expect(screen.queryByText(/assessedBy/)).not.toBeInTheDocument();
  });

  it("says nobody can assess the club's players when it has no scout or assistant", () => {
    render(
      <PlayerDevelopmentProjectionCard
        projection={null}
        error="be.error.projection.noAssessor"
        t={t}
      />,
    );

    expect(screen.getByText("playerProfile.projection.title")).toBeInTheDocument();
    expect(screen.getByText("playerProfile.projection.noAssessor")).toBeInTheDocument();
  });

  it("shows nothing while waiting or for a player the club has not assessed", () => {
    const { container: waiting } = render(
      <PlayerDevelopmentProjectionCard projection={null} error={null} t={t} />,
    );
    const { container: stranger } = render(
      <PlayerDevelopmentProjectionCard
        projection={null}
        error="be.error.projection.notAssessed"
        t={t}
      />,
    );

    expect(waiting).toBeEmptyDOMElement();
    expect(stranger).toBeEmptyDOMElement();
  });
});
