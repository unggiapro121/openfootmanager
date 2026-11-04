import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Crosshair,
  Gavel,
  Globe,
  ImageIcon,
  PenLine,
  Shirt,
  UserMinus,
} from "lucide-react";
import { countryName } from "../../../lib/countries";
import type { SquadPlayerView } from "../../api";
import { refreshMarket, useOnlineStore } from "../../store/onlineStore";
import ListingDialog from "../market/ListingDialog";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";
import RenamePlayerDialog from "../RenamePlayerDialog";
import PlayerAvatarPicker from "./PlayerAvatarPicker";
import PlayerNationalityDialog from "./PlayerNationalityDialog";
import ReleaseDialog from "./ReleaseDialog";
import ShirtNumberPicker from "./ShirtNumberPicker";

const KEY = "online.squad.phone";

type Action = "list" | "release" | "shirt" | "avatar" | "nationality" | "rename";

const ROW = `flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-navy-700 ${FOCUS}`;
const ICON = {
  plain:
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300",
  danger:
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};
const GROUP =
  "px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400";

function RowBody({
  icon,
  label,
  sub,
  danger,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <>
      <span className={danger ? ICON.danger : ICON.plain} aria-hidden="true">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`text-[15px] font-semibold ${danger ? "text-red-700 dark:text-red-300" : "text-gray-900 dark:text-white"}`}
        >
          {label}
        </span>
        {sub && <span className="truncate text-xs text-gray-500 dark:text-gray-400">{sub}</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
    </>
  );
}

function Row(props: {
  icon: ReactNode;
  label: string;
  sub?: string;
  danger?: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button type="button" onClick={props.onPick} className={ROW}>
        <RowBody {...props} />
      </button>
    </li>
  );
}

/**
 * What can be done with one of the club's players on a phone (designs m-doi-hinh, m-cau-thu): a
 * sheet of the full profile's actions in two groups, transfer (put up for auction, release) and
 * his own look (shirt number, picture, nationality, name), then the tactics; the dialog of the one
 * picked opens over it. A player up for auction leads to his auction instead, and keeps what the
 * server would refuse while he is listed out of the list. The sheet and the dialogs go to the
 * page's body, over whatever opened them. `trigger` draws the control that opens the sheet; the
 * squad sheet's own button without it.
 */
export function PlayerActions({
  player,
  trigger,
}: {
  player: SquadPlayerView;
  trigger?: (open: () => void) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const market = useOnlineStore((state) => state.market);
  const [menu, setMenu] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const listed = market?.selling.find((auction) => auction.playerId === player.id);

  useEffect(() => {
    if (menu && market === undefined) void refreshMarket().catch(() => undefined);
  }, [menu, market]);

  const pick = (next: Action) => {
    setMenu(false);
    setAction(next);
  };
  const close = () => setAction(null);
  const open = () => setMenu(true);

  return (
    <>
      {trigger ? (
        trigger(open)
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={open}
          className={`flex h-11 items-center justify-center rounded-[10px] bg-primary-700 font-heading text-[15px] font-bold uppercase tracking-wider text-white hover:bg-primary-600 ${FOCUS}`}
        >
          {t(`${KEY}.actions`)}
        </button>
      )}
      {menu &&
        createPortal(
          <PhoneSheet
            title={t(`${KEY}.actionsTitle`, { name: player.matchName })}
            onClose={() => setMenu(false)}
          >
            <ul className="-mx-1 flex flex-col">
              <li className={GROUP}>{t(`${KEY}.groupTransfer`)}</li>
              {listed ? (
                <li>
                  <Link to={`/online/auctions/${listed.id}`} className={ROW}>
                    <RowBody
                      icon={<Gavel className="h-4.5 w-4.5" />}
                      label={t("online.market.listed")}
                    />
                  </Link>
                </li>
              ) : (
                <>
                  {market && (
                    <Row
                      icon={<Gavel className="h-4.5 w-4.5" />}
                      label={t("online.market.list")}
                      sub={t(`${KEY}.listSub`)}
                      onPick={() => pick("list")}
                    />
                  )}
                  <Row
                    icon={<UserMinus className="h-4.5 w-4.5" />}
                    label={t("online.player.release")}
                    sub={t(`${KEY}.releaseSub`)}
                    danger
                    onPick={() => pick("release")}
                  />
                </>
              )}
              <li className={GROUP}>{t(`${KEY}.groupCustomise`)}</li>
              <Row
                icon={<Shirt className="h-4.5 w-4.5" />}
                label={t("squad.jerseyPickerAction")}
                sub={
                  player.shirtNumber !== undefined
                    ? t(`${KEY}.shirtSub`, { number: player.shirtNumber })
                    : undefined
                }
                onPick={() => pick("shirt")}
              />
              {!listed && (
                <>
                  <Row
                    icon={<ImageIcon className="h-4.5 w-4.5" />}
                    label={t("online.player.avatarChange")}
                    onPick={() => pick("avatar")}
                  />
                  <Row
                    icon={<Globe className="h-4.5 w-4.5" />}
                    label={t("online.player.nationalityChange")}
                    sub={countryName(player.nationality, i18n.language)}
                    onPick={() => pick("nationality")}
                  />
                  <Row
                    icon={<PenLine className="h-4.5 w-4.5" />}
                    label={t("online.rename.open")}
                    sub={player.fullName}
                    onPick={() => pick("rename")}
                  />
                </>
              )}
              <li>
                <Link to="/online/tactics" className={ROW}>
                  <RowBody
                    icon={<Crosshair className="h-4.5 w-4.5" />}
                    label={t(`${KEY}.toTactics`)}
                  />
                </Link>
              </li>
            </ul>
          </PhoneSheet>,
          document.body,
        )}
      {action &&
        createPortal(
          <>
            {action === "list" && (
              <ListingDialog playerId={player.id} playerName={player.fullName} onClose={close} />
            )}
            {action === "release" && <ReleaseDialog player={player} onClose={close} />}
            {action === "shirt" && <ShirtNumberPicker player={player} onClose={close} />}
            {action === "avatar" && <PlayerAvatarPicker player={player} onClose={close} />}
            {action === "nationality" && (
              <PlayerNationalityDialog player={player} onClose={close} />
            )}
            {action === "rename" && <RenamePlayerDialog player={player} onClose={close} />}
          </>,
          document.body,
        )}
    </>
  );
}
