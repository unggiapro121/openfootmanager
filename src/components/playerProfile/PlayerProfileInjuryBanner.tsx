import { AlertTriangle } from "lucide-react";
import { resolvePlayerInjuryName } from "./PlayerProfile.helpers";
import { Card, CardBody } from "../ui";
import type { TOptions } from "i18next";
import type { ReactNode } from "react";

type TranslateFn = (key: string, options?: TOptions) => string;

interface PlayerProfileInjuryBannerProps {
  injury: {
    name: string;
    days_remaining: number;
  };
  t: TranslateFn;
  /** A control beside the injury, e.g. the online game's way to heal it. */
  action?: ReactNode;
}

export default function PlayerProfileInjuryBanner({
  injury,
  t,
  action,
}: PlayerProfileInjuryBannerProps) {
  return (
    <Card accent="danger" className="mb-5">
      <CardBody>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 rounded-lg bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-red-600 dark:text-red-400">
              {resolvePlayerInjuryName(injury.name, t)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("playerProfile.daysRemaining", {
                count: injury.days_remaining,
              })}
            </p>
          </div>
          {action}
        </div>
      </CardBody>
    </Card>
  );
}
