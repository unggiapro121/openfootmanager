import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGameStore } from "../store/gameStore";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { BrandLockup } from "../components/ui/BrandMark";
import type { CareerStartPhase, CreateManagerFormData } from "../components/menu/CreateManagerForm";
import type { PackageInfo, PackageIssue } from "../components/menu/WorldSelect";
import { careerStartAgeMessage } from "../components/menu/coachAccountForm.helpers";
import CoachAccountCard from "../components/menu/CoachAccountCard";
import { applyExtraTranslations } from "../lib/extraTranslations";
import { initialPackageSelection } from "../lib/defaultWorldPackage";
import { REALISTIC_DEVELOPMENT_SPEED_PERCENT } from "../lib/developmentSpeed";
import { formatAppVersion } from "../lib/appVersion";
import { formatDateTime } from "../lib/dateFormatting";
import { resolveBackendError } from "../utils/backendI18n";
import { prewarmManagerSquadPortraits } from "../services/portraitService";
import {
  type CoachAccount,
  claimSaveForCoach,
  getActiveCoachAccount,
  getCoachAccountMode,
  logoutCoachAccount,
} from "../services/coachService";
import {
  installPackage,
  listInstalledPackages,
  uninstallPackage,
} from "../services/packageService";
import { destroyWindow, onBackendEvent } from "../services/platformService";
import {
  deleteSave,
  getActiveGame,
  listSaves,
  loadGame,
  type SaveEntry,
  startNewGame,
  type StartupOptionsPayload,
} from "../services/sessionService";
import {
  FolderOpen,
  Settings,
  PlusCircle,
  ChevronRight,
  Power,
  Package,
  Bug,
  Globe2,
} from "lucide-react";
import { DISCORD_INVITE_URL, GITHUB_REPO_URL } from "../lib/communityLinks";
import { ReportBugModal } from "../components/diagnostics/ReportBugModal";
import { showError } from "../lib/errorDialog";
import { prefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useBackAction } from "../hooks/useBackAction";
import { isMobileBuild } from "../lib/platform";

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.075.075 0 0 0-.079.038c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.974 0c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.085 3.292 9.387 7.86 10.91.575.107.785-.25.785-.555 0-.275-.01-1-.015-1.965-3.2.695-3.875-1.54-3.875-1.54-.525-1.33-1.28-1.685-1.28-1.685-1.045-.715.08-.7.08-.7 1.155.08 1.765 1.185 1.765 1.185 1.025 1.755 2.69 1.25 3.345.955.1-.745.4-1.25.725-1.54-2.555-.29-5.245-1.275-5.245-5.685 0-1.255.45-2.28 1.18-3.085-.12-.29-.515-1.46.11-3.05 0 0 .965-.31 3.165 1.18a10.95 10.95 0 0 1 2.88-.39c.98.005 1.965.135 2.885.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.235 2.76.115 3.05.735.805 1.18 1.83 1.18 3.085 0 4.42-2.695 5.39-5.265 5.675.41.355.78 1.055.78 2.125 0 1.535-.015 2.77-.015 3.15 0 .305.205.665.79.55C20.215 21.385 23.5 17.085 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const CreateManagerForm = lazy(() => import("../components/menu/CreateManagerForm"));
const CoachLogin = lazy(() => import("../components/menu/CoachLogin"));
const SavesList = lazy(() => import("../components/menu/SavesList"));
const PackageBuildStep = lazy(() => import("../components/menu/PackageBuildStep"));
const GenerationStep = lazy(() => import("../components/menu/WorldSelect"));

/**
 * Earliest year a career may start. Historical world packages recreate eras
 * decades before the modern game, so the floor only keeps the clock inside a
 * sane calendar range. Must match `MIN_START_YEAR` in `commands/game.rs`.
 */
const MIN_CAREER_START_YEAR = 1900;
const DEFAULT_GENERATED_HISTORY_DEPTH_YEARS = 12;
const MAX_GENERATED_HISTORY_DEPTH_YEARS = 24;
const GENERATED_HISTORY_DEPTH_STORAGE_KEY = "ofm-generated-history-depth-years";

function defaultCareerStartYear(): string {
  return String(new Date().getFullYear());
}

