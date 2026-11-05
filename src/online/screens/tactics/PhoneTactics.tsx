import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Copy, Lock, Plus, Save, Target } from "lucide-react";
import { licenceLock } from "../../../components/tactics/licenceLimits";
import type { TacticsLibraryEntry } from "../../../components/tactics/TacticsCommandBar";
import type { TacticsBoardSource } from "../../../components/tactics/tacticsBoardSource";
import { useTacticsLibrary } from "../../../components/tactics/useTacticsLibrary";
import { useTacticsLineup } from "../../../components/tactics/useTacticsLineup";
import type { MyClubView, StyleMasteryView } from "../../api";
import { formatMoment } from "../../format";
import LicenceNotice from "../LicenceNotice";
import { PhoneHeaderPart } from "../mobile/PhoneHeaderSlots";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";
import { KEY, PhoneTacticsLineup } from "./PhoneTacticsLineup";
import { PhonePlayerRoles, PhoneTacticsPhase, PhoneTacticsRoles } from "./PhoneTacticsRoles";
import { PhoneTacticsStyle } from "./PhoneTacticsStyle";

type Tab = "lineup" | "style" | "roles" | "phase";
const TABS: Tab[] = ["lineup", "style", "roles", "phase"];
type Library = ReturnType<typeof useTacticsLibrary>;
const SECTION =
  "-mb-1 font-heading text-[13px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400";

/**
 * The tactics page on a phone (design m-chien-thuat): the tactic in use and its save in the app
 * bar, four tabs (line-up, style, roles, phases), and sheets to pick a tactic and save one. It
 * works on the same board source as the desktop board, so every change is the server's to keep.
 */
