import { useTranslation } from "react-i18next";
import { Button, CountryFlag, Select } from "../ui";
import { AlertCircle, ChevronRight, X } from "lucide-react";
import type { CoachAccount } from "../../services/coachService";

/** When a new career starts; who leads it is the logged-in coach account. */
export interface CreateManagerFormData {
  startYear: string;
  startPhase: CareerStartPhase;
}

export type CareerStartPhase = "seasonStart" | "midSeason";

type CreateManagerField = keyof CreateManagerFormData;

interface CreateManagerFormProps {
  formData: CreateManagerFormData;
  formErrors: Partial<Record<CreateManagerField, string>>;
  coach: CoachAccount;
  onChange: (field: CreateManagerField, value: string) => void;
  onClearError: (field: CreateManagerField) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export default function CreateManagerForm({
  formData,
  formErrors,
  coach,
  onChange,
  onClearError,
  onClose,
  onSubmit,
}: CreateManagerFormProps) {
  const { t, i18n } = useTranslation();

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xl font-heading font-bold uppercase tracking-wide text-gray-900 transition-colors dark:text-white">
          {t("menu.newGame")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-navy-600 dark:hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-500 text-xs font-bold text-white">
          1
        </div>
        <div className="h-0.5 flex-1 bg-gray-200 dark:bg-navy-600" />
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-400 dark:bg-navy-600 dark:text-gray-500">
          2
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-navy-600 dark:bg-navy-900">
        <CountryFlag
          code={coach.nationality}
          locale={i18n.language}
          className="text-lg leading-none"
        />
        <div className="min-w-0">
          <p className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t("coach.signedInAs")}
          </p>
          <p className="truncate font-heading font-bold uppercase tracking-wide text-gray-900 dark:text-white">
            {coach.first_name} {coach.last_name}
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1" id="create-manager-field-startYear">
          <label
            htmlFor="create-manager-start-year"
            className="mb-1.5 block text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            {t("createManager.startYear")}
          </label>
          <input
            id="create-manager-start-year"
            aria-label={t("createManager.startYear")}
            type="text"
            pattern="[0-9]*"
            inputMode="numeric"
            className={`w-full rounded-lg border bg-gray-50 p-3 text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:ring-2 dark:bg-navy-900 dark:text-white dark:placeholder:text-gray-500 ${
              formErrors.startYear
                ? "border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500"
                : "border-gray-300 focus:border-primary-500 focus:ring-primary-500/20 dark:border-navy-600"
            }`}
            value={formData.startYear}
            onChange={(event) => {
              onChange("startYear", event.target.value);
              onClearError("startYear");
            }}
          />
          {formErrors.startYear ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />
              {formErrors.startYear}
            </p>
          ) : null}
        </div>

        <div className="flex-1" id="create-manager-field-startPhase">
          <label className="mb-1.5 block text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t("createManager.startPhase")}
          </label>
          <Select
            id="create-manager-start-phase"
            aria-label={t("createManager.startPhase")}
            fullWidth
            value={formData.startPhase}
            className={
              formErrors.startPhase
                ? "border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500"
                : ""
            }
            onChange={(event) => {
              onChange("startPhase", event.target.value as CareerStartPhase);
              onClearError("startPhase");
            }}
          >
            <option value="seasonStart">{t("createManager.phaseSeasonStart")}</option>
            <option value="midSeason">{t("createManager.phaseMidSeason")}</option>
          </Select>
          {formErrors.startPhase ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />
              {formErrors.startPhase}
            </p>
          ) : null}
        </div>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="mt-2 w-full"
        iconRight={<ChevronRight />}
      >
        {t("createManager.chooseWorld")}
      </Button>
    </form>
  );
}
