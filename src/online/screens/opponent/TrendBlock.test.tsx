import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import cs from "../../../i18n/locales/cs.json";
import de from "../../../i18n/locales/de.json";
import en from "../../../i18n/locales/en.json";
import es from "../../../i18n/locales/es.json";
import fr from "../../../i18n/locales/fr.json";
import id from "../../../i18n/locales/id.json";
import it_ from "../../../i18n/locales/it.json";
import ptBR from "../../../i18n/locales/pt-BR.json";
import pt from "../../../i18n/locales/pt.json";
import ru from "../../../i18n/locales/ru.json";
import tr from "../../../i18n/locales/tr.json";
import vi_ from "../../../i18n/locales/vi.json";
import zhCN from "../../../i18n/locales/zh-CN.json";
import { trendView } from "./opponentTestData";
import { TrendBlock } from "./TrendBlock";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

const NO_GOALS = { ...trendView().team.goalsBySource };

describe("the trend block (C-23b)", () => {
  // Given a trend over 4 matches with figures for both sides,
  // when the block is drawn,
  // then the team table gives each figure for "them" and "their opponents", per match.
  it("lists the team's figures for both sides", () => {
    render(
      <TrendBlock
        trend={trendView(
          { possessionPct: 54.2, shots: 12.4, shotsOnTarget: 4.1, corners: 5, passAccuracy: 81.5 },
          { possessionPct: 45.8, shots: 8, shotsOnTarget: 2.5, corners: 3.3, passAccuracy: 74 },
          4,
        )}
      />,
    );

    expect(screen.getByText("online.opponent.trend.note")).toBeVisible();
    const table = screen.getByRole("table", { name: "online.opponent.trend.teamTitle" });
    const row = (name: string) => within(table).getByRole("row", { name: new RegExp(name) });
    expect(within(row("possession")).getByText("online.opponent.trend.percent:54.2")).toBeVisible();
    expect(within(row("possession")).getByText("online.opponent.trend.percent:45.8")).toBeVisible();
    expect(
      within(row("shots")).getByText("online.opponent.trend.shotsValue:12.4|4.1"),
    ).toBeVisible();
    expect(within(row("corners")).getByText("3.3")).toBeVisible();
    expect(within(row("passAccuracy")).getByText("online.opponent.trend.percent:74")).toBeVisible();
  });

  // Given a trend whose pass accuracy the server did not send,
  // when the block is drawn, then there is no pass-accuracy row.
  it("leaves out the pass accuracy when it is missing", () => {
    render(<TrendBlock trend={trendView({}, {})} />);

    const table = screen.getByRole("table", { name: "online.opponent.trend.teamTitle" });
    expect(within(table).queryByText("online.opponent.trend.figure.passAccuracy")).toBeNull();
    expect(within(table).getByText("online.opponent.trend.figure.fouls")).toBeVisible();
  });

  // Given a club that scored from open play only, and conceded nothing,
  // when the block is drawn, then only that source has a row; with no goal at all, a line says so.
  it("lists only the goal sources with a goal, or says there was none", () => {
    const { unmount } = render(
      <TrendBlock trend={trendView({ goalsBySource: { ...NO_GOALS, openPlay: 6 } })} />,
    );
    const goals = screen.getByRole("table", { name: "online.opponent.trend.goalsTitle" });
    expect(within(goals).getByText("online.opponent.trend.source.openPlay")).toBeVisible();
    expect(within(goals).queryByText("online.opponent.trend.source.corner")).toBeNull();
    expect(within(goals).getAllByRole("row")).toHaveLength(2);
    unmount();

    render(<TrendBlock trend={trendView()} />);
    expect(screen.queryByRole("table", { name: "online.opponent.trend.goalsTitle" })).toBeNull();
    expect(screen.getByText("online.opponent.trend.noGoals")).toBeVisible();
  });

  // Given a club that attacks down the left and is attacked through the centre,
  // when the block is drawn, then each side's three lanes are drawn with their share;
  // a side with all three at 0 draws no bars.
  it("draws the lane bars, and none for a side without any", () => {
    const { unmount } = render(
      <TrendBlock
        trend={trendView(
          { finalThirdLanes: { left: 50, centre: 30, right: 20 } },
          { finalThirdLanes: { left: 25, centre: 50, right: 25 } },
        )}
      />,
    );
    const attack = screen.getByRole("group", { name: "online.opponent.trend.attacking" });
    expect(within(attack).getAllByRole("meter")).toHaveLength(3);
    expect(
      within(attack).getByRole("meter", { name: "online.opponent.trend.lane.left" }),
    ).toHaveAttribute("aria-valuenow", "50");
    expect(
      within(screen.getByRole("group", { name: "online.opponent.trend.attacked" })).getByRole(
        "meter",
        { name: "online.opponent.trend.lane.centre" },
      ),
    ).toHaveAttribute("aria-valuenow", "50");
    unmount();

    render(
      <TrendBlock trend={trendView({ finalThirdLanes: { left: 40, centre: 40, right: 20 } })} />,
    );
    expect(screen.getByRole("group", { name: "online.opponent.trend.attacking" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "online.opponent.trend.attacked" })).toBeNull();
  });

  // Given a club that plays long balls and whose opponents get caught offside,
  // when the block is drawn, then each behaviour seen reads "X/match" for both sides,
  // and a behaviour nobody showed has no row.
  it("lists the observed play per match, without the behaviours nobody showed", () => {
    render(<TrendBlock trend={trendView({ longBalls: 7.3 }, { offsides: 1.4 })} />);

    const style = screen.getByRole("table", { name: "online.opponent.trend.styleTitle" });
    const longBalls = within(style).getByRole("row", { name: /behaviour\.longBalls/ });
    expect(within(longBalls).getByText("online.opponent.trend.perMatch:7.3")).toBeVisible();
    expect(within(longBalls).getByText("online.opponent.trend.perMatch:0")).toBeVisible();
    expect(within(style).getByText("online.opponent.trend.behaviour.offsides")).toBeVisible();
    expect(within(style).queryByText("online.opponent.trend.behaviour.counters")).toBeNull();
  });
});

type Tree = { [key: string]: string | Tree };

function strings(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === "string" ? [value] : strings(value),
  );
}

const LOCALES: Record<string, Tree> = {
  cs,
  de,
  en,
  es,
  fr,
  id,
  it: it_,
  "pt-BR": ptBR,
  pt,
  ru,
  tr,
  vi: vi_,
  "zh-CN": zhCN,
};

describe("the trend's labels (BR-6)", () => {
  // Given every locale's tactics dial names (Build-up Style, Width, Tempo…),
  // when the trend block's texts are read, then none of them names a dial: a label says what was
  // seen on the pitch, never what the coach set.
  it.each(Object.keys(LOCALES))("names no tactics dial in %s", (locale) => {
    const tree = LOCALES[locale] as Tree;
    const settings = (tree.tactics as Tree).phaseSettings as Tree;
    const dials = Object.entries(settings)
      .filter(([key]) => !key.includes("_"))
      .map(([, name]) => String(name).toLocaleLowerCase(locale));
    const trend = ((tree.online as Tree).opponent as Tree).trend as Tree;
    const labels = strings(trend).map((label) => label.toLocaleLowerCase(locale));

    expect(dials.length).toBeGreaterThan(5);
    for (const label of labels) {
      for (const dial of dials) expect(label, `"${label}" names "${dial}"`).not.toContain(dial);
    }
  });
});
