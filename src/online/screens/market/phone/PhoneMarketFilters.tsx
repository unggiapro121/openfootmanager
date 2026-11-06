import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translatePositionLabel } from "../../../../components/squad/SquadTab.helpers";
import { formatVal } from "../../../../lib/valueFormatting";
import type { AuctionView, MarketQuery } from "../../../api";
import { online } from "../../../client";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import { BIDDABLE } from "../MarketFilterPanel";
import { byName, queryOf } from "../useOpenAuctions";
import { KEY } from "./AuctionCard";

/** How the loaded page is ordered, on this phone only: the server sends them soonest-ending. */
export const SORTS = ["end", "low", "ovr", "pot"] as const;
export type MarketSort = (typeof SORTS)[number];
/** The address parameter of the order. */
export const SORT_PARAM = "sort";

export function sortOf(params: URLSearchParams): MarketSort {
  const value = params.get(SORT_PARAM);
  return (SORTS as readonly string[]).includes(value ?? "") ? (value as MarketSort) : "end";
}

const priceOf = (auction: AuctionView) => auction.currentPrice ?? auction.startPrice;

/** The auctions in the order picked; one without its player (retired) goes last. */
export function sortAuctions(items: AuctionView[], sort: MarketSort): AuctionView[] {
  const key: Record<MarketSort, (auction: AuctionView) => number> = {
    end: (auction) => Date.parse(auction.endsAt),
    low: priceOf,
    ovr: (auction) => -(auction.player?.ovr ?? -1),
    pot: (auction) => -((auction.player?.potentialStars ?? -1) * 100 + (auction.player?.ovr ?? 0)),
  };
  return [...items].sort((a, b) => key[sort](a) - key[sort](b));
}

/**
 * The sheet's ranges as address parameters. The server knows the OVR range, the oldest age and
 * the highest price; the youngest age, the lowest price and the fewest stars it does not, so
 * those narrow the loaded page here, as the name search does.
 */
const RANGES = {
  ovr: ["minOvr", "maxOvr"],
  age: ["minAge", "maxAge"],
  price: ["minPrice", "maxPrice"],
} as const;
type Range = keyof typeof RANGES;
const MIN_STARS = "minStars";

type Bounds = Record<Range, [number | null, number | null]> & { stars: number };

const whole = (value: string | null) => {
  const number = Number(value);
  return value && Number.isInteger(number) && number >= 0 ? number : null;
};

function boundsOf(params: URLSearchParams): Bounds {
  const pair = (range: Range) =>
    RANGES[range].map((name) => whole(params.get(name))) as Bounds[Range];
  return {
    ovr: pair("ovr"),
    age: pair("age"),
    price: pair("price"),
    stars: whole(params.get(MIN_STARS)) ?? 0,
  };
}

const inside = (value: number, [low, high]: [number | null, number | null]) =>
  (low === null || value >= low) && (high === null || value <= high);
const open = ([low, high]: [number | null, number | null]) => low === null && high === null;

/** Whether an auction falls in every range; one without its player only when none asks of him. */
function fits(auction: AuctionView, bounds: Bounds): boolean {
  if (!inside(priceOf(auction), bounds.price)) return false;
  const player = auction.player;
  if (!player) return open(bounds.ovr) && open(bounds.age) && bounds.stars === 0;
  return (
    inside(player.ovr, bounds.ovr) &&
    inside(player.age, bounds.age) &&
    player.potentialStars >= bounds.stars
  );
}

/** The loaded auctions the sheet's filters in the address keep. */
export function narrow(items: AuctionView[], params: URLSearchParams): AuctionView[] {
  const bounds = boundsOf(params);
  return items.filter((auction) => fits(auction, bounds));
}

/** A range as a chip reads it: `52–76`, `≥ 60`, `≤ 21`. */
function spanText([low, high]: [string | null, string | null]): string {
  if (low !== null && high !== null) return low === high ? low : `${low}–${high}`;
  return low !== null ? `≥ ${low}` : `≤ ${high}`;
}

