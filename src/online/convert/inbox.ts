import type { TFunction } from "i18next";
import { resolveInjuryName } from "../../lib/injury";
import { formatCount, formatExactMoney } from "../../lib/valueFormatting";
import type { MessageAction, MessageData } from "../../store/types";
import type { InboxMessageView, LevelRange } from "../api";
import {
  lapsedReasonText,
  type MissionWords,
  missionText,
  themeName,
} from "../screens/events/eventText";
import { facilityName } from "../screens/facilities/facilityText";
import { awardName, awardValue } from "../screens/honours/honoursText";
import { itemName } from "../screens/items/itemText";
import { reportHref } from "../screens/opponent/report/reportParts";

/** The offline inbox's category each kind of message is shown under (its icon and colour). */
const CATEGORY: Record<string, string> = {
  "market.won": "Transfer",
  "market.sold": "Transfer",
  "market.outbid": "Transfer",
  "market.unsold": "Transfer",
  "market.cancelled": "Transfer",
  "market.forced": "Finance",
  "match.preview": "MatchPreview",
  "match.result": "MatchResult",
  "squad.injury": "Injury",
  "squad.recovered": "Injury",
  "squad.exhausted": "Training",
  "squad.unhappy": "PlayerMorale",
  "squad.bench": "PlayerMorale",
  "squad.happy": "PlayerMorale",
  "season.result": "LeagueInfo",
  "season.promoted": "LeagueInfo",
  "season.reward": "Finance",
  // The season's sponsorship and TV rights at the club's level (S-36, C-14).
  "season.sponsor": "Finance",
  // Forced up by the club's strength at the season's end (S-16c, C-7a2).
  "season.forcedPromotion": "LeagueInfo",
  // The trophy room (S-42, C-20): a title won, and a player's award of the season.
  "season.champion": "LeagueInfo",
  "season.award": "LeagueInfo",
  "licence.fitted": "BoardDirective",
  // The nightly item audit locked or unlocked the coach's items (S-17 §3.11, C-7b).
  "account.itemsLocked": "BoardDirective",
  "account.itemsUnlocked": "BoardDirective",
  // A SuperAdmin gave or took back items, or refunded a purchase, with the reason (S-17d, C-7b2).
  "account.itemsGranted": "BoardDirective",
  "account.itemsRevoked": "BoardDirective",
  "account.purchaseRefunded": "Finance",
  // The academy (S-18, C-7c): under the scouting category the offline inbox already has.
  "academy.scoutDone": "ScoutReport",
  "academy.graduated": "ScoutReport",
  "academy.graduationDeferred": "ScoutReport",
  // The scouting report on the next opponent (S-47b, C-24b): back, or paid back.
  "opponentReport.ready": "ScoutReport",
  "opponentReport.refunded": "ScoutReport",
  // Events (S-19, C-7d): under the system category, no new one (C-7 C7-58).
  "event.completed": "System",
  "event.claimed": "System",
  "event.lapsed": "System",
  "event.claimReminder": "System",
  // The facilities (S-49b/c, C-27d): a build done is the board's news, a sold-out ground money.
  "facility.completed": "BoardDirective",
  "stadium.soldOut": "Finance",
};

/** Who signs a kind of message other than the club office (c-27 §7.3). */
const SENDER: Record<string, string> = {
  "facility.completed": "online.inbox.senders.grounds",
  "stadium.soldOut": "online.inbox.senders.boxOffice",
};

/**
 * The own sentence of an auction cancelled for the level caps or for its player gone (C-7 C7-11),
 * by who reads it: the club left out (it has the level it needs), the seller whose player is up
 * again or not yet. Any other reason, or none, is the plain body.
 */
function cancelledBody(params: Record<string, unknown>): string {
  if (params.reason === "playerGone") return "playerGone";
  if (params.reason !== "buyCapExceeded") return "body";
  if (params.requiredLevel !== undefined) return "capClub";
  return text(params.relistedAuctionId) === undefined ? "capSeller" : "capRelisted";
}

