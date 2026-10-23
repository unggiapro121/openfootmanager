//! The calendar of a season (phase 3, E3-7): who plays whom in which round, and which football
//! day a day of an online season is. No calendar library: the online server and the game must
//! agree on every round and every age, as in [`crate::age`].

/// Rounds a round robin of `n` clubs takes over `legs` legs. The circle method gives an odd
/// field a phantom slot, so its rounds match the next even size.
pub fn round_robin_matchdays(n: usize, legs: usize) -> usize {
    if n < 2 {
        return 0;
    }
    let slots = if n.is_multiple_of(2) { n } else { n + 1 };
    (slots - 1) * legs
}

/// The pairings of a round robin of `n` clubs over `legs` legs, round by round, as
/// `(home, away)` indices into the clubs. The circle method: slot 0 stays, the others turn one
/// place a round; legs after the first reverse home and away. With an odd `n` a club paired with
/// the phantom slot has a bye, which leaves it out of that round.
pub fn round_robin_pairings(n: usize, legs: u8) -> Vec<Vec<(usize, usize)>> {
    if n < 2 || legs == 0 {
        return Vec::new();
    }
    let slots = if n.is_multiple_of(2) { n } else { n + 1 };
    let rounds = round_robin_matchdays(n, 1);
    let half = slots / 2;
    let mut all = Vec::with_capacity(rounds * usize::from(legs));
    for leg in 0..legs {
        let mut indices: Vec<usize> = (0..slots).collect();
        for _round in 0..rounds {
            let mut round = Vec::with_capacity(half);
            for i in 0..half {
                let (mut home, mut away) = (indices[i], indices[slots - 1 - i]);
                if leg % 2 == 1 {
                    std::mem::swap(&mut home, &mut away);
                }
                if home < n && away < n {
                    round.push((home, away));
                }
            }
            all.push(round);
            if let Some(last) = indices.pop() {
                indices.insert(1, last);
            }
        }
    }
    all
}

/// The key of day `day` of season `season` for the online world's random streams (S-7 S7-23).
/// Not the football date: with more than one season to a football year, two seasons share their
/// dates, and a key of the date alone would train them identically.
pub fn day_key(season: u32, day: u32) -> String {
    format!("s{season}/d{day}")
}

/// The weekday, 0 = Monday .. 6 = Sunday, of day `day` of a season whose day 0 falls on
/// `start_weekday`.
pub fn season_weekday(start_weekday: u32, day: u32) -> u32 {
    (start_weekday + day) % 7
}

/// The football day of day `day` of an online season of `days` days in football year `year`: the
/// season's days spread evenly over the football year from 1 July of `year` (Q5: one online
/// season is one football year), as `(calendar year, "YYYY-MM-DD")`. Ages in training and aging
/// are taken on it. A day past the end is the season's last.
pub fn season_football_date(year: u32, day: u32, days: u32) -> (u32, String) {
    let days = days.max(1);
    let day = day.min(days - 1);
    let start = days_from_civil(i64::from(year), 7, 1);
    let offset = i64::from(day) * 365 / i64::from(days);
    let (y, m, d) = civil_from_days(start + offset);
    let y = u32::try_from(y).unwrap_or(year);
    (y, format!("{y:04}-{m:02}-{d:02}"))
}

/// Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(month) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The date of a count of days since 1970-01-01 (H. Hinnant's `civil_from_days`).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    /// Given fourteen clubs and two legs,
    /// when the pairings are drawn,
    /// then there are 26 rounds of seven, every club plays once a round, each pair meets twice
    /// with home and away swapped, and every club is at home 13 times.
    #[test]
    fn a_double_round_robin_of_fourteen() {
        let rounds = round_robin_pairings(14, 2);
        assert_eq!(rounds.len(), 26);
        let mut meetings = BTreeSet::new();
        let mut home = [0; 14];
        for round in &rounds {
            assert_eq!(round.len(), 7);
            let mut playing: Vec<usize> = round.iter().flat_map(|(h, a)| [*h, *a]).collect();
            playing.sort_unstable();
            assert_eq!(playing, (0..14).collect::<Vec<_>>());
            for (h, a) in round {
                assert!(
                    meetings.insert((*h, *a)),
                    "{h} v {a} twice at the same ground"
                );
                home[*h] += 1;
            }
        }
        assert_eq!(meetings.len(), 14 * 13);
        assert!(home.iter().all(|games| *games == 13), "{home:?}");
    }

    /// Given an odd field,
    /// when the pairings are drawn,
    /// then each club has one bye a leg and no pairing names the phantom slot.
    #[test]
    fn an_odd_field_gives_each_club_a_bye_a_leg() {
        let rounds = round_robin_pairings(5, 2);
        assert_eq!(rounds.len(), round_robin_matchdays(5, 2));
        let mut byes = [0; 5];
        for round in &rounds {
            let playing: BTreeSet<usize> = round.iter().flat_map(|(h, a)| [*h, *a]).collect();
            assert!(playing.iter().all(|club| *club < 5));
            for (club, count) in byes.iter_mut().enumerate() {
                if !playing.contains(&club) {
                    *count += 1;
                }
            }
        }
        assert_eq!(byes, [2; 5]);
    }

    /// Given a 28-day season of football year 2026,
    /// when its days are turned into football dates,
    /// then day 0 is 1 July 2026, the days run in order over the year, and the last stays in June
    /// 2027.
    #[test]
    fn a_season_spreads_over_its_football_year() {
        assert_eq!(
            season_football_date(2026, 0, 28),
            (2026, "2026-07-01".into())
        );
        assert_eq!(
            season_football_date(2026, 14, 28),
            (2026, "2026-12-30".into())
        );
        assert_eq!(
            season_football_date(2026, 27, 28),
            (2027, "2027-06-17".into())
        );
        assert_eq!(
            season_football_date(2026, 99, 28),
            season_football_date(2026, 27, 28)
        );
        let dates: Vec<String> = (0..28)
            .map(|day| season_football_date(2026, day, 28).1)
            .collect();
        assert!(dates.windows(2).all(|pair| pair[0] < pair[1]), "{dates:?}");
    }

    /// Given dates across a leap day and centuries,
    /// when they go to a day count and back,
    /// then they come back unchanged.
    #[test]
    fn days_and_dates_round_trip() {
        for (y, m, d) in [
            (1970, 1, 1),
            (2000, 2, 29),
            (2024, 2, 29),
            (2100, 3, 1),
            (1900, 12, 31),
        ] {
            assert_eq!(civil_from_days(days_from_civil(y, m, d)), (y, m, d));
        }
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2026, 7, 1), 20_635);
    }

    /// Given a season starting on a Saturday,
    /// when its days are counted,
    /// then day 2 is a Monday and the keys of two seasons' same day differ.
    #[test]
    fn weekdays_and_day_keys() {
        assert_eq!(season_weekday(5, 2), 0);
        assert_eq!(season_weekday(5, 9), 0);
        assert_ne!(day_key(1, 3), day_key(2, 3));
    }
}
