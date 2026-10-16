import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TraitBadge } from "./TraitBadge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "traits.Speedster.label": "Velocista",
        "traits.Speedster.desc": "Explosivo",
        "traits.HotHead.label": "Temperamental",
        "traits.HotHead.desc": "Juega al límite",
        "traits.Wonderkid.label": "Joya",
        "traits.Wonderkid.desc": "Talento especial",
        "common.attributes.pace": "Ritmo",
        "common.attributes.aggression": "Agresividad",
        "common.attributes.composure": "Compostura",
        "youthAcademy.age": "Edad",
        "traits.Wonderkid.scoutedPotential": "Potencial estimado",
        "youthAcademy.growth": "Crecimiento",
        "traits.ShootsFromDistance.label": "Dispara de lejos",
        "traits.ShootsFromDistance.desc": "Lo intenta desde cualquier distancia",
        "common.posAbbr.Goalkeeper": "GK",
      };

      return translations[key] ?? key;
    },
  }),
}));

describe("TraitBadge", () => {
  // Given a trait shown as its icon alone, then its name is not printed, and it
  // moves into the tooltip ahead of the description.
  it("names the trait in the tooltip when only its icon is shown", () => {
    render(<TraitBadge trait="Speedster" iconOnly />);

    expect(screen.queryByText("Velocista")).toBeNull();
    expect(screen.getByRole("img", { name: "Velocista: Explosivo | Ritmo 85+" })).toHaveAttribute(
      "title",
      "Velocista: Explosivo | Ritmo 85+",
    );
  });

  it("uses translated labels for minimum-threshold requirements in the tooltip", () => {
    render(<TraitBadge trait="Speedster" />);

    expect(screen.getByLabelText("Explosivo | Ritmo 85+")).toBeInTheDocument();
  });

  it("uses numeric operators instead of embedded English phrases", () => {
    render(<TraitBadge trait="HotHead" />);

    expect(
      screen.getByLabelText("Juega al límite | Agresividad 85+, Compostura < 50"),
    ).toBeInTheDocument();
  });

  // The badge is the club's judgement, so its rule names the scouted ceiling,
  // never the true one.
  it("uses translated non-attribute labels for wonderkid requirements", () => {
    render(<TraitBadge trait="Wonderkid" />);

    expect(
      screen.getByLabelText(
        "Talento especial | Edad <= 20, Potencial estimado 90+, Crecimiento 14+",
      ),
    ).toBeInTheDocument();
  });

  // Each attribute-computed trait in phase 2 shows the thresholds the backend checks.
  it.each([
    ["LongPasser", "common.attributes.long_passing 80+, common.attributes.vision 70+"],
    ["Crosser", "common.attributes.crossing 80+"],
    [
      "Curler",
      "common.attributes.curve 80+, (common.attributes.shooting 70+ / common.attributes.long_shots 70+)",
    ],
    ["LongShooter", "common.attributes.long_shots 80+"],
    ["PowerHeader", "common.attributes.heading 80+, common.attributes.aerial 70+"],
    ["PressResistant", "common.attributes.first_touch 80+, Compostura 75+"],
    ["DeadBallSpecialist", "common.attributes.free_kick 80+, common.attributes.curve 75+"],
    ["TikiTaka", "common.attributes.passing 85+, common.attributes.teamwork 75+"],
  ])("lists the requirements of %s", (trait, requirements) => {
    render(<TraitBadge trait={trait} />);

    expect(screen.getByText(`traits.${trait}.label`)).toBeInTheDocument();
    expect(screen.getByLabelText(`traits.${trait}.desc | ${requirements}`)).toBeInTheDocument();
  });

  // Outfielders and goalkeepers earn it on different rules; the tooltip shows both.
  it("shows the outfield and the goalkeeper rule for aerial dominance", () => {
    render(<TraitBadge trait="AerialDominance" />);

    expect(
      screen.getByLabelText(
        "traits.AerialDominance.desc | common.attributes.aerial 88+, common.attributes.strength 80+ | GK: common.attributes.aerial 85+",
      ),
    ).toBeInTheDocument();
  });

  // A habit rolled once, not earned from attributes: no requirement to show.
  it("shows a habit trait with its description alone", () => {
    render(<TraitBadge trait="ShootsFromDistance" />);

    expect(screen.getByText("Dispara de lejos")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Lo intenta desde cualquier distancia" }),
    ).toBeInTheDocument();
  });

  // Merged into DeadBallSpecialist; an old name renders nothing rather than a raw key.
  it("renders nothing for the retired set-piece specialist trait", () => {
    const { container } = render(<TraitBadge trait="SetPieceSpecialist" />);

    expect(container).toBeEmptyDOMElement();
  });
});
