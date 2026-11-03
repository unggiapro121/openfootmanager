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

const ROW = `flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-navy-700 ${FOCUS}`;
const ICON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300";

function Row({ icon, label, onPick }: { icon: ReactNode; label: string; onPick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onPick} className={ROW}>
        <span className={ICON} aria-hidden="true">
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * The player sheet's "Actions" button and what it opens: a sheet of the full profile's actions
 * (put up for auction, release, shirt number, picture, nationality, name, and the tactics), and
 * the dialog of the one picked. A player up for auction leads to his auction instead, and keeps
 * what the server would refuse while he is listed out of the list. The sheet and the dialogs go
 * to the page's body, over the player's own sheet.
 */
export function PlayerActions({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
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

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setMenu(true)}
        className={`flex h-11 items-center justify-center rounded-[10px] bg-primary-700 font-heading text-[15px] font-bold uppercase tracking-wider text-white hover:bg-primary-600 ${FOCUS}`}
      >
        {t(`${KEY}.actions`)}
      </button>
      {menu &&
        createPortal(
          <PhoneSheet
            title={t(`${KEY}.actionsTitle`, { name: player.matchName })}
            onClose={() => setMenu(false)}
          >
            <ul className="-mx-1 flex flex-col">
              {listed ? (
                <li>
                  <Link to={`/online/auctions/${listed.id}`} className={ROW}>
                    <span className={ICON} aria-hidden="true">
                      <Gavel className="h-4.5 w-4.5" />
                    </span>
                    <span className="flex-1">{t("online.market.listed")}</span>
                    <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  </Link>
                </li>
              ) : (
                <>
                  {market && (
                    <Row
                      icon={<Gavel className="h-4.5 w-4.5" />}
                      label={t("online.market.list")}
                      onPick={() => pick("list")}
                    />
                  )}
                  <Row
                    icon={<UserMinus className="h-4.5 w-4.5" />}
                    label={t("online.player.release")}
                    onPick={() => pick("release")}
                  />
                </>
              )}
              <Row
                icon={<Shirt className="h-4.5 w-4.5" />}
                label={t("squad.jerseyPickerAction")}
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
                    onPick={() => pick("nationality")}
                  />
                  <Row
                    icon={<PenLine className="h-4.5 w-4.5" />}
                    label={t("online.rename.open")}
                    onPick={() => pick("rename")}
                  />
                </>
              )}
              <li>
                <Link to="/online/tactics" className={ROW}>
                  <span className={ICON} aria-hidden="true">
                    <Crosshair className="h-4.5 w-4.5" />
                  </span>
                  <span className="flex-1">{t(`${KEY}.toTactics`)}</span>
                  <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
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