export type ActiveFilter = { id: string; label: string; clear: Record<string, string> };

/** The sheet's filters that are on, one chip each, with what clears it. */
export function activeFilters(
  params: URLSearchParams,
  t: (key: string, options?: Record<string, unknown>) => string,
): ActiveFilter[] {
  const bounds = boundsOf(params);
  const out: ActiveFilter[] = [];
  const range = (
    id: Range,
    label: (span: string) => string,
    shown: (value: number) => string = String,
  ) => {
    const [low, high] = bounds[id];
    if (low === null && high === null) return;
    const span = spanText([low === null ? null : shown(low), high === null ? null : shown(high)]);
    const [min, max] = RANGES[id];
    out.push({ id, label: label(span), clear: { [min]: "", [max]: "" } });
  };
  range("ovr", (span) => t(`${KEY}.chip.ovr`, { span }));
  range("age", (span) => t(`${KEY}.chip.age`, { span }));
  range("price", (span) => t(`${KEY}.chip.price`, { span }), formatVal);
  if (bounds.stars > 0) {
    out.push({
      id: "stars",
      label: t(`${KEY}.chip.stars`, { count: bounds.stars }),
      clear: { [MIN_STARS]: "" },
    });
  }
  if (params.get(BIDDABLE) === "true") {
    out.push({ id: BIDDABLE, label: t(`${KEY}.chip.hideCap`), clear: { [BIDDABLE]: "" } });
  }
  const natural = params.get("naturalPosition");
  if (natural) {
    out.push({
      id: "naturalPosition",
      label: translatePositionLabel(t, natural),
      clear: { naturalPosition: "" },
    });
  }
  return out;
}

/** What clears every filter of the sheet, the order and the position group kept. */
const CLEAR_ALL: Record<string, string> = Object.fromEntries(
  [...Object.values(RANGES).flat(), MIN_STARS, BIDDABLE, "naturalPosition"].map((name) => [
    name,
    "",
  ]),
);

