import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ItemPreviewView, ShopItemView, SquadPlayerView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { FOCUS } from "../mobile/PhoneSheet";
import { ItemIcon } from "./itemLook";
import { itemCodeText, itemName, itemsErrorText } from "./itemText";
import { effectLines, limitLines, usedText } from "./itemUseText";
import { buyBlocker } from "./OnlineShop";
import { useApplyItem } from "./useApplyItem";
import { useShopView } from "./useShopView";

const ROW = `flex min-h-16 w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-left hover:border-primary-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 dark:border-navy-600 dark:bg-navy-800 dark:hover:border-primary-600 dark:disabled:hover:border-navy-600 ${FOCUS}`;
const PILL =
  "inline-flex h-[34px] shrink-0 items-center rounded-lg bg-primary-700 px-3 text-[13px] font-bold text-white dark:bg-primary-600";

/** A preview per item, read when the choices open and again after each use or refusal. */
function usePreviews(codes: string[], playerId: string, asked: number) {
  const [previews, setPreviews] = useState<Record<string, ItemPreviewView | "failed">>({});
  const key = codes.join(",");
  useEffect(() => {
    let live = true;
    setPreviews({});
    for (const code of key ? key.split(",") : []) {
      tracked(() => online.items.preview(code, { kind: "player", playerId }))
        .then((view) => {
          if (live) setPreviews((shown) => ({ ...shown, [code]: view }));
        })
        .catch(() => {
          if (live) setPreviews((shown) => ({ ...shown, [code]: "failed" }));
        });
    }
    return () => {
      live = false;
    };
  }, [key, playerId, asked]);
  return previews;
}

/**
 * The items of `codes` that can help a player, one tap each (C-17 C17-2): each one held shows
 * what the server's preview says it would do to him, and a tap uses it at once, the preview
 * being the confirmation; one the server would refuse is dimmed with why. With `onBuy`, an item
 * not held that the shop sells is offered at its price instead.
 */
export default function QuickUseChoices({
  codes,
  player,
  onUsed,
  onBuy,
  empty,
  children,
}: {
  codes: string[];
  player: SquadPlayerView;
  onUsed: (text: string) => void;
  onBuy?: (item: ShopItemView, version: number) => void;
  /** What the choices say when there is nothing to use or buy. */
  empty?: string;
  /** Below the choices, e.g. a way to the shop. */
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const items = useOnlineStore((state) => state.items);
  const coins = useOnlineStore((state) => state.coins);
  const players = useOnlineStore((state) => state.club?.players ?? []);
  const { apply, busy } = useApplyItem();
  const [asked, setAsked] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const held = codes.map((code) => ({
    code,
    total: items?.lines.find((line) => line.itemCode === code)?.total ?? 0,
  }));
  const heldCodes = held.filter((entry) => entry.total > 0).map((entry) => entry.code);
  const previews = usePreviews(heldCodes, player.id, asked);
  const shop = useShopView(onBuy !== undefined);
  const version = shop?.priceListVersion;
  const offers =
    onBuy && version !== undefined
      ? held
          .filter((entry) => entry.total === 0)
          .map((entry) => shop?.items.find((item) => item.itemCode === entry.code))
          .filter((item): item is ShopItemView => item !== undefined)
      : [];

  const use = (code: string) => {
    setError(null);
    apply(code, { kind: "player", playerId: player.id })
      .then((view) => onUsed(usedText(t, code, view.effect, players)))
      .catch((failure: unknown) => {
        setError(failure);
        if (failure instanceof OnlineApiError && failure.status !== 0) setAsked((n) => n + 1);
      });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {heldCodes.length === 0 && offers.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {empty ?? t("online.items.quick.none")}
        </p>
      )}
      {held
        .filter((entry) => entry.total > 0)
        .map(({ code, total }) => {
          const preview = previews[code];
          const view = preview === "failed" ? undefined : preview;
          const refusal = view?.refusal;
          const effect = view?.effect;
          const change =
            effect?.kind === "condition" && effect.players[0]
              ? [
                  t("online.items.quick.change", {
                    before: effect.players[0].before,
                    after: effect.players[0].after,
                  }),
                ]
              : effect
                ? effectLines(t, effect, players)
                : [];
          return (
            <button
              key={code}
              type="button"
              disabled={busy || view === undefined || refusal !== undefined}
              aria-busy={busy}
              onClick={() => use(code)}
              className={ROW}
            >
              <ItemIcon code={code} size="md" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-bold text-gray-900 dark:text-white">
                  {itemName(t, code)}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("online.player.phone.held", { count: total })}
                </span>
                {change.map((line) => (
                  <span
                    key={line}
                    className="text-[13px] font-semibold text-primary-700 dark:text-primary-400"
                  >
                    {line}
                  </span>
                ))}
                {view &&
                  limitLines(t, i18n.language, view.limits).map((line) => (
                    <span key={line} className="text-[11px] text-gray-500 dark:text-gray-400">
                      {line}
                    </span>
                  ))}
                {refusal && (
                  <span className="text-xs text-red-600 dark:text-red-400">
                    {itemCodeText(t, i18n.language, refusal.code, refusal.params)}
                  </span>
                )}
                {preview === "failed" && (
                  <span className="text-xs text-red-600 dark:text-red-400">
                    {t("online.items.quick.failed")}
                  </span>
                )}
              </span>
              <span className={PILL}>{t("online.items.confirmUse")}</span>
            </button>
          );
        })}
      {version !== undefined &&
        offers.map((item) => {
          const blocker = buyBlocker(t, item, coins, items);
          return (
            <button
              key={item.itemCode}
              type="button"
              disabled={busy || blocker !== null}
              onClick={() => onBuy?.(item, version)}
              className={ROW}
            >
              <ItemIcon code={item.itemCode} size="md" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-bold text-gray-900 dark:text-white">
                  {itemName(t, item.itemCode)}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {blocker ?? t("online.player.phone.held", { count: 0 })}
                </span>
              </span>
              <span className={PILL}>{t("online.items.quick.buy", { price: item.price })}</span>
            </button>
          );
        })}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {itemsErrorText(t, i18n.language, error)}
        </p>
      )}
      {children}
    </div>
  );
}
