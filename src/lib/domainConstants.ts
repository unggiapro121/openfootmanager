export const CONTRACT_RISK_DAYS = {
  critical: 180,
  warning: 365,
} as const;

export const TRANSFER_WINDOW_DAYS = {
  preseasonOpenLead: 30,
  postSeasonStartClose: 30,
} as const;

/**
 * The winter window opens on the first of the month this many months after the
 * season's opening month and runs to that month's end. Mirrors
 * `WINTER_WINDOW_MONTHS_AFTER_START` in `ofm_core::season_context`.
 */
export const WINTER_WINDOW_MONTHS_AFTER_START = 5;
