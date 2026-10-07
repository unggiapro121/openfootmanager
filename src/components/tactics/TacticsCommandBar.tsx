import {
  Check,
  Copy,
  Crosshair,
  Flag,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { TacticsPhaseSettings } from "../../store/types";
import DashboardModalFrame from "../dashboard/DashboardModalFrame";
import { Badge, Button, Card, Select } from "../ui";
import { FORMATIONS } from "./TacticsTab.helpers";

export interface TacticsLibraryEntry {
  description: string;
  formation: string;
  id: string;
  name: string;
  /**
   * The phase blueprint a saved tactic puts back in force. Absent on presets, and
   * on tactics saved before blueprints were kept, which leave the team's alone.
   */
  phase?: TacticsPhaseSettings;
  playStyle: string;
  sourcePresetName?: string | null;
  type: "preset" | "custom";
}

interface TacticsCommandBarProps {
  activeTactic: TacticsLibraryEntry;
  activePlayStyle: string;
  formation: string;
  isDirty: boolean;
  onCreateNew: () => void;
  onDuplicate: () => void;
  /** Remove a saved custom tactic; the team's live setup is untouched. */
  onDelete: (id: string) => void;
  onFormationChange: (formation: string) => void;
  onPlayStyleChange: (playStyle: string) => void;
  onSave: () => void;
  onSelectTactic: (id: string) => void;
  /** The name being edited: saved with the tactic when the manager saves. */
  onTacticNameChange: (name: string) => void;
  tacticLibrary: TacticsLibraryEntry[];
  tacticName: string;
}

const MAX_TACTIC_NAME_LENGTH = 40;

const SAVE_CUE_DURATION_MS = 2000;

const PLAY_STYLES = [
  { id: "Balanced", icon: <Target className="h-3.5 w-3.5" /> },
  { id: "Attacking", icon: <Zap className="h-3.5 w-3.5" /> },
  { id: "Defensive", icon: <Shield className="h-3.5 w-3.5" /> },
  { id: "Possession", icon: <RefreshCw className="h-3.5 w-3.5" /> },
  { id: "Counter", icon: <Crosshair className="h-3.5 w-3.5" /> },
  { id: "HighPress", icon: <Flag className="h-3.5 w-3.5" /> },
] as const;

function summarizeTactic(entry: TacticsLibraryEntry, t: TFunction): string {
  return `${entry.formation} - ${t(`common.playStyles.${entry.playStyle}`, entry.playStyle)}`;
}

export default function TacticsCommandBar({
  activeTactic,
  activePlayStyle,
  formation,
  isDirty,
  onCreateNew,
  onDuplicate,
  onDelete,
  onFormationChange,
  onPlayStyleChange,
  onSave,
  onSelectTactic,
  onTacticNameChange,
  tacticLibrary,
  tacticName,
}: TacticsCommandBarProps): JSX.Element {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TacticsLibraryEntry | null>(null);
  const [search, setSearch] = useState("");
  const [showSavedCue, setShowSavedCue] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  // The name field takes room the command bar rarely needs, so it only opens to
  // rename: from a tactic's row in the list, or when a new tactic or a copy is
  // made, whose generated name is then selected so typing replaces it.
  const [isEditingName, setIsEditingName] = useState(false);
  // A rename waiting for its tactic to become the active one: the next custom
  // tactic after `after` (a new tactic or a copy), or the tactic `on`.
  const [pendingRename, setPendingRename] = useState<{ after: string } | { on: string } | null>(
    null,
  );
  const renameTarget = useRef<string | null>(null);
  const savedCueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredLibrary = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return tacticLibrary;
    }

    return tacticLibrary.filter((entry) =>
      [
        entry.name,
        entry.description,
        entry.formation,
        entry.playStyle,
        entry.sourcePresetName,
        entry.type,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search, tacticLibrary]);

  const presetEntries = filteredLibrary.filter((entry) => entry.type === "preset");
  const customEntries = filteredLibrary.filter((entry) => entry.type === "custom");

  const saveLabel =
    activeTactic.type === "custom" ? t("tactics.updateTactic") : t("tactics.saveAsTactic");
  // Saving a synced custom tactic is a silent no-op — nothing has changed to
  // persist. Presets stay enabled even when isDirty is false because saving
  // there always creates a new custom tactic, which is an observable action.
  const isSaveDisabled = activeTactic.type === "custom" && !isDirty;
  // Only a tactic that is actually stored can be deleted — not a preset, and not
  // the unsaved "current setup" stand-in shown when nothing matches.
  const isActiveSavedCustom = tacticLibrary.some(
    (entry) => entry.type === "custom" && entry.id === activeTactic.id,
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    return () => {
      if (savedCueTimeoutRef.current) {
        clearTimeout(savedCueTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingRename || activeTactic.type !== "custom") {
      return;
    }
    const isTargetActive =
      "on" in pendingRename
        ? pendingRename.on === activeTactic.id
        : pendingRename.after !== activeTactic.id;
    if (isTargetActive) {
      setPendingRename(null);
      setIsEditingName(true);
    }
  }, [activeTactic.id, activeTactic.type, pendingRename]);

  useEffect(() => {
    if (isEditingName) {
      renameTarget.current = activeTactic.id;
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName, activeTactic.id]);

  // Picking another tactic closes a rename that was open on the previous one.
  useEffect(() => {
    if (renameTarget.current !== null && renameTarget.current !== activeTactic.id) {
      renameTarget.current = null;
      setIsEditingName(false);
    }
  }, [activeTactic.id]);

  function cancelRename(): void {
    onTacticNameChange(activeTactic.name);
    setIsEditingName(false);
  }

  function handleSaveClick(): void {
    onSave();
    setShowSavedCue(true);

    if (savedCueTimeoutRef.current) {
      clearTimeout(savedCueTimeoutRef.current);
    }

    savedCueTimeoutRef.current = setTimeout(() => {
      setShowSavedCue(false);
    }, SAVE_CUE_DURATION_MS);
  }

  return (
    <Card className="overflow-visible">
      <div ref={wrapperRef} className="p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-heading font-bold uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
                  {t("tactics.presetTactics")}
                </span>
                <Badge variant={activeTactic.type === "custom" ? "accent" : "success"} size="sm">
                  {activeTactic.type === "custom"
                    ? t("tactics.customTactic")
                    : t("tactics.activePreset")}
                </Badge>
                <Badge variant={isDirty ? "accent" : "neutral"} size="sm">
                  {isDirty ? t("tactics.unsavedChanges") : t("tactics.synced")}
                </Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
                {activeTactic.description}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<Plus />}
                onClick={() => {
                  setPendingRename({ after: activeTactic.id });
                  onCreateNew();
                }}
              >
                {t("tactics.newTactic")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<Copy />}
                onClick={() => {
                  setPendingRename({ after: activeTactic.id });
                  onDuplicate();
                }}
              >
                {t("tactics.duplicateTactic")}
              </Button>
              {isActiveSavedCustom ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 />}
                  onClick={() => setPendingDelete(activeTactic)}
                  className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  {t("tactics.deleteTactic")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="accent"
                size="sm"
                icon={showSavedCue && !isDirty ? <Check /> : <Save />}
                onClick={handleSaveClick}
                disabled={isSaveDisabled}
                className="min-w-[9.5rem]"
              >
                {showSavedCue && !isDirty ? t("tactics.tacticSaved") : saveLabel}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)_minmax(0,1.2fr)]">
            <div className="relative rounded-2xl border border-gray-200/70 bg-gray-50/80 p-3 dark:border-white/8 dark:bg-navy-900/35">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] font-heading font-bold uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
                  {t("tactics.chooseTactic")}
                </div>
                <div className="text-[10px] font-heading font-bold uppercase tracking-[0.18em] text-primary-500 dark:text-primary-300">
                  {activeTactic.type === "custom" ? t("tactics.myTactics") : t("tactics.presets")}
                </div>
              </div>

              <button
                type="button"
                aria-label={t("tactics.chooseTactic")}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                onClick={() => setIsOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-3 text-left transition-colors hover:border-primary-300 dark:border-white/10 dark:bg-navy-800/90 dark:hover:border-primary-400"
              >
                <div className="min-w-0">
                  <div className="truncate text-base font-heading font-bold text-gray-900 dark:text-gray-100">
                    {activeTactic.name}
                  </div>
                  <div className="mt-1 truncate text-[11px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    {summarizeTactic(activeTactic, t)}
                  </div>
                </div>
                <div className="shrink-0 rounded-full bg-primary-500/10 px-2 py-1 text-[10px] font-heading font-bold uppercase tracking-[0.18em] text-primary-500 dark:text-primary-300">
                  {activeTactic.type === "custom" ? t("tactics.myTactics") : t("tactics.presets")}
                </div>
              </button>

              {isEditingName ? (
                <label className="mt-2 block">
                  <span className="mb-1 block text-[10px] font-heading font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    {t("tactics.tacticName")}
                  </span>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={tacticName}
                    maxLength={MAX_TACTIC_NAME_LENGTH}
                    onChange={(event) => onTacticNameChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (!isSaveDisabled) {
                          handleSaveClick();
                        }
                        setIsEditingName(false);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    onBlur={() => setIsEditingName(false)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition-colors placeholder:text-gray-400 hover:border-primary-300 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 dark:border-white/10 dark:bg-navy-800/90 dark:text-gray-100 dark:hover:border-primary-400"
                  />
                </label>
              ) : null}

              {isOpen ? (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-navy-600 dark:bg-navy-800">
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-navy-600 dark:bg-navy-700">
                    <Search className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                    <input
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      aria-label={t("tactics.searchTactics")}
                      placeholder={t("tactics.searchTactics")}
                      className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-100"
                    />
                  </div>

                  <div
                    role="listbox"
                    aria-label={t("tactics.chooseTactic")}
                    className="max-h-80 space-y-3 overflow-y-auto p-1"
                  >
                    {customEntries.length > 0 ? (
                      <div>
                        <div className="mb-2 px-2 text-[11px] font-heading font-bold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
                          {t("tactics.myTactics")}
                        </div>
                        <div className="space-y-1">
                          {customEntries.map((entry) => (
                            // The delete control sits beside the option, not inside
                            // it: a button may not contain another button.
                            <div key={entry.id} className="relative">
                              <button
                                type="button"
                                role="option"
                                aria-selected={entry.id === activeTactic.id}
                                onClick={() => {
                                  onSelectTactic(entry.id);
                                  setIsOpen(false);
                                  setSearch("");
                                }}
                                className={`w-full rounded-xl border px-3 py-3 pb-9 text-left transition-colors ${
                                  entry.id === activeTactic.id
                                    ? "border-primary-300 bg-primary-50 dark:border-primary-400 dark:bg-primary-500/10"
                                    : "border-transparent bg-gray-50 hover:border-gray-200 hover:bg-white dark:bg-navy-700/70 dark:hover:border-navy-500 dark:hover:bg-navy-700"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-heading font-bold text-gray-900 dark:text-gray-100">
                                      {entry.name}
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                      {entry.description}
                                    </div>
                                  </div>
                                  <span className="shrink-0 text-[11px] font-heading font-bold uppercase tracking-[0.18em] text-primary-500 dark:text-primary-300">
                                    {summarizeTactic(entry, t)}
                                  </span>
                                </div>
                              </button>
                              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                                <button
                                  type="button"
                                  aria-label={t("tactics.renameTacticNamed", { name: entry.name })}
                                  title={t("tactics.renameTactic")}
                                  onClick={() => {
                                    if (entry.id === activeTactic.id) {
                                      setIsEditingName(true);
                                    } else {
                                      setPendingRename({ on: entry.id });
                                      onSelectTactic(entry.id);
                                    }
                                    setIsOpen(false);
                                    setSearch("");
                                  }}
                                  className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-primary-500/10 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-500 dark:hover:text-primary-300"
                                >
                                  <Pencil className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={t("tactics.deleteTacticNamed", { name: entry.name })}
                                  title={t("tactics.deleteTactic")}
                                  onClick={() => setPendingDelete(entry)}
                                  className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-gray-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <div className="mb-2 px-2 text-[11px] font-heading font-bold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
                        {t("tactics.presets")}
                      </div>
                      <div className="space-y-1">
                        {presetEntries.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            role="option"
                            aria-selected={entry.id === activeTactic.id}
                            onClick={() => {
                              onSelectTactic(entry.id);
                              setIsOpen(false);
                              setSearch("");
                            }}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                              entry.id === activeTactic.id
                                ? "border-primary-300 bg-primary-50 dark:border-primary-400 dark:bg-primary-500/10"
                                : "border-transparent bg-gray-50 hover:border-gray-200 hover:bg-white dark:bg-navy-700/70 dark:hover:border-navy-500 dark:hover:bg-navy-700"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-heading font-bold text-gray-900 dark:text-gray-100">
                                  {entry.name}
                                </div>
                                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                  {entry.description}
                                </div>
                              </div>
                              <span className="shrink-0 text-[11px] font-heading font-bold uppercase tracking-[0.18em] text-primary-500 dark:text-primary-300">
                                {summarizeTactic(entry, t)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 p-3 dark:border-white/8 dark:bg-navy-900/35">
              <div className="mb-2 text-[11px] font-heading font-bold uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
                {t("tactics.formation")}
              </div>
              <Select
                value={FORMATIONS.includes(formation) ? formation : FORMATIONS[0]}
                onChange={(e) => onFormationChange(e.target.value)}
                fullWidth
                aria-label={t("tactics.formation")}
              >
                {FORMATIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </div>

            <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 p-3 dark:border-white/8 dark:bg-navy-900/35">
              <div className="mb-2 text-[11px] font-heading font-bold uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
                {t("tactics.playStyle")}
              </div>
              <Select
                value={activePlayStyle}
                onChange={(e) => onPlayStyleChange(e.target.value)}
                fullWidth
                aria-label={t("tactics.playStyle")}
              >
                {PLAY_STYLES.map((style) => (
                  // Native <option> renders text only — an icon/span child is
                  // stripped by the browser and warns in React, so use plain text.
                  <option key={style.id} value={style.id}>
                    {t(`common.playStyles.${style.id}`, style.id)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      </div>
      {pendingDelete ? (
        <DashboardModalFrame maxWidthClassName="max-w-md">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-tactic-title"
            className="space-y-4"
          >
            <div>
              <h3
                id="delete-tactic-title"
                className="text-lg font-heading font-bold text-gray-900 dark:text-gray-100"
              >
                {t("tactics.deleteTacticConfirmTitle")}
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {t("tactics.deleteTacticConfirmBody", { name: pendingDelete.name })}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPendingDelete(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
                className="bg-red-500 hover:bg-red-600 active:bg-red-700 focus:ring-red-500"
              >
                {t("tactics.deleteTactic")}
              </Button>
            </div>
          </div>
        </DashboardModalFrame>
      ) : null}
    </Card>
  );
}
