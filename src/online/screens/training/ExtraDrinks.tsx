import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import type { ExtraDayView, ShopItemView, SquadPlayerView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import ItemDialogFrame, { HeadBadge } from "../items/ItemDialogFrame";
import { usableOf } from "../items/OnlineShop";
import QuickUseChoices from "../items/QuickUseChoices";
import ShopPurchaseDialog from "../items/ShopPurchaseDialog";
import { useShopView } from "../items/useShopView";
import { PhoneSheet } from "../mobile/PhoneSheet";
import { useDrinksBatch } from "./ExtraDrinksBatch";
import type { DrinkOffer, RestingPlayer } from "./ExtraLists";
import type { useExtraSession } from "./useExtraSession";

const DRINKS = ["energyDrinkSmall", "energyDrinkLarge"];
const KEY = "online.training.extra";

/**
 * The energy drinks of the extra panel and the phone's extra page (C-17a C17-3…C17-7): whether
 * a row offers them, how many are held for the title, a player's drinks one tap each (a sheet on
 * a phone, a dialog over the panel), a drink bought there and then, and the line telling what
 * the last one did. A player given one is chosen to train. Today's cap dims a row's drinks
 * (C17-13), and the rest list offers drinks for all its tired players at once (C17-12). While
 * anything here is open, the panel leaves Escape and Tab to it (`open`).
 */
export function useExtraDrinks({
  session,
  phone,
  extra,
  rest,
  restOpen,
}: {
  session: ReturnType<typeof useExtraSession>;
  phone: boolean;
  extra: ExtraDayView;
  rest: RestingPlayer[];
  /** The rest list is the one shown. */
  restOpen: boolean;
}) {
  const { t } = useTranslation();
  const items = useOnlineStore((state) => state.items);
  const players = useOnlineStore((state) => state.club?.players ?? []);
  const season = useOnlineStore((state) => state.season);
  const [forId, setForId] = useState<string | null>(null);
  const [buying, setBuying] = useState<{ item: ShopItemView; version: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const usable = Boolean(items?.limits) && !items?.locked;
  const heldOf = (code: string) => items?.lines.find((line) => line.itemCode === code)?.total ?? 0;
  const small = heldOf("energyDrinkSmall");
  const large = heldOf("energyDrinkLarge");
  // None held: drinks are still offered while the shop sells one (Qc17-1). The shop also
  // tells the smallest drink, which today's cap is checked against.
  const shop = useShopView(usable && (small + large === 0 || extra.drinks !== undefined));
  const sold =
    shop?.priceListVersion !== undefined &&
    shop.items.some((item) => DRINKS.includes(item.itemCode));
  const offered = usable && (small + large > 0 || sold);
  const amounts = (shop?.items ?? [])
    .filter((item) => DRINKS.includes(item.itemCode))
    .map((item) => item.effect?.condition)
    .filter((amount): amount is number => amount !== undefined);
  const smallest = amounts.length > 0 ? Math.min(...amounts) : undefined;
  const spent = new Map((extra.drinks?.used ?? []).map((line) => [line.playerId, line.points]));
  const player = players.find((candidate) => candidate.id === forId) ?? null;

  // A press tells its own result: the drink's line goes.
  useEffect(() => {
    if (session.result) setDone(null);
  }, [session.result]);

  const close = () => {
    setForId(null);
    const back = opener.current;
    opener.current = null;
    queueMicrotask(() => back?.focus());
  };
  const onDrink = (chosen: SquadPlayerView) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDone(null);
    setForId(chosen.id);
  };
  const capped = (chosen: SquadPlayerView) =>
    extra.drinks !== undefined &&
    smallest !== undefined &&
    extra.drinks.pointsPerDay - (spent.get(chosen.id) ?? 0) < smallest;
  const batch = useDrinksBatch({
    session,
    extra,
    rest,
    wanted: offered && restOpen && !session.sending,
    phone,
    onDone: setDone,
  });
  const used = (text: string) => {
    if (player) session.include(player.id);
    setDone(text);
    close();
  };

  const choices = player && (
    <QuickUseChoices
      codes={DRINKS}
      player={player}
      onUsed={used}
      onBuy={(item, version) => setBuying({ item, version })}
    />
  );
  let layer: ReactNode = null;
  if (buying) {
    layer = (
      <ShopPurchaseDialog
        item={buying.item}
        version={buying.version}
        usable={usableOf("condition", season)}
        onClose={() => setBuying(null)}
        onChanged={() => setBuying(null)}
        onDone={() => setBuying(null)}
      />
    );
  } else if (player && phone) {
    layer = (
      <PhoneSheet
        title={t(`${KEY}.drink.title`)}
        kicker={player.matchName}
        aside={t("online.player.phone.now", { value: Math.round(player.condition) })}
        onClose={close}
      >
        {choices}
      </PhoneSheet>
    );
  } else if (player) {
    layer = (
      <ItemDialogFrame
        icon={
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300"
          >
            <Zap className="h-7 w-7" />
          </span>
        }
        title={t(`${KEY}.drink.title`)}
        badges={
          <HeadBadge tone="plain">
            {`${player.matchName} · ${t("online.player.phone.now", { value: Math.round(player.condition) })}`}
          </HeadBadge>
        }
        onClose={close}
      >
        {choices}
      </ItemDialogFrame>
    );
  } else {
    layer = batch.layer;
  }
  const offer: DrinkOffer | undefined = offered ? { open: onDrink, capped } : undefined;

  return {
    offer,
    /** The rest list's button giving drinks to all its tired players. */
    batch: offered ? batch.button : null,
    /** The drinks held, for the title's line; null while none are offered. */
    held: offered ? t(`${KEY}.drinksHeld`, { small, large }) : null,
    status: done && (
      <p
        role="status"
        className="rounded-[10px] bg-primary-50 px-3 py-2 text-[13px] text-primary-800 dark:bg-primary-900/30 dark:text-primary-300"
      >
        {done}
      </p>
    ),
    layer,
    open: forId !== null || buying !== null || batch.open,
  };
}