export default function PhoneTactics({
  club,
  source,
  notice,
  mastery,
  setAssistant,
  locked,
  kickoffAt,
}: {
  club: MyClubView;
  source: TacticsBoardSource;
  /** What the last write said (the desktop's notice). */
  notice: React.ReactNode;
  mastery: StyleMasteryView[] | null;
  setAssistant: (on: boolean) => Promise<void>;
  locked: boolean;
  kickoffAt: string | null;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("lineup");
  const [sheet, setSheet] = useState<"tactics" | "save" | null>(null);
  const lineup = useTacticsLineup({ source });
  const library = useTacticsLibrary({
    gameState: null,
    libraryKey: `ofm:tactics:custom:online:${club.club.id}`,
    formation: lineup.formation,
    activePlayStyle: lineup.activePlayStyle,
    initialPreset: lineup.initialPreset,
    onFormationChange: lineup.handleFormationChange,
    onPlayStyleChange: lineup.handlePlayStyleChange,
    tacticsPhase: lineup.team?.tactics_phase,
    onTacticsPhaseChange: lineup.handleTacticsPhaseChange,
  });

  return (
    <div className="-mx-3 -mt-3 flex flex-col">
      <PhoneHeaderPart place="below">
        <TacticBar
          library={library}
          formation={lineup.formation}
          playStyle={lineup.activePlayStyle}
          onOpen={() => setSheet("tactics")}
          onSave={() => setSheet("save")}
        />
        <div
          role="tablist"
          aria-label={t(`${KEY}.tabs`)}
          className="grid grid-cols-4 border-t border-gray-200 px-2 dark:border-navy-700"
        >
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px h-[42px] whitespace-nowrap border-b-2 font-heading text-sm font-bold uppercase tracking-wide ${tab === id ? "border-primary-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 dark:text-gray-400"} ${FOCUS}`}
            >
              {t(`${KEY}.tab.${id}`)}
            </button>
          ))}
        </div>
      </PhoneHeaderPart>

      <main className="flex flex-col gap-3 px-4 pb-6 pt-3">
        {locked && (
          <p
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-accent-400 bg-accent-50 px-3 py-2.5 text-[13px] leading-snug text-gray-800 dark:border-accent-500/60 dark:bg-accent-500/10 dark:text-accent-100"
          >
            <Lock
              className="mt-0.5 h-4 w-4 shrink-0 text-accent-700 dark:text-accent-400"
              aria-hidden="true"
            />
            {kickoffAt
              ? t("online.tactics.locked", { time: formatMoment(kickoffAt, i18n.language) })
              : t("online.tactics.lockedNow")}
          </p>
        )}
        <LicenceNotice />
        {notice}
        {tab === "lineup" && (
          <PhoneTacticsLineup
            club={club}
            lineup={lineup}
            setStartingXi={source.setStartingXi}
            setAssistant={setAssistant}
            locked={locked}
          />
        )}
        {tab === "style" && (
          <PhoneTacticsStyle
            formation={lineup.formation}
            playStyle={lineup.activePlayStyle}
            mastery={mastery}
            limits={source.limits}
            locked={locked}
            onFormation={(formation) => void lineup.handleFormationChange(formation)}
            onPlayStyle={(style) => void lineup.handlePlayStyleChange(style)}
          />
        )}
        {tab === "roles" && (
          <>
            <h2 className={SECTION}>{t("tactics.playerRoleLabel")}</h2>
            <PhonePlayerRoles
              slots={lineup.pitchSlots}
              playerRoles={lineup.team?.player_roles}
              limits={source.limits}
              locked={locked}
              onRole={(playerId, role) =>
                void source.setPlayerRole(playerId, role).catch(() => undefined)
              }
            />
            <h2 className={SECTION}>{t("tactics.responsibilities")}</h2>
          </>
        )}
        {tab === "roles" && (
          <PhoneTacticsRoles
            starters={lineup.startingXI}
            roles={lineup.effectiveMatchRoles}
            locked={locked}
            onAssign={(role, playerId) => void lineup.handleAssignMatchRole(role, playerId)}
            onRoles={(roles) => void source.setMatchRoles(roles).catch(() => undefined)}
          />
        )}
        {tab === "phase" && (
          <PhoneTacticsPhase
            phase={lineup.team?.tactics_phase}
            limits={source.limits}
            locked={locked}
            onChange={(patch) => void lineup.handleTacticsPhaseChange(patch)}
          />
        )}
      </main>

      {sheet === "tactics" && (
        <TacticSheet
          library={library}
          source={source}
          locked={locked}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "save" && <SaveSheet library={library} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** The tactic in use: its name and kind, its shape and style, and whether it is saved. */
function TacticBar({
  library,
  formation,
  playStyle,
  onOpen,
  onSave,
}: {
  library: Library;
  formation: string;
  playStyle: string;
  onOpen: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const tactic = library.activeTactic;
  const dirty = library.isCommandBarDirty;
  const custom = tactic.type === "custom";
  return (
    <div className="flex items-stretch gap-2 border-t border-gray-200 px-3 py-2 dark:border-navy-700">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
        className={`flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border bg-white px-2.5 py-1.5 text-left dark:bg-navy-900 ${dirty ? "border-accent-500" : "border-gray-200 dark:border-navy-700"} ${FOCUS}`}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300"
        >
          <Target className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-heading text-[17px] font-bold tracking-wide text-gray-900 dark:text-white">
              {tactic.name}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 text-[10px] font-bold uppercase leading-4 ${custom ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300" : "bg-primary-100 text-primary-800 dark:bg-primary-900/60 dark:text-primary-300"}`}
            >
              {t(custom ? `${KEY}.tagMine` : "tactics.presets")}
            </span>
          </span>
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">
            {formation} · {t(`common.playStyles.${playStyle}`)} ·{" "}
            <span
              className={
                dirty
                  ? "text-accent-700 dark:text-accent-400"
                  : "text-primary-700 dark:text-primary-400"
              }
            >
              {t(dirty ? "tactics.unsavedChanges" : "tactics.synced")}
            </span>
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </button>
      {dirty && (
        <button
          type="button"
          onClick={onSave}
          aria-haspopup="dialog"
          aria-label={t(custom ? "tactics.updateTactic" : "tactics.saveAsTactic")}
          className={`flex w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-accent-500 text-[10px] font-bold text-navy-900 ${FOCUS}`}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {t("common.save")}
        </button>
      )}
    </div>
  );
}

