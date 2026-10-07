//! Staff on a club's books: what an expert asks to be paid, the contract they
//! sign, what releasing them early costs, and what happens when the term ends.
//!
//! Staff join on a free transfer — hiring one never costs a fee — but from then
//! on they are paid every week like a player (`finances::process_weekly_finances`
//! already sums `Staff.wage`), and sending one away before the term is up means
//! paying out what is left of it.

mod expiry;
mod lifecycle;
mod wage;

#[cfg(test)]
mod test_fixtures;

pub use expiry::{open_staff_contracts, price_unattached_staff, process_staff_contracts};
pub use lifecycle::{
    StaffContractPreview, hire_staff, preview_staff_contract, release_staff, renew_staff_contract,
};
pub use wage::staff_asking_wage;

use chrono::{Months, NaiveDate};

/// The term a staff contract runs for unless the manager picks another.
pub const DEFAULT_STAFF_CONTRACT_YEARS: u8 = 2;
const MIN_STAFF_CONTRACT_YEARS: u8 = 1;
const MAX_STAFF_CONTRACT_YEARS: u8 = 3;

const ERR_CONTRACT_YEARS_INVALID: &str = "be.error.staffContractYearsInvalid";

/// The day a contract of `years` signed on `today` runs out, as stored.
fn contract_end_after(today: NaiveDate, years: u8) -> Result<String, String> {
    if !(MIN_STAFF_CONTRACT_YEARS..=MAX_STAFF_CONTRACT_YEARS).contains(&years) {
        return Err(ERR_CONTRACT_YEARS_INVALID.to_string());
    }
    today
        .checked_add_months(Months::new(12 * u32::from(years)))
        .map(|end| end.format("%Y-%m-%d").to_string())
        .ok_or_else(|| ERR_CONTRACT_YEARS_INVALID.to_string())
}

fn full_name(staff: &domain::staff::Staff) -> String {
    format!("{} {}", staff.first_name, staff.last_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given a contract signed on 1 August 2026,
    /// When it runs for the default two years,
    /// Then it ends on 1 August 2028.
    #[test]
    fn a_default_contract_runs_two_years_to_the_day() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 1).expect("date");

        assert_eq!(
            contract_end_after(today, DEFAULT_STAFF_CONTRACT_YEARS).as_deref(),
            Ok("2028-08-01")
        );
    }

    /// Given a manager asking for a four-year or a zero-year staff contract,
    /// When the term is worked out,
    /// Then it is refused: staff sign for one to three years.
    #[test]
    fn a_term_outside_one_to_three_years_is_refused() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 1).expect("date");

        for years in [0, 4] {
            assert_eq!(
                contract_end_after(today, years),
                Err(ERR_CONTRACT_YEARS_INVALID.to_string())
            );
        }
    }
}