function parseCareerStartYear(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function isCareerStartPhase(value: string): value is CareerStartPhase {
  return value === "seasonStart" || value === "midSeason";
}

function normalizeHistoryDepthYears(value: number): number | null {
  if (!Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_GENERATED_HISTORY_DEPTH_YEARS) return null;
  return value;
}

function initialHistoryDepthYears(): number {
  if (typeof window === "undefined") {
    return DEFAULT_GENERATED_HISTORY_DEPTH_YEARS;
  }

  const storedValue = window.localStorage.getItem(GENERATED_HISTORY_DEPTH_STORAGE_KEY);
  if (storedValue === null) {
    return DEFAULT_GENERATED_HISTORY_DEPTH_YEARS;
  }

  const parsedValue = Number(storedValue);
  return normalizeHistoryDepthYears(parsedValue) ?? DEFAULT_GENERATED_HISTORY_DEPTH_YEARS;
}

function buildStartupOptions(
  formData: CreateManagerFormData,
  historyDepthYears: number,
  developmentSpeedPercent: number = REALISTIC_DEVELOPMENT_SPEED_PERCENT,
): StartupOptionsPayload | null {
  const startYear = parseCareerStartYear(formData.startYear);
  if (startYear === null || startYear < MIN_CAREER_START_YEAR) {
    return null;
  }
  if (!isCareerStartPhase(formData.startPhase)) {
    return null;
  }
  const normalizedHistoryDepthYears = normalizeHistoryDepthYears(historyDepthYears);
  if (normalizedHistoryDepthYears === null) {
    return null;
  }

  return {
    startYear,
    startPhase: formData.startPhase,
    historyDepthYears: normalizedHistoryDepthYears,
    developmentSpeedPercent,
  };
}

/** Why the coach cannot lead a career starting as `formData` says; null when he can. */
function careerStartAgeError(
  coach: CoachAccount,
  formData: CreateManagerFormData,
  historyDepthYears: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const startupOptions = buildStartupOptions(formData, historyDepthYears);
  if (!startupOptions) return null;
  return careerStartAgeMessage(
    coach.date_of_birth,
    startupOptions.startYear,
    startupOptions.startPhase,
    t,
  );
}

const CREATE_MANAGER_FIELD_ORDER = ["startYear", "startPhase"] as const satisfies ReadonlyArray<
  keyof CreateManagerFormData
>;

function deferFocusToNextPaint(callback: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(callback);
  });
}