/** The filters that are on, as chips under the position groups: a tap drops one. */
export function ActiveFilterChips({
  filters,
  onClear,
}: {
  filters: ActiveFilter[];
  onClear: (patch: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  if (filters.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t(`${KEY}.activeFilters`)}
      className="-mx-4 -mt-1 flex gap-1.5 overflow-x-auto px-4 pb-0.5"
    >
      {filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          aria-label={t(`${KEY}.removeFilter`, { label: filter.label })}
          onClick={() => onClear(filter.clear)}
          className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border border-primary-500 bg-primary-50 pl-2.5 pr-2 text-xs font-semibold text-primary-800 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-300 ${FOCUS}`}
        >
          {filter.label}
          <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => onClear(CLEAR_ALL)}
        className={`h-[30px] shrink-0 rounded px-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 ${FOCUS}`}
      >
        {t(`${KEY}.clearAll`)}
      </button>
    </div>
  );
}

/** As many auctions as the sheet reads to count what its draft would show. */
const POOL_LIMIT = 200;
/** A million euros: the price boxes take millions. */
const MILLION = 1_000_000;

type Draft = Record<Range, [string, string]> & {
  stars: number;
  sort: MarketSort;
  biddable: boolean;
};

const EMPTY: Draft = {
  ovr: ["", ""],
  age: ["", ""],
  price: ["", ""],
  stars: 0,
  sort: "end",
  biddable: false,
};

/** A number as typed: digits, and for a price one decimal mark, `,` or `.`. */
const parse = (text: string) => {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
};

/** The presets under each range: their label and the from–to they set. */
const PRESETS: Record<Range, [string, string, string][]> = {
  ovr: [
    ["60+", "60", ""],
    ["70+", "70", ""],
    ["75+", "75", ""],
  ],
  age: [
    ["≤ 21", "", "21"],
    ["22–29", "22", "29"],
    ["≥ 30", "30", ""],
  ],
  price: [
    ["≤ 1", "", "1"],
    ["≤ 2", "", "2"],
    ["≤ 4", "", "4"],
  ],
};

/** The open auctions of the coach's position group, for the sheet's count and its hints. */
function usePool(params: URLSearchParams, biddable: boolean) {
  const { position, naturalPosition } = queryOf(params);
  const [pool, setPool] = useState<{ items: AuctionView[]; whole: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    setPool(null);
    const query: MarketQuery = { limit: POOL_LIMIT };
    if (position) query.position = position;
    if (naturalPosition) query.naturalPosition = naturalPosition;
    if (biddable) query.biddable = true;
    online.market
      .auctions(query)
      .then((page) => live && setPool({ items: page.items, whole: !page.nextCursor }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [position, naturalPosition, biddable]);
  return pool;
}

/** The highest OVR the coach's level lets him buy, when it has one. */
function usePlayerCap() {
  const [cap, setCap] = useState<number | undefined>();
  useEffect(() => {
    let live = true;
    online.me
      .career()
      .then((career) => live && setCap(career.caps?.playerCap))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return cap;
}

const LABEL = "text-xs font-semibold uppercase tracking-wider";
const labelTone = (on: boolean) =>
  on ? "text-primary-700 dark:text-primary-300" : "text-gray-500 dark:text-gray-400";
const pill = (on: boolean) =>
  on
    ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300"
    : "border-gray-200 text-gray-600 dark:border-navy-600 dark:text-gray-300";

function RangeField({
  label,
  hint,
  decimal,
  value,
  placeholders,
  presets,
  onChange,
}: {
  label: string;
  hint: string | null;
  decimal: boolean;
  value: [string, string];
  placeholders: [string, string];
  presets: [string, string, string][];
  onChange: (value: [string, string]) => void;
}) {
  const { t } = useTranslation();
  const [low, high] = value.map(parse);
  const wrong = low !== null && high !== null && low > high;
  const clean = (text: string) => text.replace(decimal ? /[^0-9.,]/g : /\D/g, "").slice(0, 6);
  const box = (side: 0 | 1) => {
    const set = value[side] !== "";
    return (
      <input
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        aria-label={t(side === 0 ? `${KEY}.from` : `${KEY}.to`, { label })}
        aria-invalid={wrong}
        placeholder={placeholders[side]}
        value={value[side]}
        onChange={(event) => {
          const next: [string, string] = [...value];
          next[side] = clean(event.target.value);
          onChange(next);
        }}
        className={`h-11 w-full rounded-[10px] border bg-gray-50 px-2.5 text-center text-base font-semibold tabular-nums text-gray-900 placeholder:font-medium placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/60 dark:bg-navy-900 dark:text-white dark:placeholder:text-gray-500 ${wrong ? "border-red-400" : set ? "border-primary-500" : "border-gray-200 dark:border-navy-600"}`}
      />
    );
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{label}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_76px_10px_76px] items-center gap-1.5">
        <span className="flex min-w-0 flex-col gap-px">
          <span aria-hidden="true" className={`${LABEL} ${labelTone(value.some(Boolean))}`}>
            {label}
          </span>
          {hint && (
            <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>
          )}
        </span>
        {box(0)}
        <span aria-hidden="true" className="text-center text-gray-400">
          –
        </span>
        {box(1)}
      </div>
      {wrong && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {t(`${KEY}.rangeError`)}
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([text, from, to]) => {
          const on = value[0] === from && value[1] === to;
          return (
            <button
              key={text}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? ["", ""] : [from, to])}
              className={`h-[30px] rounded-full border px-2.5 text-xs font-semibold ${pill(on)} ${FOCUS}`}
            >
              {text}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The fewest potential stars, as five stars: a tap on the one picked clears it. */
function StarsPicker({ stars, onChange }: { stars: number; onChange: (stars: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2.5">
      <span aria-hidden="true" className={`${LABEL} ${labelTone(stars > 0)}`}>
        {t(`${KEY}.minStars`)}
      </span>
      <div role="radiogroup" aria-label={t(`${KEY}.minStars`)} className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={stars === star}
            aria-label={t(`${KEY}.starsUp`, { count: star })}
            onClick={() => onChange(stars === star ? 0 : star)}
            className={`h-9 w-[34px] rounded text-[22px] leading-none ${star <= stars ? "text-accent-400" : "text-gray-300 dark:text-navy-600"} ${FOCUS}`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

/** The order of the list, as one segmented row. */
function SortPicker({
  sort,
  onChange,
}: {
  sort: MarketSort;
  onChange: (sort: MarketSort) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <span aria-hidden="true" className={`${LABEL} text-gray-500 dark:text-gray-400`}>
        {t(`${KEY}.sortBy`)}
      </span>
      <div
        role="radiogroup"
        aria-label={t(`${KEY}.sortBy`)}
        className="grid grid-cols-4 rounded-[10px] border border-gray-200 bg-gray-100 p-[3px] dark:border-navy-600 dark:bg-navy-900"
      >
        {SORTS.map((one) => {
          const on = sort === one;
          return (
            <button
              key={one}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(`${KEY}.sort.${one}`)}
              onClick={() => onChange(one)}
              className={`h-[38px] rounded-lg px-0.5 text-xs font-bold leading-tight ${on ? "bg-white text-gray-900 shadow-sm dark:bg-navy-600 dark:text-white" : "text-gray-600 dark:text-gray-300"} ${FOCUS}`}
            >
              {t(`${KEY}.sortShort.${one}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The switch that hides the players over the level caps, naming the player cap when there is one. */
function CapSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation();
  const cap = usePlayerCap();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-left dark:border-navy-600 dark:bg-navy-900 ${FOCUS}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {t(`${KEY}.hideCap`)}
        </span>
        <span className="text-xs leading-snug text-gray-500 dark:text-gray-400">
          {cap === undefined ? t(`${KEY}.hideCapHint`) : t(`${KEY}.hideCapHintCap`, { cap })}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`flex h-[26px] w-11 shrink-0 rounded-full p-0.5 transition-colors motion-reduce:transition-none ${on ? "justify-end bg-primary-500" : "justify-start bg-gray-300 dark:bg-gray-600"}`}
      >
        <span className="h-[22px] w-[22px] rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}

/**
 * The filter sheet (design m-cho): OVR, age and price each as a from–to with presets and what
 * the market holds now, the fewest stars, the order, and the switch that hides the players over
 * the level caps. It works on a draft and counts what the draft would show; Apply sets the address.
 */
export function MarketFilterSheet({
  params,
  search,
  onApply,
  onClose,
}: {
  params: URLSearchParams;
  /** The name search, which the count heeds as the list does. */
  search: string;
  onApply: (patch: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const millions = (euros: number) =>
    (euros / MILLION).toLocaleString(i18n.language, {
      maximumFractionDigits: 2,
      useGrouping: false,
    });
  const [draft, setDraft] = useState<Draft>(() => {
    const bounds = boundsOf(params);
    const text = (number: number | null, shown: (number: number) => string = String) =>
      number === null ? "" : shown(number);
    return {
      ovr: [text(bounds.ovr[0]), text(bounds.ovr[1])],
      age: [text(bounds.age[0]), text(bounds.age[1])],
      price: [text(bounds.price[0], millions), text(bounds.price[1], millions)],
      stars: bounds.stars,
      sort: sortOf(params),
      biddable: params.get(BIDDABLE) === "true",
    };
  });
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const pool = usePool(params, draft.biddable);

  const wholeText = (text: string) => {
    const number = parse(text);
    return number === null ? "" : String(Math.round(number));
  };
  const euros = (text: string) => {
    const number = parse(text);
    return number === null ? "" : String(Math.round(number * MILLION));
  };
  const patch: Record<string, string> = {
    minOvr: wholeText(draft.ovr[0]),
    maxOvr: wholeText(draft.ovr[1]),
    minAge: wholeText(draft.age[0]),
    maxAge: wholeText(draft.age[1]),
    minPrice: euros(draft.price[0]),
    maxPrice: euros(draft.price[1]),
    [MIN_STARS]: draft.stars ? String(draft.stars) : "",
    [SORT_PARAM]: draft.sort === "end" ? "" : draft.sort,
    [BIDDABLE]: draft.biddable ? "true" : "",
  };
  const wrong = (Object.keys(RANGES) as Range[]).some((range) => {
    const [low, high] = draft[range].map(parse);
    return low !== null && high !== null && low > high;
  });
  const draftBounds = boundsOf(new URLSearchParams(Object.entries(patch).filter(([, v]) => v)));
  const count =
    !pool || wrong
      ? null
      : byName(pool.items, search).filter((auction) => fits(auction, draftBounds)).length;

  /** What the market holds now on each range, the hint beside it and the boxes' placeholders. */
  const spread = (value: (auction: AuctionView) => number | undefined) => {
    const values = (pool?.items ?? []).map(value).filter((v): v is number => v !== undefined);
    return values.length ? [Math.min(...values), Math.max(...values)] : null;
  };
  const held: Record<Range, [string, string] | null> = {
    ovr: spread((auction) => auction.player?.ovr)?.map(String) as [string, string] | null,
    age: spread((auction) => auction.player?.age)?.map(String) as [string, string] | null,
    price: (() => {
      const span = spread(priceOf);
      if (!span) return null;
      const tenth = MILLION / 10;
      return [
        millions(Math.floor(span[0] / tenth) * tenth),
        millions(Math.ceil(span[1] / tenth) * tenth),
      ];
    })(),
  };

  const none = count === 0 && pool?.whole === true;
  const applyLabel = wrong
    ? t(`${KEY}.checkRanges`)
    : none
      ? t(`${KEY}.showNone`)
      : count === null || count === 0
        ? t(`${KEY}.apply`)
        : pool?.whole
          ? t(`${KEY}.show`, { count })
          : t(`${KEY}.showAtLeast`, { count });
  const blocked = wrong || none;

  return (
    <PhoneSheet
      title={t("online.market.filters")}
      aside={
        <button
          type="button"
          onClick={() => setDraft(EMPTY)}
          className={`rounded px-1 text-[13px] font-semibold text-primary-700 dark:text-primary-400 ${FOCUS}`}
        >
          {t(`${KEY}.reset`)}
        </button>
      }
      onClose={onClose}
    >
      {(Object.keys(RANGES) as Range[]).map((range) => {
        const span = held[range];
        return (
          <RangeField
            key={range}
            label={t(`${KEY}.field.${range}`)}
            hint={span ? t(`${KEY}.marketHas`, { span: spanText(span) }) : null}
            decimal={range === "price"}
            value={draft[range]}
            placeholders={span ?? ["", ""]}
            presets={PRESETS[range]}
            onChange={(value) => set({ [range]: value })}
          />
        );
      })}

      <StarsPicker stars={draft.stars} onChange={(stars) => set({ stars })} />
      <SortPicker sort={draft.sort} onChange={(sort) => set({ sort })} />
      <CapSwitch on={draft.biddable} onChange={(biddable) => set({ biddable })} />

      <div className="sticky bottom-0 -mx-4 bg-white px-4 pt-1 dark:bg-navy-800">
        <button
          type="button"
          disabled={blocked}
          onClick={() => onApply(patch)}
          className={`h-[50px] w-full rounded-xl font-heading text-[17px] font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50 ${blocked ? "bg-gray-200 text-gray-600 dark:bg-navy-600 dark:text-gray-300" : "bg-primary-700 text-white dark:bg-primary-600"} ${FOCUS}`}
        >
          {applyLabel}
        </button>
      </div>
    </PhoneSheet>
  );
}
