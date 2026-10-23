import { Trans, useTranslation } from "react-i18next";
import { formatDate } from "../../lib/helpers";
import { resolveBackendText } from "../../utils/backendI18n";
import { Play, Clock, Trash2, X, Loader2 } from "lucide-react";

/**
 * A save created by the game stores its name as a translation key plus the
 * manager's name; one the player renamed is plain text and resolves to itself,
 * as does every save written before the key existed.
 */
function saveDisplayName(name: string): string {
  return resolveBackendText(name, name);
}

interface SaveEntry {
  id: string;
  name: string;
  manager_name: string;
  team_name: string;
  db_filename: string;
  checksum: string;
  created_at: string;
  last_played_at: string;
  account_id?: string | null;
}

interface SavesListProps {
  saves: SaveEntry[];
  isLoading: boolean;
  loadingSaveId?: string | null;
  confirmDeleteId: string | null;
  /** The career from before accounts the player is asked to attach to his coach. */
  confirmClaimId: string | null;
  coachName: string;
  onLoad: (saveId: string) => void;
  onClaim: (saveId: string) => void;
  onConfirmClaim: (saveId: string | null) => void;
  onDelete: (saveId: string) => void;
  onConfirmDelete: (saveId: string | null) => void;
  onClose: () => void;
}

export default function SavesList({
  saves,
  isLoading,
  loadingSaveId,
  confirmDeleteId,
  confirmClaimId,
  coachName,
  onLoad,
  onClaim,
  onConfirmClaim,
  onDelete,
  onConfirmDelete,
  onClose,
}: SavesListProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-heading font-bold uppercase tracking-wide text-gray-900 dark:text-white transition-colors">
          {t("menu.loadGame")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-navy-600"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-8 text-gray-500 dark:text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            <span className="text-sm font-heading uppercase tracking-wider">
              {t("menu.loadingSaves")}
            </span>
          </div>
        ) : saves.length === 0 ? (
          <div className="text-gray-500 dark:text-gray-400 text-center py-8">
            {t("menu.noSaves")}
          </div>
        ) : (
          saves.map((save) => (
            <div
              key={save.id}
              className="group relative flex flex-col gap-2 w-full p-4 bg-white dark:bg-navy-700 hover:bg-primary-50 dark:hover:bg-navy-600 text-left rounded-xl transition-all duration-200 border border-gray-200 dark:border-navy-600 hover:border-primary-400 dark:hover:border-primary-500 shadow-sm"
            >
              {confirmClaimId === save.id ? (
                <div
                  role="alertdialog"
                  aria-label={t("coach.claimSave")}
                  className="flex flex-col gap-2"
                >
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {t("coach.claimSaveConfirm", { name: coachName })}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onClaim(save.id)}
                      className="flex-1 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-heading font-bold uppercase tracking-wider rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
                    >
                      {t("coach.claimSave")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onConfirmClaim(null)}
                      className="flex-1 py-2 bg-gray-200 dark:bg-navy-600 hover:bg-gray-300 dark:hover:bg-navy-500 text-gray-700 dark:text-gray-300 text-sm font-heading font-bold uppercase tracking-wider rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
                    >
                      {t("menu.cancel")}
                    </button>
                  </div>
                </div>
              ) : confirmDeleteId === save.id ? (
                <div className="flex flex-col gap-2">
                  {/* The string carries its own <strong> markup, which Trans
                      renders as an element; the save name is player text and
                      stays text. `escapeValue` is globally false
                      (src/i18n/index.ts), so it is re-enabled here and the
                      escaped name shown as written (`shouldUnescape`). */}
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    <Trans
                      i18nKey="menu.deleteConfirm"
                      values={{ name: saveDisplayName(save.name) }}
                      components={{ strong: <strong /> }}
                      tOptions={{ interpolation: { escapeValue: true } }}
                      shouldUnescape
                    />
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onDelete(save.id)}
                      className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-heading font-bold uppercase tracking-wider rounded-lg transition-colors"
                    >
                      {t("menu.delete")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onConfirmDelete(null)}
                      className="flex-1 py-2 bg-gray-200 dark:bg-navy-600 hover:bg-gray-300 dark:hover:bg-navy-500 text-gray-700 dark:text-gray-300 text-sm font-heading font-bold uppercase tracking-wider rounded-lg transition-colors"
                    >
                      {t("menu.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 w-full">
                  <button
                    type="button"
                    onClick={() => (save.account_id ? onLoad(save.id) : onConfirmClaim(save.id))}
                    className="flex flex-col gap-2 flex-1 text-left min-w-0"
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="font-heading font-bold text-gray-900 dark:text-white text-lg uppercase tracking-wide truncate">
                        {saveDisplayName(save.name)}
                      </span>
                      {loadingSaveId === save.id ? (
                        <Loader2 className="w-4 h-4 text-primary-500 animate-spin flex-shrink-0" />
                      ) : (
                        <Play className="w-4 h-4 text-primary-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex justify-between items-center w-full text-sm text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-2">
                        {save.team_name.trim() || t("managersWorld.unemployed")}
                        {save.account_id ? null : (
                          <span className="rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-heading font-bold uppercase tracking-wider text-accent-800 dark:bg-accent-500/20 dark:text-accent-300">
                            {t("coach.unclaimedSave")}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatDate(save.last_played_at, i18n.language)}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfirmDelete(save.id);
                    }}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    title={t("menu.deleteSave")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
