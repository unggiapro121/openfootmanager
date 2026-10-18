import { useEffect, useId, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw, Target } from "lucide-react";
import TacticsBoard from "../../tactics/TacticsBoard";
import { Badge, Button } from "../../ui";
import { useEditorTacticsSource } from "./useEditorTacticsSource";
import type { PlayerDef, TeamDef, TeamTacticsDef } from "./types";

interface TeamTacticsEditorProps {
  team: TeamDef;
  /** The authored players whose `club` is this team. */
  clubPlayers: PlayerDef[];
  baseYear: number | null;
  onChange: (tactics: TeamTacticsDef | null) => void;
  onPlayStyleChange: (playStyle: string) => void;
  onError: (err: unknown) => void;
}

/** The parts of `tactics` the author has set, as short labels. */
function setParts(tactics: TeamTacticsDef, t: TFunction): string[] {
  const parts: string[] = [];
  if (tactics.formation) {
    parts.push(t("worldEditor.tactics.setFormation", { formation: tactics.formation }));
  }
  if (tactics.startingXi?.length) parts.push(t("worldEditor.tactics.setEleven"));
  if (tactics.playerRoles && Object.keys(tactics.playerRoles).length > 0) {
    parts.push(t("worldEditor.tactics.setRoles"));
  }
  if (tactics.matchRoles) parts.push(t("worldEditor.tactics.setMatchRoles"));
  if (tactics.phase) parts.push(t("worldEditor.tactics.setPhase"));
  return parts;
}

/**
 * A club's opening tactics in the world editor: what is set, and the game's
 * own tactics board — line-up, roles, set pieces, play style and phase
 * settings — to change it.
 */
export function TeamTacticsEditor(props: TeamTacticsEditorProps) {
  const { team, clubPlayers, onChange } = props;
  const { t } = useTranslation();
  const headingId = useId();
  const [boardOpen, setBoardOpen] = useState(false);
  const parts = team.tactics ? setParts(team.tactics, t) : [];

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-navy-600 dark:bg-navy-800"
    >
      <div className="flex flex-col gap-1">
        <h3
          id={headingId}
          className="font-heading text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white"
        >
          {t("worldEditor.tactics.title")}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("worldEditor.tactics.intro")}</p>
      </div>

      {parts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {parts.map((part) => (
            <Badge key={part} variant="primary" size="sm">
              {part}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("worldEditor.tactics.summaryAuto")}
        </p>
      )}
      {clubPlayers.length === 0 && (
        <p className="text-xs text-accent-700 dark:text-accent-400">
          {t("worldEditor.tactics.noPlayers")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setBoardOpen(true)}>
          <Target className="h-4 w-4" aria-hidden="true" />
          {t("worldEditor.tactics.openBoard")}
        </Button>
        {team.tactics && (
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(null)}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t("worldEditor.tactics.resetToAuto")}
          </Button>
        )}
      </div>

      {boardOpen && <TacticsBoardDialog {...props} onClose={() => setBoardOpen(false)} />}
    </section>
  );
}

/** The game's tactics board over the whole window, editing this club. */
function TacticsBoardDialog({
  team,
  clubPlayers,
  baseYear,
  onChange,
  onPlayStyleChange,
  onError,
  onClose,
}: TeamTacticsEditorProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const source = useEditorTacticsSource({
    team,
    clubPlayers,
    baseYear,
    onTacticsChange: onChange,
    onPlayStyleChange,
    onError,
  });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 overflow-y-auto bg-gray-100 p-6 dark:bg-navy-900"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2
          id={titleId}
          className="font-heading text-xl font-bold uppercase tracking-wide text-gray-900 dark:text-white"
        >
          {t("worldEditor.tactics.boardTitle", { team: team.name || team.id })}
        </h2>
        <div className="flex gap-2">
          {team.tactics && (
            <Button type="button" variant="outline" onClick={() => onChange(null)}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("worldEditor.tactics.resetToAuto")}
            </Button>
          )}
          {/* biome-ignore lint/a11y/noAutofocus: the dialog's way out takes focus when it opens */}
          <Button type="button" autoFocus onClick={onClose}>
            {t("worldEditor.tactics.done")}
          </Button>
        </div>
      </div>
      {source ? (
        <TacticsBoard source={source} libraryGame={null} coach={null} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("common.loading")}
        </p>
      )}
    </div>
  );
}
