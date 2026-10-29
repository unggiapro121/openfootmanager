import type { LucideIcon } from "lucide-react";
import { Coins } from "lucide-react";
import type { RewardView } from "../../api";
import { lookOf } from "../items/itemLook";

/** A reward's icon: coins, or the item's own (the shop's look). */
export function rewardIcon(reward: RewardView | undefined): LucideIcon {
  if (!reward || reward.coin !== undefined) return Coins;
  return lookOf(reward.item ?? "").icon;
}
