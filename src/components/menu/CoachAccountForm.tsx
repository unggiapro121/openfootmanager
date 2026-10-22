import { type ReactNode, Suspense, lazy, useId } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, X } from "lucide-react";
import { Button, DatePicker, Select } from "../ui";
import { COACH_REGIONS, type CoachRegion } from "../../services/coachService";
import { FieldError, LABEL_CLASS, inputClass } from "./coachFormFields";
import type {
  CoachAccountErrors,
  CoachAccountField,
  CoachAccountFormData,
} from "./coachAccountForm.helpers";

const CreateManagerNationalityField = lazy(() => import("./CreateManagerNationalityField"));

interface CoachAccountFormProps {
  formData: CoachAccountFormData;
  formErrors: CoachAccountErrors;
  isSubmitting: boolean;
  onChange: (field: CoachAccountField, value: string) => void;
  onClose: (() => void) | null;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  /** Heading; the local account form's by default. */
  title?: string;
  /** Fields above the identity, such as the server account's email and password. */
  leadingFields?: ReactNode;
  /** Shown above the submit button, such as the server's answer. */
  feedback?: ReactNode;
}

function NameField({
  field,
  label,
  placeholder,
  value,
  error,
  onChange,
}: {
  field: "firstName" | "lastName";
  label: string;
  placeholder: string;
  value: string;
  error?: string;
  onChange: (field: CoachAccountField, value: string) => void;
}) {
  const inputId = useId();
  return (
    <div className="flex-1" id={`coach-account-field-${field}`}>
      <label htmlFor={inputId} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={inputId}
        maxLength={30}
        className={inputClass(Boolean(error))}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
      />
      <FieldError message={error} />
    </div>
  );
}

/** Who the coach is and the region his day is counted in: the form that makes an account. */
export default function CoachAccountForm({
  formData,
  formErrors,
  isSubmitting,
  onChange,
  onClose,
  onSubmit,
  title,
  leadingFields,
  feedback,
}: CoachAccountFormProps) {
  const { t, i18n } = useTranslation();
  const dobLabelId = useId();
  const regionId = useId();
  const regionHintId = useId();

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xl font-heading font-bold uppercase tracking-wide text-gray-900 transition-colors dark:text-white">
          {title ?? t("coach.newAccountTitle")}
        </h2>
        {onClose ? (
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:hover:bg-navy-600 dark:hover:text-white dark:focus:ring-offset-navy-800"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {leadingFields}

      <div className="flex gap-3">
        <NameField
          field="firstName"
          label={t("createManager.firstName")}
          placeholder={t("createManager.placeholderFirst")}
          value={formData.firstName}
          error={formErrors.firstName}
          onChange={onChange}
        />
        <NameField
          field="lastName"
          label={t("createManager.lastName")}
          placeholder={t("createManager.placeholderLast")}
          value={formData.lastName}
          error={formErrors.lastName}
          onChange={onChange}
        />
      </div>

      <div id="coach-account-field-dob">
        <label id={dobLabelId} className={LABEL_CLASS}>
          {t("createManager.dob")}
        </label>
        <DatePicker
          labelledBy={dobLabelId}
          value={formData.dob}
          onChange={(value) => onChange("dob", value)}
          error={Boolean(formErrors.dob)}
        />
        <FieldError message={formErrors.dob} />
      </div>

      <Suspense fallback={null}>
        <CreateManagerNationalityField
          nationality={formData.nationality}
          error={formErrors.nationality}
          locale={i18n.language}
          onChange={(value) => onChange("nationality", value)}
          onClearError={() => undefined}
        />
      </Suspense>

      <div>
        <label htmlFor={regionId} className={LABEL_CLASS}>
          {t("coach.region")}
        </label>
        <Select
          id={regionId}
          fullWidth
          aria-describedby={regionHintId}
          value={formData.region}
          onChange={(event) => onChange("region", event.target.value as CoachRegion)}
        >
          {COACH_REGIONS.map((region) => (
            <option key={region} value={region}>
              {t(`coach.regions.${region}`)}
            </option>
          ))}
        </Select>
        <p id={regionHintId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("coach.regionHint")}
        </p>
      </div>

      {feedback}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="mt-2 w-full"
        disabled={isSubmitting}
        iconRight={<ChevronRight />}
      >
        {t("coach.createAccount")}
      </Button>
    </form>
  );
}
