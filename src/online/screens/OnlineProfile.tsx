import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Card, CardBody, CardHeader } from "../../components/ui";
import { resolveBackendError } from "../../utils/backendI18n";
import type { AccountView } from "../api";
import type { CoachRegion } from "../api/domain";
import { online } from "../client";
import { ONLINE_REGIONS } from "../format";
import {
  refreshClub,
  refreshLeague,
  refreshSeason,
  tracked,
  useOnlineStore,
} from "../store/onlineStore";
import CoachMastery from "./CoachMastery";
import CoachRoadmap from "./CoachRoadmap";
import { useActionKey } from "./useActionKey";

/**
 * The coach's online profile (C-2 §3.3, Qc2-6): who they are and their region, and the road ahead
 * (`CoachRoadmap`). Changing region gives the club back to its bot at once, so it is confirmed
 * first.
 */
export default function OnlineProfile() {
  const { t } = useTranslation();
  const [account, setAccount] = useState<AccountView | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    tracked(() => online.me.get())
      .then(setAccount)
      .catch(setError);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {error !== null && (
        <p role="alert" className="text-red-600 lg:col-span-3 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      <Card accent="primary" className="lg:col-span-3">
        <div className="flex items-center gap-6 rounded-t-xl bg-gradient-to-r from-navy-700 to-navy-800 p-6">
          {account ? (
            <>
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border-2 border-primary-500/30 bg-primary-500/20 font-heading text-3xl font-bold text-primary-400">
                {account.firstName.charAt(0)}
                {account.lastName.charAt(0)}
              </div>
              <div className="min-w-0">
                <h2 className="font-heading text-2xl font-bold uppercase tracking-wide text-white">
                  {`${account.firstName} ${account.lastName}`}
                </h2>
                <p className="mt-1 text-sm text-gray-400">{t(`coach.regions.${account.region}`)}</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-primary-400">
                  {account.email}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">{t("online.loading")}</p>
          )}
        </div>
      </Card>
      <CoachMastery />
      <CoachRoadmap />
      {account && (
        <Card>
          <CardHeader>{t("online.profile.region")}</CardHeader>
          <CardBody className="text-sm text-gray-700 dark:text-gray-300">
            <RegionChange account={account} onChanged={setAccount} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function RegionChange({
  account,
  onChanged,
}: {
  account: AccountView;
  onChanged: (account: AccountView) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const offline = useOnlineStore((state) => state.network === "offline");
  const hasClub = useOnlineStore((state) => state.club !== null);
  const [region, setRegion] = useState<CoachRegion>(account.region);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [changed, setChanged] = useState(false);
  const key = useActionKey();

  const change = async () => {
    setSending(true);
    setError(null);
    try {
      const updated = await key.run(
        (idempotencyKey) => tracked(() => online.me.update({ region }, idempotencyKey)),
        region,
      );
      onChanged(updated);
      setConfirming(false);
      setChanged(true);
      // The club went back to its bot: the shared views change with it.
      await Promise.allSettled([refreshClub(), refreshLeague(), refreshSeason()]);
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <label htmlFor="online-region" className="sr-only">
        {t("online.profile.changeRegion")}
      </label>
      <select
        id="online-region"
        value={region}
        onChange={(event) => {
          setRegion(event.target.value as CoachRegion);
          setConfirming(false);
          setChanged(false);
        }}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100"
      >
        {ONLINE_REGIONS.map((option) => (
          <option key={option} value={option}>
            {t(`coach.regions.${option}`)}
          </option>
        ))}
      </select>
      {error !== null && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="online-region-confirm"
          className="space-y-3 rounded-lg border border-accent-400/50 bg-accent-50 p-4 dark:bg-accent-500/10"
        >
          <p id="online-region-confirm" className="font-semibold text-gray-900 dark:text-gray-100">
            {t("online.profile.confirmTitle")}
          </p>
          <p>{t("online.profile.confirmBody")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={change} disabled={sending || offline}>
              {t("online.profile.confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t("online.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirming(true)}
          disabled={region === account.region || offline}
        >
          {t("online.profile.changeRegion")}
        </Button>
      )}
      {changed && (
        <div role="status" className="space-y-2">
          <p>{t("online.profile.changed")}</p>
          {!hasClub && (
            <Button size="sm" onClick={() => navigate("/online/takeover")}>
              {t("online.takeover.button")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