/** A way out of a message to a page of the online mode (the inbox's own navigate action). */
const goTo = (id: string, label: string, route: string): MessageAction => ({
  id,
  label,
  action_type: { NavigateTo: { route } },
  resolved: false,
});

/** The mission an event mail names, with its event's theme. */
export type EventMission = MissionWords & { theme: string };

const levelsOf = (value: unknown): LevelRange | undefined => {
  const range = value as { from?: unknown; to?: unknown } | null | undefined;
  return typeof range?.from === "number" && typeof range.to === "number"
    ? { from: range.from, to: range.to }
    : undefined;
};

/**
 * The mission an event mail is about (C-7 C7-58): from the mail's own parameters, else from the
 * events the store holds, else none, and the mail says "a mission".
 */
function mailMission(
  params: Record<string, unknown>,
  eventMission: (eventId: string, code: string) => EventMission | undefined,
): EventMission | undefined {
  if (typeof params.kind === "string" && typeof params.target === "number") {
    return {
      kind: params.kind,
      target: params.target,
      levels: levelsOf(params.levels),
      theme: typeof params.theme === "string" ? params.theme : "",
    };
  }
  const eventId = text(params.eventId);
  const code = text(params.missionCode);
  return eventId && code ? eventMission(eventId, code) : undefined;
}

/** Why a scouting report was paid back (S-47 §4.5); any other reason is the plain body. */
const REFUND_REASONS = new Set(["void", "late", "disabled"]);

/** Kinds that have their own words; any other is shown as a plain notice. */
const KINDS = new Set(Object.keys(CATEGORY));

const text = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;

const count = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * One inbox message as the offline inbox's panes read a message (the list, the detail), with its
 * words written here from the kind and its parameters, in the player's language. A message offers
 * no choices: the online inbox only tells, and at most opens a page it points to. `youngsterName`
 * names an academy youngster a mail gives only by id; `eventMission` an event's mission a mail
 * gives only by its codes.
 */
