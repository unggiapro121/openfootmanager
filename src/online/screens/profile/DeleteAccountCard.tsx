import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserX } from "lucide-react";
import DeleteAccountDialog from "./DeleteAccountDialog";

const KEY = "online.profile.deletion";

/**
 * The profile's last card (M3c1, m3-tech-spec §5.1; D-P5-14): the way to delete the account, on
 * the desktop and the phone alike. The dialog says what goes before it asks for the password.
 */
export default function DeleteAccountCard() {
  const { t } = useTranslation();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-red-300 bg-white p-5 shadow-sm dark:border-red-500/50 dark:bg-navy-700"
    >
      <div className="min-w-0 flex-[1_1_16rem]">
        <h2
          id={titleId}
          className="font-heading text-lg font-bold uppercase tracking-wider text-red-700 dark:text-red-300"
        >
          {t(`${KEY}.title`)}
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t(`${KEY}.summary`)}</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-red-300 px-4 font-heading text-sm font-bold uppercase tracking-wider text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-500/50 dark:text-red-300 dark:hover:bg-red-500/10 dark:focus:ring-offset-navy-800"
      >
        <UserX className="h-4 w-4" aria-hidden="true" />
        {t(`${KEY}.open`)}
      </button>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </section>
  );
}
