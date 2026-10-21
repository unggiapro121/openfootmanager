import { describe, expect, it } from "vitest";

import {
  type CoachAccountFormData,
  careerStartAgeMessage,
  toCoachIdentity,
  validateCoachAccountForm,
} from "./coachAccountForm.helpers";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

const filled: CoachAccountFormData = {
  firstName: " Dung ",
  lastName: "Ung",
  dob: "1990-05-01",
  nationality: "VN",
  region: "AsiaSoutheast",
};
const today = new Date(Date.UTC(2026, 9, 22));

describe("validateCoachAccountForm", () => {
  // Given a complete form for a coach of 36, when it is checked, then nothing is wrong.
  it("accepts a complete form", () => {
    expect(validateCoachAccountForm(filled, today, t)).toEqual({});
  });

  // Given an empty form, when it is checked, then every identity field is required.
  it("requires every identity field", () => {
    const errors = validateCoachAccountForm(
      { firstName: "  ", lastName: "", dob: "", nationality: "", region: "Europe" },
      today,
      t,
    );

    expect(Object.keys(errors).sort()).toEqual(["dob", "firstName", "lastName", "nationality"]);
  });

  // Given a coach who is 29 today, when the form is checked, then the birth date is refused.
  it("refuses a coach under thirty", () => {
    const errors = validateCoachAccountForm({ ...filled, dob: "1997-01-01" }, today, t);

    expect(errors.dob).toBe('validation.minAge {"min":30}');
  });

  // Given a date that does not exist, when the form is checked, then it is an invalid date.
  it("refuses a date that does not exist", () => {
    const errors = validateCoachAccountForm({ ...filled, dob: "1990-02-30" }, today, t);

    expect(errors.dob).toBe("validation.invalidDate");
  });
});

describe("toCoachIdentity", () => {
  // Given a form with padded names, when it is sent, then the names are trimmed.
  it("trims the names", () => {
    expect(toCoachIdentity(filled)).toEqual({
      first_name: "Dung",
      last_name: "Ung",
      date_of_birth: "1990-05-01",
      nationality: "VN",
      region: "AsiaSoutheast",
    });
  });
});

describe("careerStartAgeMessage", () => {
  // Given a coach born in 1990, when a career starts in 2026, then he is old enough.
  it("accepts a coach of thirty or more at the start", () => {
    expect(careerStartAgeMessage("1990-05-01", 2026, "seasonStart", t)).toBeNull();
  });

  // Given a coach born in 1990, when a career would start in 2010, then a later year is asked for.
  it("asks for a later start when the coach would be too young", () => {
    expect(careerStartAgeMessage("1990-05-01", 2010, "seasonStart", t)).toBe(
      'coach.tooYoungForStart {"min":30}',
    );
  });

  // Given a coach born in 1900, when a career would start in 2026, then an earlier year is asked for.
  it("asks for an earlier start when the coach would be too old", () => {
    expect(careerStartAgeMessage("1900-05-01", 2026, "seasonStart", t)).toBe(
      "coach.tooOldForStart",
    );
  });
});
