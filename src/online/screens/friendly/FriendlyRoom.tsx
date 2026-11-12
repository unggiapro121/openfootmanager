import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Copy } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { FriendlyRole, FriendlyRoomView, FriendlySideView } from "../../api";
import { online } from "../../client";
import { useOnlineStore } from "../../store/onlineStore";
import { useCountdownText } from "../useCountdownText";
import { useFriendlyAction } from "./useFriendlyAction";
import { shownCoachName } from "../coachName";

const LINK_CLASS =
  "rounded text-sm font-semibold text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800";

/**
 * A friendly room (S-12 §4.1): the two clubs, who is ready, the time left to get ready, and what
 * the coach may do now. When the match it waited for starts, the coach is taken to it.
 */
export function FriendlyRoom({ room }: { room: FriendlyRoomView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const previous = useRef(room.status);

  useEffect(() => {
    const was = previous.current;
    previous.current = room.status;
    if (was === "starting" && room.status === "playing" && room.matchId) {
      navigate(`/online/match/${room.matchId}`);
    }
  }, [room.status, room.matchId, navigate]);

  return (
    <Card accent="primary">
      <CardHeader>{t("online.friendly.room.title", { leg: room.leg })}</CardHeader>
      <CardBody className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        {room.code && <RoomCode code={room.code} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Side side={room.host} place="host" room={room} />
          {room.guest ? (
            <Side side={room.guest} place="guest" room={room} />
          ) : (
            <p className="rounded-md border border-dashed border-gray-300 p-3 text-gray-500 dark:border-navy-600 dark:text-gray-400">
              {t("online.friendly.room.waitingGuest")}
            </p>
          )}
        </div>
        <RoomActions room={room} />
      </CardBody>
    </Card>
  );
}

function RoomCode({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <div className="flex items-center gap-3">
      <p>
        {t("online.friendly.room.code")}{" "}
        <span className="font-heading text-2xl font-bold tracking-widest text-gray-900 dark:text-gray-100">
          {code}
        </span>
      </p>
      <Button variant="ghost" size="sm" onClick={copy} aria-label={t("online.friendly.room.copy")}>
        <Copy className="h-4 w-4" aria-hidden="true" />
      </Button>
      {copied && (
        <span role="status" className="text-primary-700 dark:text-primary-400">
          {t("online.friendly.room.copied")}
        </span>
      )}
    </div>
  );
}

function Side({
  side,
  place,
  room,
}: {
  side: FriendlySideView;
  place: FriendlyRole;
  room: FriendlyRoomView;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 rounded-md border border-gray-200 p-3 dark:border-navy-600">
      <p className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100">
        {side.club.name}
      </p>
      <p>{shownCoachName(t, side.coach.fullName)}</p>
      <p>{t("online.friendly.room.strength", { value: Math.round(side.strengthTop18) })}</p>
      <div className="flex flex-wrap gap-2">
        {room.home === place && <Badge variant="primary">{t("online.friendly.room.home")}</Badge>}
        {room.status === "full" && (
          <Badge variant={side.ready ? "success" : "neutral"}>
            {side.ready ? t("online.friendly.room.isReady") : t("online.friendly.room.notYet")}
          </Badge>
        )}
        {room.me === place && <Badge variant="accent">{t("online.friendly.room.you")}</Badge>}
      </div>
      {room.me !== place && (
        // No fixture: a friendly opens the profile but is not noted (Q-OS2).
        <Link
          to={`/online/clubs/${side.club.id}/opponent`}
          className="inline-block rounded font-semibold text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800"
        >
          {t("online.opponent.open")}
        </Link>
      )}
    </div>
  );
}

function RoomActions({ room }: { room: FriendlyRoomView }) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const { act, busy, error } = useFriendlyAction();
  const deadline = useCountdownText(room.status === "full" ? room.readyDeadline : undefined);
  const mine = room.me === "host" ? room.host : room.guest;
  const disabled = busy || offline;
  const leave = (
    <Button
      variant="ghost"
      onClick={() => void act((key) => online.friendlies.leave(key), `leave:${room.leg}`)}
      disabled={disabled}
    >
      {t("online.friendly.room.leave")}
    </Button>
  );

  return (
    <div className="space-y-3">
      {error !== null && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      {room.status === "full" && deadline && (
        <p className="text-gray-500 dark:text-gray-400">
          {t("online.friendly.room.readyBy", { time: deadline })}
        </p>
      )}
      {room.status === "starting" && <p role="status">{t("online.friendly.room.starting")}</p>}
      {room.status === "playing" && <p role="status">{t("online.friendly.room.playing")}</p>}
      {room.status === "finished" && <p role="status">{t("online.friendly.room.finished")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {room.status === "full" && (
          <Button
            onClick={() =>
              void act(
                (key) => online.friendlies.ready(!mine?.ready, key),
                `ready:${room.leg}:${!mine?.ready}`,
              )
            }
            disabled={disabled}
          >
            {mine?.ready ? t("online.friendly.room.notReady") : t("online.friendly.room.ready")}
          </Button>
        )}
        {(room.status === "open" || room.status === "full") && (
          <Link to="/online/tactics" className={LINK_CLASS}>
            {t("online.friendly.room.editTactics")}
          </Link>
        )}
        {room.status === "playing" && room.matchId && (
          <Link to={`/online/match/${room.matchId}`} className={LINK_CLASS}>
            {t("online.friendly.room.watch")}
          </Link>
        )}
        {room.status === "finished" && (
          <>
            <Button
              onClick={() =>
                void act((key) => online.friendlies.rematch(key), `rematch:${room.leg}`)
              }
              disabled={disabled}
            >
              {t("online.friendly.room.rematch")}
            </Button>
            {room.matchId && (
              <Link to={`/online/match/${room.matchId}`} className={LINK_CLASS}>
                {t("online.friendly.room.replay")}
              </Link>
            )}
          </>
        )}
        {(room.status === "open" || room.status === "full" || room.status === "finished") && leave}
      </div>
    </div>
  );
}
