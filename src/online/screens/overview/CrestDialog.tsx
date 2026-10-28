import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CREST_PATTERNS } from "../../../components/ui/GeneratedCrest";
import type { ClubCrest, ClubProfileView } from "../../api";
import { online } from "../../client";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { CrestOf, crestDraftOf } from "../ClubCrestMark";
import ItemDialogFrame, { FRAME_ACTION, FrameCancel } from "../items/ItemDialogFrame";
import { renameErrorText } from "../renameText";
import { useActionKey } from "../useActionKey";
import { LABEL } from "./OverviewCard";

/** Letters a crest holds (the server's rule: 1 to 3 letters or digits). */
const LETTERS = 3;

/**
 * The club's crest drawn by its coach: two colours, a pattern and up to three letters, seen as
 * they change. Free, as often as he likes; the server keeps colours and letters tidy.
 */
export default function CrestDialog({
  profile,
  onClose,
}: {
  profile: ClubProfileView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const [draft, setDraft] = useState<ClubCrest>(() => crestDraftOf(profile));
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const key = useActionKey();
  const ids = { primary: useId(), secondary: useId(), letters: useId(), hint: useId() };
  const label = draft.label.trim();
  const change = (part: Partial<ClubCrest>) => setDraft((current) => ({ ...current, ...part }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const crest = { ...draft, label };
    try {
      const club = await key.run(
        (idempotencyKey) => tracked(() => online.clubs.setCrest(crest, idempotencyKey)),
        JSON.stringify(crest),
      );
      useOnlineStore.getState().setClub(club);
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  };

  const colourField =
    "h-11 w-full cursor-pointer rounded-lg border border-gray-300 bg-white p-1 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-800";
  return (
    <ItemDialogFrame
      title={t("online.club.crest.title")}
      icon={
        <span className="h-14 w-14 shrink-0">
          <CrestOf name={profile.name} crest={{ ...draft, label: label || "?" }} />
        </span>
      }
      busy={saving}
      onClose={onClose}
    >
      <form onSubmit={save} className="flex flex-col gap-5">
        <div className="flex justify-center">
          <span className="h-28 w-28">
            <CrestOf name={profile.name} crest={{ ...draft, label: label || "?" }} />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.primary} className={LABEL}>
              {t("online.club.crest.primary")}
            </label>
            <input
              id={ids.primary}
              type="color"
              value={draft.primary}
              onChange={(event) => change({ primary: event.target.value })}
              className={colourField}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.secondary} className={LABEL}>
              {t("online.club.crest.secondary")}
            </label>
            <input
              id={ids.secondary}
              type="color"
              value={draft.secondary}
              onChange={(event) => change({ secondary: event.target.value })}
              className={colourField}
            />
          </div>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className={`${LABEL} mb-2`}>{t("online.club.crest.patternLabel")}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CREST_PATTERNS.map((pattern) => {
              const on = draft.pattern === pattern;
              return (
                <label
                  key={pattern}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2 text-center text-xs font-semibold focus-within:ring-2 focus-within:ring-primary-500 ${
                    on
                      ? "border-primary-500 bg-primary-50 text-primary-800 dark:border-primary-500 dark:bg-primary-900/40 dark:text-primary-200"
                      : "border-gray-200 bg-gray-50 text-gray-700 hover:border-primary-500 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-300 dark:hover:border-primary-500"
                  }`}
                >
                  <input
                    type="radio"
                    name="crest-pattern"
                    value={pattern}
                    checked={on}
                    onChange={() => change({ pattern })}
                    className="sr-only"
                  />
                  <span aria-hidden="true" className="h-10 w-10">
                    <CrestOf
                      name={profile.name}
                      crest={{ ...draft, pattern, label: label || "?" }}
                    />
                  </span>
                  {t(`online.club.crest.pattern.${pattern}`)}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.letters} className={LABEL}>
            {t("online.club.crest.label")}
          </label>
          <input
            id={ids.letters}
            type="text"
            value={draft.label}
            maxLength={LETTERS}
            autoComplete="off"
            aria-describedby={ids.hint}
            onChange={(event) => change({ label: event.target.value.toUpperCase() })}
            className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 font-heading text-lg font-bold uppercase tracking-widest text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100"
          />
          <span id={ids.hint} className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.club.crest.labelHint")}
          </span>
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {renameErrorText(t, error)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <FrameCancel onClick={onClose} disabled={saving}>
            {t("online.cancel")}
          </FrameCancel>
          <button
            type="submit"
            className={FRAME_ACTION}
            disabled={saving || offline || label === ""}
          >
            {t("online.club.crest.save")}
          </button>
        </div>
      </form>
    </ItemDialogFrame>
  );
}
