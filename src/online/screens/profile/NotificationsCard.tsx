import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { resolveBackendError } from "../../../utils/backendI18n";
import {
  openPushSettings,
  type PushPermission,
  pushPermissionState,
} from "../../../services/onlinePushService";
import type { PushKind, PushSettingsView } from "../../api";
import { online } from "../../client";
import { enablePush } from "../../push/pushDevice";

const KEY = "online.push";

/** The five kinds, in the order the card lists them (D-P5-15). */
const KINDS: PushKind[] = ["matchSoon", "outbid", "auctionEnding", "auctionResult", "dailyGift"];

type Kinds = Record<PushKind, boolean>;

/** Every kind named: one the server left out is on (§4.2). */
function allKinds(view: PushSettingsView): Kinds {
  return Object.fromEntries(KINDS.map((kind) => [kind, view.kinds[kind] ?? true])) as Kinds;
}

const BUTTON =
  "inline-flex h-10 items-center rounded-lg border border-primary-600 px-3 font-heading text-sm font-bold uppercase tracking-wider text-primary-700 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-primary-400 dark:text-primary-300 dark:hover:bg-primary-500/10 dark:focus:ring-offset-navy-800";

/**
 * The profile's "Notifications" card on the phone (M3c2, m3-tech-spec §5.6): a switch per kind
 * of push, and a line when the phone does not show them, with the way to turn them on. It says
 * nothing about how many pushes come or when (the caps and quiet hours stay hidden).
 */
export default function NotificationsCard() {
  const { t } = useTranslation();
  const titleId = useId();
  const [kinds, setKinds] = useState<Kinds>();
  const [permission, setPermission] = useState<PushPermission>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const readPermission = useCallback(() => {
    pushPermissionState()
      .then(setPermission)
      .catch(() => setPermission(undefined));
  }, []);

  useEffect(() => {
    online.push
      .settings()
      .then((view) => setKinds(allKinds(view)))
      .catch(setError);
    readPermission();
    // Back from the phone's settings, the answer may have changed.
    const back = () => {
      if (document.visibilityState === "visible") readPermission();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [readPermission]);

  const turn = (kind: PushKind) => {
    if (!kinds) return;
    setSaving(true);
    setError(null);
    online.push
      .setSettings({ kinds: { ...kinds, [kind]: !kinds[kind] } })
      .then((view) => setKinds(allKinds(view)))
      .catch(setError)
      .finally(() => setSaving(false));
  };

  const turnOn = () => {
    enablePush()
      .then(setPermission)
      .catch(() => readPermission());
  };

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-600 dark:bg-navy-700"
    >
      <div className="flex items-start gap-3">
        <Bell
          className="mt-1 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2
            id={titleId}
            className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
          >
            {t(`${KEY}.card.title`)}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t(`${KEY}.card.summary`)}
          </p>
        </div>
      </div>
      {permission === "prompt" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-navy-800">
          <p className="text-sm text-gray-700 dark:text-gray-200">{t(`${KEY}.card.prompt`)}</p>
          <button type="button" className={BUTTON} onClick={turnOn}>
            {t(`${KEY}.card.enable`)}
          </button>
        </div>
      )}
      {permission === "denied" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent-50 px-3 py-2 dark:bg-accent-500/10">
          <p className="text-sm text-gray-800 dark:text-gray-100">{t(`${KEY}.card.denied`)}</p>
          <button
            type="button"
            className={BUTTON}
            onClick={() => void openPushSettings().catch(() => undefined)}
          >
            {t(`${KEY}.card.openSettings`)}
          </button>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      {kinds && (
        <ul className="flex flex-col divide-y divide-gray-100 dark:divide-navy-600">
          {KINDS.map((kind) => (
            <KindSwitch
              key={kind}
              label={t(`${KEY}.kind.${kind}`)}
              on={kinds[kind]}
              disabled={saving}
              onTurn={() => turn(kind)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function KindSwitch({
  label,
  on,
  disabled,
  onTurn,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onTurn: () => void;
}) {
  const labelId = useId();
  return (
    <li className="flex min-h-12 items-center justify-between gap-3 py-2">
      <span id={labelId} className="text-sm text-gray-800 dark:text-gray-100">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={onTurn}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-navy-800 ${
          on ? "bg-primary-600 dark:bg-primary-500" : "bg-gray-300 dark:bg-navy-500"
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
            on ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </li>
  );
}
