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
});
