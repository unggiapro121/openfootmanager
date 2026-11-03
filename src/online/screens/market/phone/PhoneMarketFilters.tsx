import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatVal } from "../../../../lib/valueFormatting";
import type { AuctionView } from "../../../api";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import { BIDDABLE } from "../MarketFilterPanel";
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

/** The filters the sheet sets, all but the position group (the chips above the list hold it). */
const SHEET_FILTERS = ["minOvr", "maxOvr", "maxPrice", "maxAge", "naturalPosition", BIDDABLE];

/** How many of the sheet's filters are on, for the badge on its button. */
export function sheetFiltersOn(params: URLSearchParams): number {
  return SHEET_FILTERS.filter((name) => params.get(name)).length;
}

type Draft = {
  minOvr: string;
  maxPrice: string;
  maxAge: string;
  sort: MarketSort;
  biddable: boolean;
};

const OVR_STEPS = ["60", "65", "70"];
const PRICE_STEPS = ["1000000", "2000000", "4000000"];
const AGE_STEPS = ["21", "25", "29"];

function Choices({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p
        aria-hidden="true"
        className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
      >
        {label}
      </p>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-1.5">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(option.value)}
              className={`min-h-10 rounded-[10px] border px-1 text-[13px] font-semibold ${on ? "border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-900/40 dark:text-white" : "border-gray-200 bg-white text-gray-700 dark:border-navy-700 dark:bg-navy-900 dark:text-gray-200"} ${FOCUS}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The filter sheet (design m-cho): OVR from, highest price, oldest age, the order, and the switch
 * that hides the players over the level caps. It works on a draft; Apply sets the address.
 */
export function MarketFilterSheet({
  params,
  onApply,
  onClose,
}: {
  params: URLSearchParams;
  onApply: (patch: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>({
    minOvr: params.get("minOvr") ?? "",
    maxPrice: params.get("maxPrice") ?? "",
    maxAge: params.get("maxAge") ?? "",
    sort: sortOf(params),
    biddable: params.get(BIDDABLE) === "true",
  });
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const all = { value: "", label: t(`${KEY}.all`) };

  return (
    <PhoneSheet
      title={t("online.market.filters")}
      aside={
        <button
          type="button"
          onClick={() =>
            setDraft({ minOvr: "", maxPrice: "", maxAge: "", sort: "end", biddable: false })
          }
          className={`rounded font-semibold text-primary-700 dark:text-primary-400 ${FOCUS}`}
        >
          {t(`${KEY}.reset`)}
        </button>
      }
      onClose={onClose}
    >
      <Choices
        label={t("online.market.filter.minOvr")}
        options={[all, ...OVR_STEPS.map((value) => ({ value, label: `${value}+` }))]}
        value={draft.minOvr}
        onChange={(minOvr) => set({ minOvr })}
      />
      <Choices
        label={t("online.market.price")}
        options={[
          all,
          ...PRICE_STEPS.map((value) => ({
            value,
            label: t(`${KEY}.upTo`, { price: formatVal(Number(value)) }),
          })),
        ]}
        value={draft.maxPrice}
        onChange={(maxPrice) => set({ maxPrice })}
      />
      <Choices
        label={t("online.market.filter.maxAge")}
        options={[all, ...AGE_STEPS.map((value) => ({ value, label: `≤ ${value}` }))]}
        value={draft.maxAge}
        onChange={(maxAge) => set({ maxAge })}
      />
      <Choices
        label={t(`${KEY}.sortBy`)}
        options={SORTS.map((value) => ({ value, label: t(`${KEY}.sort.${value}`) }))}
        value={draft.sort}
        onChange={(sort) => set({ sort: sort as MarketSort })}
      />
      <label className="flex items-start gap-3 rounded-[10px] border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 dark:border-navy-700 dark:bg-navy-900 dark:text-gray-200">
        <input
          type="checkbox"
          checked={draft.biddable}
          onChange={(event) => set({ biddable: event.target.checked })}
          className="mt-0.5 h-5 w-5 shrink-0 accent-primary-600"
        />
        <span>
          {t("online.market.filter.biddable")}
          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
            {t("online.market.filter.biddableHint")}
          </span>
        </span>
      </label>
      <button
        type="button"
        onClick={() =>
          onApply({
            minOvr: draft.minOvr,
            maxPrice: draft.maxPrice,
            maxAge: draft.maxAge,
            [SORT_PARAM]: draft.sort === "end" ? "" : draft.sort,
            [BIDDABLE]: draft.biddable ? "true" : "",
          })
        }
        className={`h-12 rounded-xl bg-primary-700 font-heading text-base font-bold uppercase tracking-wider text-white dark:bg-primary-600 ${FOCUS}`}
      >
        {t(`${KEY}.apply`)}
      </button>
    </PhoneSheet>
  );
}
