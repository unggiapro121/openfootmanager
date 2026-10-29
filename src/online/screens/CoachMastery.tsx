import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, BookPlus, Info } from "lucide-react";
import type { StyleMasteryView } from "../api";
import { useOnlineStore } from "../store/onlineStore";
import { itemName } from "./items/itemText";
import UseItemDialog from "./items/UseItemDialog";
import { masteryInOrder, notebooks, strongestStyle } from "./profile/profileView";
import StyleEffectChips from "./StyleEffectChips";

type Notebook = { code: string; total: number };

/**
 * The coach's command of each play style (his online profile; design ho-so-hlv.html): strongest
 * first, each with its level, what it does, the XP towards the next level and its matches, and
 * the notebooks he holds to add XP at once. XP is earned in league matches he directs. `onUsed`
 * reads the career again once a notebook was used.
 */
export default function CoachMastery({
  mastery,
  onUsed,
}: {
  mastery: StyleMasteryView[];
  onUsed: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const infoId = useId();
  const [info, setInfo] = useState(false);
  const [using, setUsing] = useState<{ code: string; style: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const notes = notebooks(useOnlineStore((state) => state.items));
  const held = notes?.filter((note) => note.total > 0) ?? [];
  const best = strongestStyle(mastery);

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-navy-600 dark:bg-navy-700"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4 dark:border-navy-600">
        <div className="flex items-center gap-2">
          <h2
            id={titleId}
            className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
          >
            {t("manager.playStyleMastery")}
          </h2>
          <button
            type="button"
            onClick={() => setInfo((was) => !was)}
            aria-expanded={info}
            aria-controls={infoId}
            aria-label={t("online.mastery.howLabel")}
            title={t("online.mastery.howLabel")}
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:bg-navy-600"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {held.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            {t("online.mastery.notes")}
            {held.map((note, index) => (
              <span key={note.code}>
                {itemName(t, note.code)}{" "}
                <strong className="text-gray-900 dark:text-white">×{note.total}</strong>
                {index < held.length - 1 && " ·"}
              </span>
            ))}
          </p>
        )}
      </div>
      {info && (
        <p
          id={infoId}
          className="border-b border-gray-200 bg-gray-50 px-6 py-3 text-[13px] text-gray-700 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-300"
        >
          {t("online.mastery.hint")}
          {notes && ` ${t("online.mastery.notesHint")}`}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 px-6 pb-6 pt-5 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {masteryInOrder(mastery).map((style) => (
          <StyleCard
            key={style.style}
            style={style}
            best={style === best && mastery.length > 1}
            notes={held}
            onUse={(code) => {
              setDone(null);
              setUsing({ code, style: style.style });
            }}
          />
        ))}
      </ul>
      {done && (
        <p
          role="status"
          className="mx-6 mb-5 rounded-lg bg-primary-50 px-3 py-2.5 text-[13px] text-primary-800 dark:bg-primary-900/40 dark:text-primary-300"
        >
          {done}
        </p>
      )}
      {using && (
        <UseItemDialog
          code={using.code}
          initialTarget={{ kind: "style", style: using.style }}
          onClose={() => setUsing(null)}
          onDone={(text) => {
            setUsing(null);
            setDone(text);
            onUsed();
          }}
        />
      )}
    </section>
  );
}

function StyleCard({
  style,
  best,
  notes,
  onUse,
}: {
  style: StyleMasteryView;
  best: boolean;
  notes: Notebook[];
  onUse: (code: string) => void;
}) {
  const { t } = useTranslation();
  const name = t(`common.playStyles.${style.style}`, style.style);
  const atMaximum = style.xpToNext === 0;
  const share = atMaximum ? 100 : Math.min(100, Math.round((style.xp / style.xpToNext) * 100));
  return (
    <li
      data-testid={`mastery-${style.style}`}
      className={`relative flex flex-col gap-2.5 rounded-xl border bg-gray-50 p-4 dark:bg-navy-800 ${
        best
          ? "border-accent-400 dark:border-accent-400/40"
          : "border-gray-200 dark:border-navy-600"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-heading text-lg font-bold uppercase tracking-wide text-gray-900 dark:text-white">
              {name}
            </h3>
            {best && (
              <span className="rounded-md bg-accent-100 px-1.5 font-heading text-[11px] font-semibold uppercase tracking-wider text-accent-800 dark:bg-accent-900/40 dark:text-accent-300">
                {t("online.mastery.best")}
              </span>
            )}
          </span>
          <StyleEffectChips effects={style.effects} />
        </div>
        <span className="flex shrink-0 flex-col items-end">
          <span
            className={`font-heading text-4xl font-bold leading-[0.9] tabular-nums ${
              best ? "text-accent-700 dark:text-accent-400" : "text-gray-900 dark:text-white"
            }`}
          >
            {style.level}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t("manager.masteryLevel")}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span
          role="progressbar"
          aria-label={t("online.mastery.xpBar")}
          aria-valuemin={0}
          aria-valuemax={atMaximum ? undefined : style.xpToNext}
          aria-valuenow={atMaximum ? undefined : style.xp}
          className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
        >
          <span
            className="block h-full rounded-full bg-primary-500"
            style={{ width: `${share}%` }}
          />
        </span>
        <span className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>
            <span
              className={
                style.xp > 0
                  ? "font-semibold tabular-nums text-primary-700 dark:text-primary-300"
                  : "font-semibold tabular-nums"
              }
            >
              {atMaximum
                ? t("manager.masteryMax")
                : t("manager.masteryXp", { xp: style.xp, next: style.xpToNext })}
            </span>
            {" · "}
            <span className="tabular-nums">
              {t("manager.masteryMatches", { count: style.matches })}
            </span>
          </span>
          {notes.length > 0 && <NotebookMenu styleName={name} notes={notes} onUse={onUse} />}
        </span>
      </div>
    </li>
  );
}

/** The notebooks held, offered for this style; closes on a choice, Escape or a click elsewhere. */
function NotebookMenu({
  styleName,
  notes,
  onUse,
}: {
  styleName: string;
  notes: Notebook[];
  onUse: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const label = t("online.mastery.useFor", { style: styleName });

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span ref={root} className="relative">
      <button
        ref={toggle}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        title={label}
        className={`inline-flex h-7 items-center gap-1 rounded-md border border-gray-300 px-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-navy-600 dark:text-gray-200 dark:hover:bg-navy-600 ${
          open ? "bg-gray-100 dark:bg-navy-600" : ""
        }`}
      >
        <BookPlus className="h-3.5 w-3.5" aria-hidden="true" />
        XP
      </button>
      {open && (
        <span
          id={menuId}
          className="absolute right-0 top-full z-10 mt-1.5 flex w-60 flex-col gap-0.5 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-navy-600 dark:bg-navy-700"
        >
          <span className="px-2 pb-1 pt-1.5 text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {label}
          </span>
          {notes.map((note) => (
            <button
              key={note.code}
              type="button"
              onClick={() => {
                setOpen(false);
                onUse(note.code);
              }}
              className="flex min-h-10 items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white dark:hover:bg-navy-600"
            >
              {itemName(t, note.code)}
              <span className="text-gray-500 dark:text-gray-400">×{note.total}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