function focusFirstCreateManagerError(
  errors: Partial<Record<keyof CreateManagerFormData, string>>,
): void {
  const first = CREATE_MANAGER_FIELD_ORDER.find((k) => errors[k]);
  if (!first) return;
  const root = document.getElementById(`create-manager-field-${first}`);
  root?.scrollIntoView?.({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  const focusable = root?.querySelector<HTMLElement>(
    "input:not([type=hidden]), button:not([disabled]), select, textarea",
  );
  focusable?.focus({ preventScroll: true });
}

function MenuPanelFallback() {
  return (
    <div className="flex min-h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
    </div>
  );
}

export default function MainMenu() {
  const navigate = useNavigate();
  const setGameActive = useGameStore((state) => state.setGameActive);
  const setGameState = useGameStore((state) => state.setGameState);
  const { t, i18n } = useTranslation();

  const [menuState, setMenuState] = useState<
    "main" | "create" | "packages" | "generation" | "load"
  >("main");
  // undefined while the backend is asked; null when nobody is logged in yet.
  const [coach, setCoach] = useState<CoachAccount | null | undefined>(undefined);
  // The online profile sends the player here after asking for his account's deletion (M3c1): the
  // login says when it goes, until someone logs in.
  const location = useLocation();
  const [deletionAt, setDeletionAt] = useState<string | null>(() => {
    const state = location.state as { accountDeletion?: unknown } | null;
    return typeof state?.accountDeletion === "string" ? state.accountDeletion : null;
  });
  const logInCoach = (account: CoachAccount) => {
    setDeletionAt(null);
    setCoach(account);
  };
  // Online play needs an account on the server (C-2 C2-1): the button shows only then.
  const [canPlayOnline, setCanPlayOnline] = useState(false);
  const [confirmClaimId, setConfirmClaimId] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveEntry[]>([]);
  const [isLoadingSaves, setIsLoadingSaves] = useState(false);
  const [loadingSaveId, setLoadingSaveId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [reportingBug, setReportingBug] = useState(false);
  // The phone app is online only (phase 5, DM-1): no offline entries, no quit button.
  const mobile = isMobileBuild();
  // The phone's Back steps out of a new game's or a save's screens to the menu.
  useBackAction(menuState !== "main", () => setMenuState("main"));

  const [formData, setFormData] = useState<CreateManagerFormData>({
    startYear: defaultCareerStartYear(),
    startPhase: "seasonStart",
  });
  const [formErrors, setFormErrors] = useState<
    Partial<Record<keyof CreateManagerFormData, string>>
  >({});

  // Installed packages state
  const [installedPackages, setInstalledPackages] = useState<PackageInfo[]>([]);
  const [activePackageIds, setActivePackageIds] = useState<string[]>([]);
  // Set by the player's first toggle. Read inside the async list reload, so a ref rather than
  // state: the reload must see a choice made while the request was in flight.
  const playerChosePackagesRef = useRef(false);
  const [isInstallingPackage, setIsInstallingPackage] = useState(false);
  const [packageStackErrors, setPackageStackErrors] = useState<PackageIssue[]>([]);
  const [historyDepthYears, setHistoryDepthYears] = useState(initialHistoryDepthYears);
  const [developmentSpeedPercent, setDevelopmentSpeedPercent] = useState<number>(
    REALISTIC_DEVELOPMENT_SPEED_PERCENT,
  );

  useEffect(() => {
    window.localStorage.setItem(GENERATED_HISTORY_DEPTH_STORAGE_KEY, String(historyDepthYears));
  }, [historyDepthYears]);

  useEffect(() => {
    if (!coach) return;
    getCoachAccountMode()
      .then((mode) => setCanPlayOnline(mode === "server"))
      .catch(() => setCanPlayOnline(false));
  }, [coach]);

  useEffect(() => {
    getActiveCoachAccount()
      .then((account) => setCoach(account ?? null))
      .catch((error) => {
        console.error("Failed to read the logged-in coach:", error);
        setCoach(null);
      });
  }, []);

  // Check if a game is already active (e.g. loaded by MCP --mcp-auto-start before frontend mounted)
  useEffect(() => {
    getActiveGame()
      .then((state) => {
        const mgrName = `${state.manager.first_name} ${state.manager.last_name}`;
        applyExtraTranslations(state.extra_translations);
        setGameState(state);
        setGameActive(true, mgrName);
        navigate("/dashboard");
      })
      .catch(() => {
        // No active game — stay on menu
      });
  }, [setGameState, setGameActive, navigate]);

  // Listen for game loaded by MCP auto-start (event may arrive after mount)
  useEffect(() => {
    const unlisten = onBackendEvent("game-state-changed", async () => {
      try {
        const state = await getActiveGame();
        const mgrName = `${state.manager.first_name} ${state.manager.last_name}`;
        applyExtraTranslations(state.extra_translations);
        setGameState(state);
        setGameActive(true, mgrName);
        navigate("/dashboard");
      } catch {
        // Game not actually active — ignore
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setGameState, setGameActive, navigate]);

  /** Same message as `validateForm` for the coach's age, so it surfaces as the year is edited. */
  const startAgeMessage = coach ? careerStartAgeError(coach, formData, historyDepthYears, t) : null;
  const displayedFormErrors = {
    ...formErrors,
    startYear: formErrors.startYear || startAgeMessage || undefined,
  };

  const updateFormField = (field: keyof CreateManagerFormData, value: string) => {
    setFormData((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const clearFormError = (field: keyof CreateManagerFormData) => {
    setFormErrors((previous) => ({
      ...previous,
      [field]: "",
    }));
  };

  const validateForm = (): {
    ok: boolean;
    errors: Partial<Record<keyof CreateManagerFormData, string>>;
  } => {
    const errors: Partial<Record<keyof CreateManagerFormData, string>> = {};
    if (!formData.startYear.trim()) {
      errors.startYear = t("validation.required", {
        field: t("createManager.startYear"),
      });
    } else {
      const startYear = parseCareerStartYear(formData.startYear);
      if (startYear === null || startYear < MIN_CAREER_START_YEAR) {
        errors.startYear = t("validation.minStartYear", {
          min: MIN_CAREER_START_YEAR,
        });
      }
    }
    if (!isCareerStartPhase(formData.startPhase)) {
      errors.startPhase = t("validation.required", {
        field: t("createManager.startPhase"),
      });
    }
    const ageError = coach ? careerStartAgeError(coach, formData, historyDepthYears, t) : null;
    if (!errors.startYear && ageError) {
      errors.startYear = ageError;
    }
    setFormErrors(errors);
    return {
      ok: Object.keys(errors).length === 0,
      errors,
    };
  };

  const handleGoToWorldSelect = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateForm();
    if (!validation.ok) {
      deferFocusToNextPaint(() => focusFirstCreateManagerError(validation.errors));
      return;
    }
    setMenuState("packages");
  };

  const loadInstalledPackages = async () => {
    try {
      const pkgs = await listInstalledPackages();
      // Tauri commands can resolve to null; never let installedPackages become
      // null or downstream `.filter` calls (here and in PackageBuildStep) throw.
      setInstalledPackages(pkgs ?? []);
      const installedIds = (pkgs ?? []).map((pkg) => pkg.id);
      setActivePackageIds((prev) =>
        initialPackageSelection(installedIds, prev, playerChosePackagesRef.current),
      );
    } catch (err) {
      console.error("Failed to list packages:", err);
    }
  };

  useEffect(() => {
    if (menuState === "packages") {
      void loadInstalledPackages();
    }
  }, [menuState]);

  const handleInstallPackage = async () => {
    const selected = await open({
      filters: [{ name: "OFM Package", extensions: ["ofm"] }],
      multiple: false,
      title: t("worldSelect.installPackage"),
    });
    if (typeof selected !== "string") return;
    setIsInstallingPackage(true);
    try {
      await installPackage(selected);
      await loadInstalledPackages();
    } catch (err) {
      console.error("Failed to install package:", err);
      await showError(t("errors.title"), resolveBackendError(err));
    } finally {
      setIsInstallingPackage(false);
    }
  };

  const handleUninstallPackage = async (id: string) => {
    try {
      await uninstallPackage(id);
      setInstalledPackages((prev) => prev.filter((p) => p.id !== id));
      setActivePackageIds((prev) => prev.filter((pid) => pid !== id));
      setPackageStackErrors([]);
    } catch (err) {
      console.error("Failed to uninstall package:", err);
      await showError(t("errors.title"), resolveBackendError(err));
    }
  };

  const handleTogglePackage = (id: string) => {
    playerChosePackagesRef.current = true;
    setActivePackageIds((prev) =>
      prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id],
    );
    setPackageStackErrors([]);
  };

  const handleStartGame = async () => {
    const startupOptions = buildStartupOptions(
      formData,
      historyDepthYears,
      developmentSpeedPercent,
    );
    if (!startupOptions) {
      const validation = validateForm();
      if (validation.ok) {
        // The two disagreed: `buildStartupOptions` rejected something `validateForm` does not
        // check. Today that is only the generated-history depth, which lives on the world screen
        // and has no field on this form — so bouncing to the create step would put the player in
        // front of a form with no errors on it and no way to tell what was wrong. Say so instead.
        await showError(t("errors.title"), t("menu.startupOptionsRejected"));
        return;
      }
      setMenuState("create");
      deferFocusToNextPaint(() => focusFirstCreateManagerError(validation.errors));
      return;
    }

    setIsStarting(true);
    try {
      const game = await startNewGame({
        startupOptions,
        packageIds: activePackageIds.length > 0 ? activePackageIds : undefined,
      });
      applyExtraTranslations(game.extra_translations);
      setGameState(game);
      navigate("/select-team");
    } catch (error) {
      console.error("Failed to start game:", error);
      await showError(
        t("errors.title"),
        t("menu.failedStartGame", { error: resolveBackendError(error) }),
      );
    } finally {
      setIsStarting(false);
    }
  };

  const handleOpenLoadMenu = async () => {
    setMenuState("load");
    setIsLoadingSaves(true);
    try {
      const dbSaves = await listSaves();
      // Another account's careers are not this coach's to see; one from before
      // accounts is offered to him, to claim on opening.
      setSaves(dbSaves.filter((save) => !save.account_id || save.account_id === coach?.id));
    } catch (error) {
      console.error("Failed to load saves:", error);
    } finally {
      setIsLoadingSaves(false);
    }
  };

  const handleLoadGame = async (saveId: string) => {
    setLoadingSaveId(saveId);
    try {
      const managerName = await loadGame(saveId);
      const activeGame = await getActiveGame();
      try {
        await prewarmManagerSquadPortraits(activeGame);
      } catch (portraitError) {
        console.warn("Portrait prewarm failed during save load:", portraitError);
      }
      setGameState(activeGame);
      setGameActive(true, managerName);
      navigate("/dashboard");
    } catch (error) {
      console.error("Failed to load game:", error);
      setLoadingSaveId(null);
      await showError(
        t("errors.title"),
        t("menu.loadGameFailed", { error: resolveBackendError(error) }),
      );
    }
  };

  const handleDeleteSave = async (saveId: string) => {
    try {
      await deleteSave(saveId);
      setSaves((prev) => prev.filter((s) => s.id !== saveId));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error("Failed to delete save:", error);
    }
  };

  const handleClaimSave = async (saveId: string) => {
    setConfirmClaimId(null);
    try {
      await claimSaveForCoach(saveId);
      setSaves((previous) =>
        previous.map((save) => (save.id === saveId ? { ...save, account_id: coach?.id } : save)),
      );
    } catch (error) {
      console.error("Failed to claim save:", error);
      await showError(
        t("errors.title"),
        t("menu.loadGameFailed", { error: resolveBackendError(error) }),
      );
      return;
    }
    await handleLoadGame(saveId);
  };

  const handleSwitchCoach = async () => {
    try {
      await logoutCoachAccount();
    } catch (error) {
      console.error("Failed to log out:", error);
    }
    setMenuState("main");
    setCoach(null);
  };

  const handleExitApp = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await destroyWindow();
    } catch (error) {
      console.error("Failed to exit app:", error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-navy-900 transition-colors duration-500 relative overflow-x-hidden pt-[var(--safe-top)] pb-[var(--safe-bottom)] max-md:px-4 max-md:pt-[calc(4.5rem+var(--safe-top))] max-md:pb-[calc(4rem+var(--safe-bottom))]">
      {/* Background gradient accents */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-500/10 dark:bg-primary-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent-400/10 dark:bg-accent-400/5 rounded-full blur-3xl" />
      </div>

      {/* Theme Toggle */}
      <ThemeToggle className="absolute top-[calc(1.5rem+var(--safe-top))] right-6 z-20" />

      {/* Main Card */}
      <div className="relative z-10 w-full max-w-md">
        {/* Top accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-primary-500 via-accent-400 to-primary-500 rounded-t-2xl" />

        <div className="bg-white dark:bg-navy-800 p-8 max-md:p-5 rounded-b-2xl shadow-xl dark:shadow-2xl border border-gray-200 dark:border-navy-600 border-t-0 transition-all duration-500">
          {/* Logo */}
          <div className="flex justify-center">
            <BrandLockup
              layout="vertical"
              tagline
              symbolClassName="h-28 w-28 max-md:h-16 max-md:w-16"
              nameClassName="text-5xl max-md:text-3xl"
            />
          </div>

          <div className="border-t border-gray-200 dark:border-navy-600 my-8 max-md:my-5 transition-colors duration-500" />

          {/* Login gate: nothing below until the player is a coach */}
          {coach === undefined && <MenuPanelFallback />}
          {coach === null && (
            <Suspense fallback={<MenuPanelFallback />}>
              <CoachLogin
                onLoggedIn={logInCoach}
                notice={
                  deletionAt
                    ? t("coachServer.deletionRequested", {
                        date: formatDateTime(deletionAt, i18n.language),
                      })
                    : undefined
                }
              />
            </Suspense>
          )}

          {/* Main Menu */}
          {coach && menuState === "main" && (
            <div className="flex flex-col gap-3">
              <CoachAccountCard
                coach={coach}
                onSwitch={() => {
                  void handleSwitchCoach();
                }}
              />

              {!mobile && (
                <>
                  <button
                    type="button"
                    onClick={() => setMenuState("create")}
                    className="group flex items-center justify-between w-full p-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl transition-all duration-300 shadow-md hover:shadow-lg hover:shadow-primary-500/20"
                  >
                    <div className="flex items-center gap-3">
                      <PlusCircle className="w-6 h-6" />
                      <span className="font-heading font-bold text-lg uppercase tracking-wide">
                        {t("menu.newGame")}
                      </span>
                    </div>
                    <ChevronRight className="w-5 h-5 opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenLoadMenu}
                    className="group flex items-center justify-between w-full p-4 bg-white dark:bg-navy-700 hover:bg-gray-50 dark:hover:bg-navy-600 text-gray-800 dark:text-gray-200 rounded-xl transition-all duration-300 border border-gray-200 dark:border-navy-600 hover:border-accent-400 dark:hover:border-accent-400 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <FolderOpen className="w-6 h-6 text-accent-500 dark:text-accent-400" />
                      <span className="font-heading font-bold text-lg uppercase tracking-wide">
                        {t("menu.loadGame")}
                      </span>
                    </div>
                    <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all text-accent-500" />
                  </button>
                </>
              )}

              {canPlayOnline && (
                <button
                  type="button"
                  onClick={() => navigate("/online")}
                  className="group flex items-center justify-between w-full p-4 bg-white dark:bg-navy-700 hover:bg-gray-50 dark:hover:bg-navy-600 text-gray-800 dark:text-gray-200 rounded-xl transition-all duration-300 border border-gray-200 dark:border-navy-600 hover:border-primary-400 dark:hover:border-primary-400 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <Globe2 className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    <span className="font-heading font-bold text-lg uppercase tracking-wide">
                      {t("online.menuButton")}
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all text-primary-500" />
                </button>
              )}

              {!mobile && (
                <button
                  type="button"
                  onClick={() => navigate("/world-editor")}
                  className="group flex items-center justify-between w-full p-4 bg-white dark:bg-navy-700 hover:bg-gray-50 dark:hover:bg-navy-600 text-gray-800 dark:text-gray-200 rounded-xl transition-all duration-300 border border-gray-200 dark:border-navy-600 hover:border-accent-400 dark:hover:border-accent-400 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <Package className="w-6 h-6 text-accent-500 dark:text-accent-400" />
                    <span className="font-heading font-bold text-lg uppercase tracking-wide">
                      {t("menu.worldEditor")}
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all text-accent-500" />
                </button>
              )}

              <button
                type="button"
                onClick={() => navigate("/settings", { state: { from: "/" } })}
                className="group flex items-center justify-between w-full p-4 bg-white dark:bg-navy-700 hover:bg-gray-50 dark:hover:bg-navy-600 text-gray-800 dark:text-gray-200 rounded-xl transition-all duration-300 border border-gray-200 dark:border-navy-600 hover:border-gray-300 dark:hover:border-navy-600 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <Settings className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                  <span className="font-heading font-bold text-lg uppercase tracking-wide">
                    {t("menu.settings")}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all text-gray-400" />
              </button>

              {!mobile && (
                <button
                  type="button"
                  onClick={() => {
                    void handleExitApp();
                  }}
                  className="group flex items-center justify-between w-full p-4 bg-white dark:bg-navy-700 hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-800 dark:text-gray-200 rounded-xl transition-all duration-300 border border-gray-200 dark:border-navy-600 hover:border-red-200 dark:hover:border-red-500/30 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <Power className="w-6 h-6 text-red-500 dark:text-red-400" />
                    <span className="font-heading font-bold text-lg uppercase tracking-wide">
                      {t("menu.exitGame")}
                    </span>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Step 1: Create Manager Form */}
          {coach && menuState === "create" && (
            <Suspense fallback={<MenuPanelFallback />}>
              <CreateManagerForm
                formData={formData}
                formErrors={displayedFormErrors}
                coach={coach}
                onChange={updateFormField}
                onClearError={clearFormError}
                onClose={() => {
                  setMenuState("main");
                  setFormErrors({});
                }}
                onSubmit={handleGoToWorldSelect}
              />
            </Suspense>
          )}

          {/* Step 2a: Build Your World (package selection) */}
          {coach && menuState === "packages" && (
            <Suspense fallback={<MenuPanelFallback />}>
              <PackageBuildStep
                installedPackages={installedPackages}
                activePackageIds={activePackageIds}
                isInstallingPackage={isInstallingPackage}
                packageStackErrors={packageStackErrors}
                onTogglePackage={handleTogglePackage}
                onInstallPackage={handleInstallPackage}
                onUninstallPackage={handleUninstallPackage}
                onNext={() => setMenuState("generation")}
                onBack={() => setMenuState("create")}
                onClose={() => setMenuState("main")}
              />
            </Suspense>
          )}

          {/* Step 2b: Generation & Completion */}
          {coach && menuState === "generation" && (
            <Suspense fallback={<MenuPanelFallback />}>
              <GenerationStep
                isStarting={isStarting}
                startYear={parseCareerStartYear(formData.startYear) ?? MIN_CAREER_START_YEAR}
                startPhase={formData.startPhase}
                historyDepthYears={historyDepthYears}
                onChangeHistoryDepthYears={setHistoryDepthYears}
                developmentSpeedPercent={developmentSpeedPercent}
                onChangeDevelopmentSpeedPercent={setDevelopmentSpeedPercent}
                onStart={handleStartGame}
                onBack={() => setMenuState("packages")}
                onClose={() => setMenuState("main")}
                activePackages={installedPackages.filter((p) => activePackageIds.includes(p.id))}
              />
            </Suspense>
          )}

          {/* Load Game List */}
          {coach && menuState === "load" && (
            <Suspense fallback={<MenuPanelFallback />}>
              <SavesList
                loadingSaveId={loadingSaveId}
                saves={saves}
                isLoading={isLoadingSaves}
                confirmDeleteId={confirmDeleteId}
                confirmClaimId={confirmClaimId}
                coachName={`${coach.first_name} ${coach.last_name}`}
                onLoad={handleLoadGame}
                onClaim={(saveId) => {
                  void handleClaimSave(saveId);
                }}
                onConfirmClaim={setConfirmClaimId}
                onDelete={handleDeleteSave}
                onConfirmDelete={setConfirmDeleteId}
                onClose={() => setMenuState("main")}
              />
            </Suspense>
          )}

          {/* Package Editor */}
        </div>
      </div>

      {/* Community links. Not on the phone app (phase 5 M2b, K5): they lead to the original
          project's Discord and tracker, and Eleven Saga has no support channel of its own yet. */}
      {!mobile && (
        <div className="absolute bottom-[calc(0.75rem+var(--safe-bottom))] left-4 flex items-center gap-1">
          <button
            type="button"
            aria-label={t("menu.openDiscord")}
            title={t("menu.openDiscord")}
            onClick={() => {
              void openUrl(DISCORD_INVITE_URL);
            }}
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-600 hover:text-[#5865F2] dark:hover:text-[#7289DA] hover:bg-gray-100 dark:hover:bg-navy-700 transition-colors"
          >
            <DiscordIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            aria-label={t("menu.openGithub")}
            title={t("menu.openGithub")}
            onClick={() => {
              void openUrl(GITHUB_REPO_URL);
            }}
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-600 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-navy-700 transition-colors"
          >
            <GithubIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            aria-label={t("menu.reportBug")}
            title={t("menu.reportBug")}
            onClick={() => setReportingBug(true)}
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-600 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-navy-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-900"
          >
            <Bug className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Version */}
      <div className="absolute bottom-[calc(1rem+var(--safe-bottom))] right-4 text-gray-400 dark:text-gray-600 text-xs font-heading uppercase tracking-widest transition-colors">
        {formatAppVersion()}
      </div>

      {reportingBug && <ReportBugModal onClose={() => setReportingBug(false)} />}
    </div>
  );
}
