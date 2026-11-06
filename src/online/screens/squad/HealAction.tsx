import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HeartPulse } from "lucide-react";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import type { SquadPlayerView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import ItemDialogFrame, { HeadBadge } from "../items/ItemDialogFrame";
import QuickUseChoices from "../items/QuickUseChoices";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";

/** The items that heal an injury, the lighter first. */
const MEDKITS = ["medkitBandage", "medkitAdvanced"];

/**
 * "Heal" on an injured player's injury: the medkits held, in a dialog (a sheet on a phone), each
 * opening its use on him; none held points to the shop. Absent while the season has no item rules
 * or the items are locked, as the other item shortcuts are.
 */
export default function HealAction({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  const phone = usePhoneLayout();
  const items = useOnlineStore((state) => state.items);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!player.injury || !items?.limits || items.locked) return null;
  const title = t("online.squad.heal.action");
  const close = () => setOpen(false);

  const choices = (
    <QuickUseChoices
      codes={MEDKITS}
      player={player}
      empty={t("online.squad.heal.none")}
      onUsed={(text) => {
        setOpen(false);
        setDone(text);
      }}
    >
      <Link
        to="/online/shop"
        className={`flex min-h-10 items-center justify-center rounded text-[13px] font-semibold text-primary-700 dark:text-primary-400 ${FOCUS}`}
      >
        {t("online.player.phone.shop")}
      </Link>
    </QuickUseChoices>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setDone(null);
          setOpen(true);
        }}
        className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 text-[13px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:bg-navy-800 dark:text-red-300 dark:hover:bg-red-500/10 ${FOCUS}`}
      >
        <HeartPulse className="h-4 w-4" aria-hidden="true" />
        {title}
      </button>
      {done && (
        <p role="status" className="text-xs text-primary-700 dark:text-primary-400">
          {done}
        </p>
      )}
      {open &&
        (phone ? (
          <PhoneSheet title={title} kicker={player.fullName} onClose={close}>
            {choices}
          </PhoneSheet>
        ) : (
          <ItemDialogFrame
            icon={
              <span
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300"
              >
                <HeartPulse className="h-7 w-7" />
              </span>
            }
            title={title}
            badges={<HeadBadge tone="plain">{player.fullName}</HeadBadge>}
            onClose={close}
          >
            {choices}
          </ItemDialogFrame>
        ))}
    </div>
  );
}