export function toMessageData(
  message: InboxMessageView,
  t: TFunction,
  clubName: string,
  youngsterName: (id: string) => string | undefined = () => undefined,
  eventMission: (eventId: string, code: string) => EventMission | undefined = () => undefined,
): MessageData {
  const kind = KINDS.has(message.kind) ? message.kind : "other";
  const params = message.params as Record<string, unknown>;
  const price = text(params.price);
  const base = `online.inbox.kinds.${kind}`;
  let options: Record<string, string | number> = {
    player: text(params.playerName) ?? t("online.inbox.aPlayer"),
    price: price === undefined ? "" : formatExactMoney(Number(price)),
  };
  let bodyKey = `${base}.body`;
  let fixtureId: string | null = null;
  let reason: string | undefined;
  const actions: MessageAction[] = [];

  if (kind === "match.result") {
    const scored = count(params.scored);
    const conceded = count(params.conceded);
    const home = count(params.home) === 1;
    const opponent = text(params.opponent) ?? "";
    options = {
      round: count(params.round),
      home: home ? clubName : opponent,
      away: home ? opponent : clubName,
      homeGoals: home ? scored : conceded,
      awayGoals: home ? conceded : scored,
      opponent,
      scored,
      conceded,
    };
    bodyKey = `${base}.${scored > conceded ? "won" : scored === conceded ? "drawn" : "lost"}`;
    fixtureId = text(params.fixtureId) ?? null;
  } else if (kind === "match.preview") {
    const home = count(params.home) === 1;
    const opponent = text(params.opponent) ?? "";
    const kickoff = new Date(String(params.kickoffAt));
    options = {
      round: count(params.round),
      home: home ? clubName : opponent,
      away: home ? opponent : clubName,
      opponent,
      time: Number.isNaN(kickoff.getTime())
        ? ""
        : kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    bodyKey = `${base}.${home ? "home" : "away"}`;
    fixtureId = text(params.fixtureId) ?? null;
  } else if (kind === "squad.injury") {
    options = {
      player: text(params.playerName) ?? t("online.inbox.aPlayer"),
      injury: resolveInjuryName(text(params.injury) ?? "", t),
      days: count(params.days),
    };
  } else if (kind === "squad.recovered") {
    options = { player: text(params.playerName) ?? t("online.inbox.aPlayer") };
  } else if (kind.startsWith("squad.")) {
    options = {
      count: count(params.count),
      critical: count(params.critical),
      names: text(params.names) ?? "",
    };
  } else if (kind === "market.cancelled") {
    bodyKey = `${base}.${cancelledBody(params)}`;
    options.level = count(params.requiredLevel);
    const relisted = text(params.relistedAuctionId);
    if (bodyKey.endsWith(".capRelisted") && relisted) {
      actions.push(goTo("open", t("online.inbox.viewNewAuction"), `/online/auctions/${relisted}`));
    }
  } else if (kind === "season.forcedPromotion") {
    options = {
      season: count(params.season),
      levels: count(params.levels),
      level: count(params.level),
    };
    // A short squad's mail says why it was forced though it bought within the caps (R16-9).
    options.extra =
      count(params.shortSquad) === 1
        ? ` ${t(`${base}.shortSquad`, { squadSize: count(params.squadSize) })}`
        : "";
    actions.push(goTo("caps", t("online.inbox.viewCaps"), "/online/profile"));
  } else if (kind === "season.promoted") {
    options = { season: count(params.season), level: count(params.level) };
  } else if (kind === "season.champion") {
    options = {
      season: count(params.season),
      level: count(params.level),
      league: text(params.leagueName) ?? "",
    };
    actions.push(goTo("honours", t("online.honours.open"), "/online/honours"));
  } else if (kind === "season.award") {
    const award = text(params.award) ?? "";
    options = {
      season: count(params.season),
      player: text(params.playerName) ?? t("online.inbox.aPlayer"),
      award: awardName(t, award),
      value: awardValue(t, award, count(params.value)),
    };
    actions.push(goTo("honours", t("online.honours.open"), "/online/honours"));
  } else if (kind === "season.reward") {
    options = { rank: count(params.rank), amount: formatExactMoney(count(params.amount)) };
  } else if (kind === "season.sponsor") {
    // A club that went up a level is also told last season's sponsorship (S36-7).
    const previous = params.previousSponsorSeason;
    options = {
      season: count(params.season),
      level: count(params.level),
      sponsor: formatExactMoney(count(params.sponsorSeason)),
      tv: formatExactMoney(count(params.tvPerMatch)),
      extra:
        previous === undefined
          ? ""
          : ` ${t(`${base}.previous`, { amount: formatExactMoney(count(previous)) })}`,
    };
  } else if (kind === "season.result") {
    options = { season: count(params.season), rank: count(params.rank) };
    bodyKey = `${base}.${count(params.promoted) === 1 ? "promoted" : "stayed"}`;
  } else if (kind === "licence.fitted") {
    options = { season: count(params.season) };
  } else if (kind === "academy.graduated") {
    options = { player: text(params.playerName) ?? t("online.inbox.aPlayer") };
    // Each flag adds its own sentence after the body (0 or 1, as the server writes them).
    const extra = [
      count(params.overSquadMax) === 1 ? t(`${base}.overSquadMax`) : "",
      count(params.feeWaived) === 1 ? t(`${base}.feeWaived`) : "",
    ].filter(Boolean);
    if (extra.length > 0) options.extra = ` ${extra.join(" ")}`;
    else options.extra = "";
  } else if (kind === "event.claimReminder") {
    const until = new Date(String(params.claimUntil));
    options = {
      theme: themeName(t, text(params.theme)),
      until: Number.isNaN(until.getTime())
        ? ""
        : until.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
    };
  } else if (kind.startsWith("event.")) {
    const mission = mailMission(params, eventMission);
    options = {
      theme: themeName(t, mission?.theme || text(params.theme)),
      mission: mission ? missionText(t, mission) : "",
      reason: lapsedReasonText(t, text(params.reason) ?? "unavailable"),
    };
    if (!mission) bodyKey = `${base}.bodyUnnamed`;
  } else if (
    kind === "account.itemsGranted" ||
    kind === "account.itemsRevoked" ||
    kind === "account.purchaseRefunded"
  ) {
    const expires = new Date(String(params.expiresAt));
    options = {
      item: itemName(t, text(params.itemCode) ?? ""),
      count: count(params.quantity),
      coins: count(params.coins),
      extra:
        kind === "account.itemsGranted" && !Number.isNaN(expires.getTime())
          ? ` ${t(`${base}.expires`, {
              until: expires.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
            })}`
          : "",
    };
    // The SuperAdmin's own words, as they were typed: plain text on its own line (Qs17d-1).
    reason = text(params.reason)?.trim() || undefined;
    actions.push(
      kind === "account.purchaseRefunded"
        ? goTo("wallet", t("online.shop.toWallet"), "/online/coins")
        : goTo("inventory", t("online.shop.openInventory"), "/online/inventory"),
    );
  } else if (kind === "opponentReport.ready" || kind === "opponentReport.refunded") {
    const reportId = text(params.reportId);
    fixtureId = text(params.fixtureId) ?? null;
    if (kind === "opponentReport.refunded") {
      const why = text(params.reason);
      bodyKey = `${base}.${why && REFUND_REASONS.has(why) ? why : "body"}`;
    }
    if (reportId)
      actions.push(goTo("report", t("online.opponentReport.open"), reportHref(reportId)));
    const opponent = text(params.opponentClubId);
    if (kind === "opponentReport.ready" && opponent && fixtureId) {
      actions.push(
        goTo(
          "opponent",
          t("online.opponent.open"),
          `/online/clubs/${opponent}/opponent?fixture=${fixtureId}`,
        ),
      );
    }
  } else if (kind === "facility.completed") {
    options = {
      facility: facilityName(t, text(params.facility) ?? ""),
      level: count(params.level),
    };
    actions.push(goTo("facilities", t("online.inbox.openFacilities"), "/online/facilities"));
  } else if (kind === "stadium.soldOut") {
    fixtureId = text(params.fixtureId) ?? null;
    options = {
      opponent: text(params.opponentShortName) ?? "",
      attendance: formatCount(count(params.attendance)),
      capacity: formatCount(count(params.capacity)),
      lockedOut: formatCount(count(params.lockedOut)),
    };
    // The stands' card, which the facilities screen scrolls to (its `#stands`).
    actions.push(goTo("stands", t("online.inbox.openStands"), "/online/facilities#stands"));
  } else if (kind === "academy.graduationDeferred") {
    // The mail names no one: the academy the store holds may (PO bản 4).
    const id = text(params.playerId);
    options = {
      player: (id && youngsterName(id)) || t("online.academy.aYoungster"),
      fee: formatExactMoney(count(params.fee)),
    };
  }

  return {
    id: message.id,
    subject: t(`${base}.subject`, options),
    body:
      t(bodyKey, options) +
      (reason === undefined ? "" : `\n${t("online.inbox.reasonLine", { reason })}`),
    sender: t(SENDER[kind] ?? "online.inbox.sender"),
    sender_role: "",
    date: message.createdAt,
    read: message.read,
    category: CATEGORY[kind] ?? "System",
    priority: "Normal",
    actions,
    context: {
      team_id: null,
      player_id: null,
      fixture_id: fixtureId,
      match_result: null,
    },
  };
}
