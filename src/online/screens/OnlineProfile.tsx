import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePhoneLayout } from "../../hooks/usePhoneLayout";
import { resolveBackendError } from "../../utils/backendI18n";
import type { AccountView, CareerView } from "../api";
import { online } from "../client";
import { type LicenceStep, licenceSteps } from "../convert/licence";
import { refreshItems, tracked } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import { CoachAvatarPicker } from "./CoachAvatar";
import CoachMastery from "./CoachMastery";
import CoachRoadmap from "./CoachRoadmap";
import ProfileHonoursLine from "./honours/ProfileHonoursLine";
import DeleteAccountCard from "./profile/DeleteAccountCard";
import ProfileHero from "./profile/ProfileHero";
import ResourceState from "./ResourceState";

/**
 * The coach's online profile (C-2 §3.3, Qc2-6; design ho-so-hlv.html): who he is, his region and
 * record; his command of each play style; and the road of licences ahead. The career is read once
 * for the three, and again after a notebook adds XP.
 */
export default function OnlineProfile() {
  const { t } = useTranslation();
  const [account, setAccount] = useState<AccountView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState(false);
  const [image, setImage] = useState<string>();
  const phone = usePhoneLayout();
  const { resource, reload } = useOnlineResource(async () => {
    const [career, table] = await Promise.all([
      tracked(() => online.me.career()),
      tracked(() => online.licences.table()),
    ]);
    return { career, steps: table.levels ? licenceSteps(table) : [] };
  }, []);
  // The last career read stays on screen while it is read again, so a notebook's note and the
  // licence chosen survive the re-read.
  const [shown, setShown] = useState<{ career: CareerView; steps: LicenceStep[] }>();
  useEffect(() => {
    if (resource.status === "ready") setShown(resource.data);
  }, [resource]);

  useEffect(() => {
    tracked(() => online.me.get())
      .then(setAccount)
      .catch(setError);
    // The notebooks held show on the styles; a server without items answers none.
    void refreshItems().catch(() => undefined);
  }, []);

  // His own picture is read when the account says he has one, and again when that changes.
  const hasImage = account?.hasAvatarImage;
  useEffect(() => {
    if (!hasImage) {
      setImage(undefined);
      return;
    }
    tracked(() => online.me.avatarImage())
      .then((view) => setImage(view.dataUrl))
      .catch(() => setImage(undefined));
  }, [hasImage]);

  return (
    <div className="@container flex flex-col gap-6">
      {error !== null && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      {account ? (
        <ProfileHero
          account={account}
          image={image}
          career={shown?.career}
          onPickPortrait={() => setPicking(true)}
          onAccount={setAccount}
        />
      ) : (
        error === null && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
        )
      )}
      {account && <ProfileHonoursLine />}
      {account && picking && (
        <CoachAvatarPicker
          account={account}
          image={image}
          onSaved={setAccount}
          onClose={() => setPicking(false)}
        />
      )}
      {shown ? (
        <>
          {/* A phone leads with the road ahead, then the styles (design m-ho-so-hlv.html). */}
          {phone && <CoachRoadmap career={shown.career} steps={shown.steps} />}
          <CoachMastery mastery={shown.career.mastery} onUsed={reload} />
          {!phone && <CoachRoadmap career={shown.career} steps={shown.steps} />}
        </>
      ) : (
        <ResourceState resource={resource} reload={reload}>
          {() => null}
        </ResourceState>
      )}
      {account && <DeleteAccountCard />}
    </div>
  );
}
