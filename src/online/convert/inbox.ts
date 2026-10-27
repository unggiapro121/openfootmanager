import type { TFunction } from "i18next";
import { formatExactMoney } from "../../lib/valueFormatting";
import type { MessageData } from "../../store/types";
import type { InboxMessageView } from "../api";

/** The offline inbox's category each kind of message is shown under (its icon and colour). */
const CATEGORY: Record<string, string> = {
  "market.won": "Transfer",
  "market.sold": "Transfer",
  "market.outbid": "Transfer",
  "market.unsold": "Transfer",
  "market.cancelled": "Transfer",
  "market.forced": "Finance",
  "match.result": "MatchResult",
  "season.result": "LeagueInfo",
  "licence.fitted": "BoardDirective",
};

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
 * words written here from the kind and its parameters, in the player's language. A message names
 * no actions: the online inbox only tells.
 */
export function toMessageData(
  message: InboxMessageView,
  t: TFunction,
  clubName: string,
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
  } else if (kind === "season.result") {
    options = { season: count(params.season), rank: count(params.rank) };
    bodyKey = `${base}.${count(params.promoted) === 1 ? "promoted" : "stayed"}`;
  } else if (kind === "licence.fitted") {
    options = { season: count(params.season) };
  }

  return {
    id: message.id,
    subject: t(`${base}.subject`, options),
    body: t(bodyKey, options),
    sender: t("online.inbox.sender"),
    sender_role: "",
    date: message.createdAt,
    read: message.read,
    category: CATEGORY[kind] ?? "System",
    priority: "Normal",
    actions: [],
    context: {
      team_id: null,
      player_id: null,
      fixture_id: fixtureId,
      match_result: null,
    },
  };
}
