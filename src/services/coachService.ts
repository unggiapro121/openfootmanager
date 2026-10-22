import { invoke } from "./transport";

/** Where a coach plays: the region whose day the XP allowance is counted in. */
export type CoachRegion = "AsiaSoutheast" | "AsiaEast" | "Europe" | "Americas";

export const COACH_REGIONS: readonly CoachRegion[] = [
  "AsiaSoutheast",
  "AsiaEast",
  "Europe",
  "Americas",
];

/** Who a coach is, as the player enters it. */
export interface CoachIdentity {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  nationality: string;
  region: CoachRegion;
}

/** The player's coach, the same in every career on this machine. */
export interface CoachAccount extends CoachIdentity {
  id: string;
  created_at: string;
  last_login_at: string | null;
}

export interface CoachTotals {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  trophies: number;
}

/** What the account has built up across its careers, and today's XP allowance. */
export interface CoachProgressView {
  /** The mastery itself reaches the screens through the career's manager. */
  progress: {
    totals: CoachTotals;
  };
  counted_today: number;
  daily_limit: number;
  /** When the region's day turns next, in Unix seconds. */
  next_reset_unix: number;
  region: CoachRegion;
  /** No connection to the account store: nothing counts until it is back. */
  is_offline: boolean;
}

/** Every account on this machine, the latest login first. */
export async function listCoachAccounts(): Promise<CoachAccount[]> {
  return invoke<CoachAccount[]>("list_coach_accounts");
}

export async function createCoachAccount(identity: CoachIdentity): Promise<CoachAccount> {
  return invoke<CoachAccount>("create_coach_account", { identity });
}

export async function updateCoachAccount(
  id: string,
  identity: CoachIdentity,
): Promise<CoachAccount> {
  return invoke<CoachAccount>("update_coach_account", { id, identity });
}

/** Delete an account and its progress. Its careers stay, for another account to claim. */
export async function deleteCoachAccount(id: string): Promise<boolean> {
  return invoke<boolean>("delete_coach_account", { id });
}

export async function loginCoachAccount(id: string): Promise<CoachAccount> {
  return invoke<CoachAccount>("login_coach_account", { id });
}

export async function logoutCoachAccount(): Promise<void> {
  return invoke<void>("logout_coach_account");
}

/** The account logged in, or null before the login screen is passed. */
export async function getActiveCoachAccount(): Promise<CoachAccount | null> {
  return invoke<CoachAccount | null>("get_active_coach_account");
}

/** The logged-in account's progress. Rejects when nobody is logged in. */
export async function getCoachProgress(): Promise<CoachProgressView> {
  return invoke<CoachProgressView>("get_coach_progress");
}

/** Make a career from before accounts the logged-in account's, so it can be loaded. */
export async function claimSaveForCoach(saveId: string): Promise<void> {
  return invoke<void>("claim_save_for_coach", { saveId });
}

/** Where the accounts live: on this machine, or on the account server. */
export type CoachAccountMode = "local" | "server";

/** What the server's registration form sends. */
export interface CoachRegistration {
  email: string;
  password: string;
  identity: CoachIdentity;
}

export async function getCoachAccountMode(): Promise<CoachAccountMode> {
  return invoke<CoachAccountMode>("get_coach_account_mode");
}

/** Make the account on the server; a code to verify the email is sent there. */
export async function registerCoachAccount(registration: CoachRegistration): Promise<void> {
  return invoke<void>("register_coach_account", { registration });
}

export async function verifyCoachEmail(code: string): Promise<void> {
  return invoke<void>("verify_coach_email", { code });
}

export async function resendCoachVerification(email: string): Promise<void> {
  return invoke<void>("resend_coach_verification", { email });
}

export async function loginCoachWithEmail(email: string, password: string): Promise<CoachAccount> {
  return invoke<CoachAccount>("login_coach_with_email", { email, password });
}

/** The account of the session kept from the last run, or null when the player has to log in. */
export async function resumeCoachSession(): Promise<CoachAccount | null> {
  return invoke<CoachAccount | null>("resume_coach_session");
}

export async function requestCoachPasswordReset(email: string): Promise<void> {
  return invoke<void>("request_coach_password_reset", { email });
}

export async function resetCoachPassword(code: string, newPassword: string): Promise<void> {
  return invoke<void>("reset_coach_password", { code, newPassword });
}
