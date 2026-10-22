//! A player's age, once (phase 3, E3-5b, decision E7). Whole years from a "YYYY-MM-DD" date of
//! birth to a "YYYY-MM-DD" day, the birthday counted on its own day by month and day — so one
//! born on 29 February turns a year older on 1 March in a common year. No calendar library: the
//! online server and the game must agree on every player's age, and five copies used to disagree
//! (two compared the day of the year, off by one across leap years; one subtracted years only).

/// `(year, month, day)` of a "YYYY-MM-DD" date, or `None` when it is not one.
fn ymd(date: &str) -> Option<(i32, u32, u32)> {
    let mut parts = date.trim().splitn(3, '-');
    let year = parts.next()?.parse().ok()?;
    let month = parts.next()?.parse().ok()?;
    let day = parts.next()?.get(..2)?.parse().ok()?;
    ((1..=12).contains(&month) && (1..=31).contains(&day)).then_some((year, month, day))
}

/// Whole years from `date_of_birth` to the day `(year, month, day)`.
pub fn age_on_day(date_of_birth: &str, year: i32, month: u32, day: u32) -> Option<i32> {
    let (birth_year, birth_month, birth_day) = ymd(date_of_birth)?;
    let had_birthday = (month, day) >= (birth_month, birth_day);
    Some(year - birth_year - i32::from(!had_birthday))
}

/// Whole years from `date_of_birth` to `on`, both "YYYY-MM-DD".
pub fn age_on(date_of_birth: &str, on: &str) -> Option<i32> {
    let (year, month, day) = ymd(on)?;
    age_on_day(date_of_birth, year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given a birthday,
    /// when the age is asked the day before, on the day, and the day after,
    /// then he turns a year older on the day itself.
    #[test]
    fn the_birthday_counts_on_its_day() {
        assert_eq!(age_on("2000-07-15", "2025-07-14"), Some(24));
        assert_eq!(age_on("2000-07-15", "2025-07-15"), Some(25));
        assert_eq!(age_on("2000-07-15", "2025-07-16"), Some(25));
    }

    /// Given a player born on 31 December 2003,
    /// when his age is asked on 30 December 2024, a leap year,
    /// then he is 20: comparing the day of the year (365 both) said 21.
    #[test]
    fn a_leap_year_does_not_move_a_birthday_forward() {
        assert_eq!(age_on("2003-12-31", "2024-12-30"), Some(20));
        assert_eq!(age_on("2003-12-31", "2024-12-31"), Some(21));
    }

    /// Given a player born on 29 February,
    /// when his age is asked in a common year on 28 February and on 1 March,
    /// then he turns a year older on 1 March.
    #[test]
    fn a_leap_day_birthday_comes_on_the_first_of_march_in_a_common_year() {
        assert_eq!(age_on("2004-02-29", "2025-02-28"), Some(20));
        assert_eq!(age_on("2004-02-29", "2025-03-01"), Some(21));
        assert_eq!(age_on("2004-02-29", "2028-02-29"), Some(24));
    }

    /// Given dates that are not "YYYY-MM-DD", and a timestamp after a date,
    /// when an age is asked,
    /// then the malformed ones give none and the timestamp reads as its date.
    #[test]
    fn only_real_dates_give_an_age() {
        assert_eq!(age_on("", "2025-01-01"), None);
        assert_eq!(age_on("2000-13-01", "2025-01-01"), None);
        assert_eq!(age_on("2000-01-01", "soon"), None);
        assert_eq!(age_on("2000-01-01", "2025-06-01T12:00:00"), Some(25));
    }
}
