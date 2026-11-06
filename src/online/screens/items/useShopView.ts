import { useEffect, useState } from "react";
import type { ShopView } from "../../api";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";

/** The shop, read once while `wanted`; `null` until it is read or when it cannot be. */
export function useShopView(wanted: boolean): ShopView | null {
  const [shop, setShop] = useState<ShopView | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    tracked(() => online.shop.view())
      .then((view) => {
        if (live) setShop(view);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wanted]);
  return shop;
}