const SHEET_BUTTON = `inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] border border-gray-200 text-[13px] font-semibold text-gray-800 dark:border-navy-700 dark:text-gray-100 ${FOCUS}`;

/** The tactics to pick from: the coach's own, then the presets; a new one, or a copy. */
function TacticSheet({
  library,
  source,
  locked,
  onClose,
}: {
  library: Library;
  source: TacticsBoardSource;
  locked: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const groups = [
    {
      label: t("tactics.myTactics"),
      items: library.tacticLibrary.filter((entry) => entry.type === "custom"),
    },
    {
      label: t("tactics.presets"),
      items: library.tacticLibrary.filter((entry) => entry.type === "preset"),
    },
  ].filter((group) => group.items.length > 0);
  // A tactic is closed when its shape or its style is: choosing it would set one.
  const closed = (entry: TacticsLibraryEntry) =>
    licenceLock(source.limits, { kind: "formation", value: entry.formation }) ??
    licenceLock(source.limits, { kind: "playStyle", value: entry.playStyle });
  return (
    <PhoneSheet title={t("tactics.chooseTactic")} onClose={onClose}>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {group.label}
          </span>
          {group.items.map((entry) => {
            const on = entry.id === library.activeTactic.id;
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={on}
                disabled={locked || closed(entry) !== null}
                onClick={() => {
                  void library.applyTacticSelection(entry);
                  onClose();
                }}
                className={`flex min-h-[60px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left disabled:opacity-50 ${on ? "border-primary-500 bg-primary-50 dark:bg-primary-900/35" : "border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-900"} ${FOCUS}`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-heading text-[17px] font-bold text-gray-900 dark:text-white">
                    {entry.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {entry.formation} · {t(`common.playStyles.${entry.playStyle}`)}
                  </span>
                </span>
                {on && (
                  <Check
                    className="h-5 w-5 text-primary-600 dark:text-primary-400"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            library.handleCreateCustomTactic();
            onClose();
          }}
          className={SHEET_BUTTON}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("tactics.newTactic")}
        </button>
        <button
          type="button"
          onClick={() => {
            library.handleDuplicateTactic();
            onClose();
          }}
          className={SHEET_BUTTON}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          {t("tactics.duplicateTactic")}
        </button>
      </div>
    </PhoneSheet>
  );
}

/** Saving the changed tactic as one of the coach's own, under a name; or dropping the changes. */
function SaveSheet({ library, onClose }: { library: Library; onClose: () => void }) {
  const { t } = useTranslation();
  const tactic = library.activeTactic;
  const custom = tactic.type === "custom";
  return (
    <PhoneSheet
      title={t(custom ? "tactics.updateTactic" : "tactics.saveAsTactic")}
      onClose={onClose}
    >
      <p className="text-[13px] leading-normal text-gray-700 dark:text-gray-300">
        {t(`${KEY}.saveBody`, { name: tactic.name })}
      </p>
      <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
        {t("tactics.tacticName")}
        <input
          type="text"
          value={library.draftTacticName}
          maxLength={40}
          onChange={(event) => library.setDraftTacticName(event.target.value)}
          className="h-12 rounded-[10px] border border-gray-300 bg-white px-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-900 dark:text-white"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            void library.applyTacticSelection(tactic);
            onClose();
          }}
          className={`h-12 rounded-[10px] border border-gray-300 text-sm font-semibold text-gray-700 dark:border-navy-600 dark:text-gray-200 ${FOCUS}`}
        >
          {t(`${KEY}.discard`)}
        </button>
        <button
          type="button"
          onClick={() => {
            library.handleSaveTactic();
            onClose();
          }}
          className={`h-12 rounded-[10px] bg-accent-500 font-heading text-base font-bold uppercase tracking-wider text-navy-900 ${FOCUS}`}
        >
          {t("common.save")}
        </button>
      </div>
    </PhoneSheet>
  );
}
