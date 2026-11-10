import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui";
import { usePhoneLayout } from "../../hooks/usePhoneLayout";
import type { LicenceNotice as Notice } from "../api";
import { online } from "../client";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { PhoneSheet } from "./mobile/PhoneSheet";
import { useActionKey } from "./useActionKey";

/**
 * The notices whose sheet was closed on this run: the sheet rises once, then the notice waits on
 * the page as a banner until dismissed, on whichever screen it shows (overview, tactics).
 */
const closedSheets = new Set<string>();

function noticeKey(notice: Notice): string {
  return `${notice.seasonNumber}:${notice.tier}`;
}

/**
 * What the server moved in the club's setup to fit the coach's licence (S-9 S9-20), worded here
 * from the server's data, until the coach saves a setup or dismisses it. On a phone it first rises
 * as a sheet from the bottom (m2-tech-spec §3.3, M2a-3).
 */
export default function LicenceNotice() {
  const { t } = useTranslation();
  const notice = useOnlineStore((state) => state.club?.licence?.notice);
  const key = useActionKey();
  const [failed, setFailed] = useState(false);
  const phone = usePhoneLayout();
  const [, setSheetClosed] = useState(false);
  if (!notice) return null;

  const dismiss = async () => {
    try {
      const club = await key.run((idempotencyKey) =>
        tracked(() => online.clubs.dismissLicenceNotice(idempotencyKey)),
      );
      useOnlineStore.getState().setClub(club);
      setFailed(false);
    } catch (error) {
      console.error("Failed to dismiss the licence notice:", error);
      setFailed(true);
    }
  };

  const title = t("online.licence.notice.title", {
    season: notice.seasonNumber,
    licence: t(`tactics.licence.tier_${notice.tier}`),
  });
  const list = (
    <ul className="list-disc pl-5">
      {changes(notice, t).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
  const failure = failed && (
    <p className="text-red-600 dark:text-red-400">{t("online.licence.notice.failed")}</p>
  );

  if (phone && !closedSheets.has(noticeKey(notice))) {
    return (
      <PhoneSheet
        title={title}
        onClose={() => {
          closedSheets.add(noticeKey(notice));
          setSheetClosed(true);
        }}
      >
        <div className="space-y-2 text-sm text-gray-800 dark:text-gray-100">
          {list}
          {failure}
        </div>
        <Button type="button" className="min-h-11 w-full" onClick={() => void dismiss()}>
          {t("online.licence.notice.dismiss")}
        </Button>
      </PhoneSheet>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-accent-400/50 bg-accent-50 px-4 py-3 text-sm text-gray-800 dark:bg-accent-500/10 dark:text-gray-100"
    >
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">{title}</p>
        {list}
        {failure}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="max-md:min-h-11 max-md:w-full"
        onClick={() => void dismiss()}
      >
        {t("online.licence.notice.dismiss")}
      </Button>
    </div>
  );
}

function changes(notice: Notice, t: TFunction): string[] {
  const style = (name: string): string => t(`common.playStyles.${name}`, { defaultValue: name });
  const lines: string[] = [];
  if (notice.formation) {
    lines.push(
      t("online.licence.notice.formation", {
        from: notice.formation.from,
        to: notice.formation.to,
      }),
    );
  }
  if (notice.playStyle) {
    lines.push(
      t("online.licence.notice.playStyle", {
        from: style(notice.playStyle.from),
        to: style(notice.playStyle.to),
      }),
    );
  }
  if (notice.dials > 0) lines.push(t("online.licence.notice.dials", { count: notice.dials }));
  if (notice.roles > 0) lines.push(t("online.licence.notice.roles", { count: notice.roles }));
  return lines;
}
