import type { CoachIdentity, CoachRegion } from "../../services/coachService";
import type { CareerStartPhase } from "./CreateManagerForm";

/** The coach account form, as the player fills it in. */
export interface CoachAccountFormData {
  firstName: string;
  lastName: string;
  dob: string;
  nationality: string;
  region: CoachRegion;
}

export type CoachAccountField = keyof CoachAccountFormData;
export type CoachAccountErrors = Partial<Record<CoachAccountField, string>>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The youngest and oldest a coach may be, today or when a career starts. Mirrors `start_new_game`. */
const COACH_MINIMUM_AGE = 30;
const COACH_MAXIMUM_AGE = 99;
const NAME_MAX_LENGTH = 30;

export const EMPTY_COACH_ACCOUNT_FORM: CoachAccountFormData = {
  firstName: "",
  lastName: "",
  dob: "",
  nationality: "",
  region: "AsiaSoutheast",
};

/** Year, month and day of a `YYYY-MM-DD` date that exists, or null. */
function parseIsoDate(isoDate: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Whole years from `isoDob` to `reference`, or null for a date that does not exist. */
function ageOn(isoDob: string, reference: Date): number | null {
  const birth = parseIsoDate(isoDob);
  if (!birth) return null;
  const hadBirthday =
    reference.getUTCMonth() > birth.month - 1 ||
    (reference.getUTCMonth() === birth.month - 1 && reference.getUTCDate() >= birth.day);
  return reference.getUTCFullYear() - birth.year - (hadBirthday ? 0 : 1);
}

/** The first day of a career started in `startYear` at `startPhase`, as the backend dates it. */
function careerStartDate(startYear: number, startPhase: CareerStartPhase): Date {
  const date = new Date(Date.UTC(startYear, 6, 1));
  if (startPhase === "midSeason") {
    date.setUTCDate(date.getUTCDate() + 120);
  }
  return date;
}

function nameError(value: string, label: string, t: Translate): string | undefined {
  if (!value.trim()) return t("validation.required", { field: label });
  if (value.length > NAME_MAX_LENGTH) {
    return t("validation.maxLength", { field: label, max: NAME_MAX_LENGTH });
  }
  return undefined;
}

function dobError(dob: string, today: Date, t: Translate): string | undefined {
  if (!dob) return t("validation.required", { field: t("createManager.dob") });
  const age = ageOn(dob, today);
  if (age === null) return t("validation.invalidDate");
  if (age < COACH_MINIMUM_AGE) return t("validation.minAge", { min: COACH_MINIMUM_AGE });
  if (age > COACH_MAXIMUM_AGE) return t("validation.invalidDob");
  return undefined;
}

/** What is wrong with `form`, field by field; empty when it can be sent. */
export function validateCoachAccountForm(
  form: CoachAccountFormData,
  today: Date,
  t: Translate,
): CoachAccountErrors {
  const errors: CoachAccountErrors = {
    firstName: nameError(form.firstName, t("createManager.firstName"), t),
    lastName: nameError(form.lastName, t("createManager.lastName"), t),
    dob: dobError(form.dob, today, t),
    nationality: form.nationality
      ? undefined
      : t("validation.required", { field: t("createManager.countryOfOrigin") }),
  };
  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => message !== undefined),
  ) as CoachAccountErrors;
}

export function toCoachIdentity(form: CoachAccountFormData): CoachIdentity {
  return {
    first_name: form.firstName.trim(),
    last_name: form.lastName.trim(),
    date_of_birth: form.dob,
    nationality: form.nationality,
    region: form.region,
  };
}

/**
 * Why the logged-in coach, born on `isoDob`, cannot lead a career starting
 * then; null when he can. The birth date is the account's, so the fix is a
 * different start year.
 */
export function careerStartAgeMessage(
  isoDob: string,
  startYear: number,
  startPhase: CareerStartPhase,
  t: Translate,
): string | null {
  const age = ageOn(isoDob, careerStartDate(startYear, startPhase));
  if (age === null) return t("validation.invalidDob");
  if (age < COACH_MINIMUM_AGE) return t("coach.tooYoungForStart", { min: COACH_MINIMUM_AGE });
  if (age > COACH_MAXIMUM_AGE) return t("coach.tooOldForStart");
  return null;
}
