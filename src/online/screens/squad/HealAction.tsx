import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HeartPulse } from "lucide-react";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import type { SquadPlayerView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import ItemDialogFrame, { HeadBadge } from "../items/ItemDialogFrame";
import { ItemIcon } from "../items/itemLook";
import { itemDescription, itemName } from "../items/itemText";
import UseItemDialog from "../items/UseItemDialog";
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
  const [using, setUsing] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!player.injury || !items?.limits || items.locked) return null;
  const held = MEDKITS.map((code) => ({
    code,
    total: items.lines.find((line) => line.itemCode === code)?.total ?? 0,
  })).filter((entry) => entry.total > 0);
  const title = t("online.squad.heal.action");
  const close = () => setOpen(false);

  const choices = (
    <div className="flex flex-col gap-2.5">
      {held.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.squad.heal.none")}</p>
      )}
      {held.map(({ code, total }) => (
        <button
          key={code}
          type="button"
          onClick={() => {
            setOpen(false);
            setUsing(code);
          }}
          className={`flex min-h-16 items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-left hover:border-primary-400 dark:border-navy-600 dark:bg-navy-800 dark:hover:border-primary-600 ${FOCUS}`}
        >
          <ItemIcon code={code} size="md" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-bold text-gray-900 dark:text-white">
              {itemName(t, code)}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {itemDescription(t, code)}
            </span>
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
              {t("online.player.phone.held", { count: total })}
            </span>
          </span>
          <span className="inline-flex h-[34px] shrink-0 items-center rounded-lg bg-primary-700 px-3 text-[13px] font-bold text-white dark:bg-primary-600">
            {t("online.items.confirmUse")}
          </span>
        </button>
      ))}
      <Link
        to="/online/shop"
        className={`flex min-h-10 items-center justify-center rounded text-[13px] font-semibold text-primary-700 dark:text-primary-400 ${FOCUS}`}
      >
        {t("online.player.phone.shop")}
      </Link>
    </div>
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
      {using && (
        <UseItemDialog
          code={using}
          initialTarget={{ kind: "player", playerId: player.id }}
          lockTarget
          onClose={() => setUsing(null)}
          onDone={(text) => {
            setUsing(null);
            setDone(text);
          }}
        />
      )}
    </div>
  );
}
