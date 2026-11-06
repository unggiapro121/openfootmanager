import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import type { ShopItemView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { formatCoins } from "../../format";
import { refreshCoins, refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import ItemDialogFrame, {
  FRAME_ACTION,
  FrameButtons,
  FrameCancel,
  HeadBadge,
} from "./ItemDialogFrame";
import { lookOf } from "./itemLook";
import { capsText, effectText, groupOf, itemName, itemsErrorText } from "./itemText";
import {
  DesktopPurchaseBody,
  MOST_AT_ONCE,
  type PurchaseBody,
  PhonePurchaseBody,
  PhonePurchaseSummary,
  type Usable,
} from "./ShopPurchaseParts";

const PRICE_CHANGED = "be.error.economy.priceChanged";
const STACK_FULL = "be.error.inventory.stackFull";
const NOT_USABLE_NOW = "be.error.shop.notUsableNow";
/**
 * A purchase asked once more (C-7 C7-6): what the item does, how many, the total and the balance
 * after, and the price list it will send. No answer: sent again under the same key. A changed
 * price list or a row with less room is read again and shown; confirming it then is a new request
 * with a new key, never sent by itself. On a phone it is a sheet whose foot holds the price line,
 * what is left and the one confirm button (m-cua-hang, D-S2).
 */
export default function ShopPurchaseDialog({
  item,
  version,
  usable,
  onClose,
  onChanged,
  onDone,
}: {
  item: ShopItemView;
  version: number;
  usable: Usable;
  onClose: () => void;
  onChanged: () => void;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const held =
    useOnlineStore((state) => state.items)?.lines.find((line) => line.itemCode === item.itemCode)
      ?.total ?? 0;
  const most = Math.min(item.maxPurchase ?? MOST_AT_ONCE, MOST_AT_ONCE);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const descriptionId = useId();

  const name = itemName(t, item.itemCode);
  const group = groupOf(item.itemCode);
  const look = lookOf(item.itemCode);
  const effects = item.effect ? effectText(t, item.effect) : [];
  const caps = item.limits ? capsText(t, item.limits) : [];
  const total = quantity === null ? 0 : quantity * item.price;
  const balance = coins?.balance;
  const tooMany = quantity !== null && quantity > most;
  const tooDear = balance !== undefined && total > balance;
  const ready = quantity !== null && quantity >= 1 && !tooMany && !tooDear && !busy;
  const phone = usePhoneLayout();

  const pick = (value: number | null) => {
    setError(null);
    setQuantity(value);
  };
  const step = (by: number) => pick(Math.max(1, Math.min(most, (quantity ?? 0) + by)));

  const confirm = () => {
    if (quantity === null) return;
    setBusy(true);
    setError(null);
    run(
      (key) => tracked(() => online.shop.purchase(item.itemCode, quantity, version, key)),
      `${item.itemCode}x${quantity}@${version}`,
    )
      .then((view) => {
        useOnlineStore.setState((state) => ({
          coins: state.coins ? { ...state.coins, balance: view.coinBalance } : state.coins,
        }));
        void refreshCoins().catch(() => undefined);
        void refreshItems().catch(() => undefined);
        onDone(
          t("online.shop.bought", {
            count: view.quantity,
            item: itemName(t, view.itemCode),
            coins: formatCoins(view.coins, i18n.language),
          }),
        );
      })
      .catch((failure: unknown) => {
        setError(failure);
        if (!(failure instanceof OnlineApiError) || failure.status === 0) return;
        if (failure.code === STACK_FULL && typeof failure.params.max === "number") {
          setQuantity(failure.params.max);
        }
        void refreshCoins().catch(() => undefined);
        // The shop is read again so its card says why (a season that cannot use the item, S-17d).
        if (
          failure.code === PRICE_CHANGED ||
          failure.code === STACK_FULL ||
          failure.code === NOT_USABLE_NOW
        ) {
          onChanged();
        }
      })
      .finally(() => setBusy(false));
  };

  const body: PurchaseBody = {
    item,
    usable,
    held,
    effects,
    caps,
    descriptionId,
    quantity,
    most,
    tooMany,
    total,
    balance,
    tooDear,
    version,
    busy,
    pick,
    step,
  };

  return (
    <ItemDialogFrame
      code={item.itemCode}
      title={name}
      busy={busy}
      describedBy={descriptionId}
      onClose={onClose}
      badges={
        <HeadBadge tone={look.gold ? "gold" : "green"}>
          {t(`online.inventory.group.${group}`)}
        </HeadBadge>
      }
      footer={
        <>
          {error !== null && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 max-md:text-[13px]">
              {itemsErrorText(t, i18n.language, error)}
              {error instanceof OnlineApiError &&
                error.code === PRICE_CHANGED &&
                ` ${t("online.coins.reviewPrices")}`}
            </p>
          )}
          {phone && <PhonePurchaseSummary body={body} />}
          <FrameButtons>
            <FrameCancel onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </FrameCancel>
            <button
              type="button"
              disabled={!ready}
              onClick={confirm}
              className={`${FRAME_ACTION} max-md:h-13 max-md:text-lg`}
            >
              {t("online.shop.confirm")}
              <span className="ml-1 inline-flex items-center gap-1.5 text-xl tabular-nums text-accent-400">
                <Coins className="h-4.5 w-4.5" aria-hidden="true" />
                {formatCoins(total, i18n.language)}
              </span>
            </button>
          </FrameButtons>
        </>
      }
    >
      {phone ? <PhonePurchaseBody body={body} /> : <DesktopPurchaseBody body={body} />}
    </ItemDialogFrame>
  );
}
