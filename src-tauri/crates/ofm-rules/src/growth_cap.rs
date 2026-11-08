//! A season's brake on how fast young stars develop (E5-5, PG-Q2, PG-C): a ceiling under their
//! potential that rises with age, and a capped chance near it. Players of 25 and over, and those
//! whose potential is at most `base_ovr`, are never braked. Online only; never shown to a player
//! (PG-Q3): no view, no reason to sit out, no line in the player guides.

use serde::{Deserialize, Serialize};

/// The youngest age the table has a column for; a younger player reads it.
const FIRST_AGE: u32 = 16;
/// How many ages the table holds: 16, 17, …, 25.
const AGES: usize = 10;

/// A season's brake on young stars (E55-1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthCap {
    /// Potential at or under which no player is braked.
    pub base_ovr: u8,
    /// Percent of his potential above `base_ovr` a player of 16, 17, …, 25 may not yet reach;
    /// younger than 16 reads the first. Never rises with age; the last (25) is 0.
    pub room_percent_by_age: [u8; AGES],
    /// The widest slowdown window, in OVR points under the ceiling.
    pub slow_window: u8,
    /// Window points per point of brake (0 = no slowdown).
    pub slow_window_per_brake: u8,
    /// The lowest chance per attribute near the ceiling, in thousandths.
    pub slow_floor_permille: u16,
}

/// Why a [`GrowthCap`] cannot be run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrowthCapIssue {
    /// A percent above 100.
    PercentOver100,
    /// A percent higher than a younger age's: the ceiling would fall as a player ages.
    RisesWithAge,
    /// A brake left at 25, so grown players would develop differently from today.
    BrakeAt25,
    /// `base_ovr` above 99.
    BaseOver99,
    /// `slow_window` outside 1–99.
    WindowOutOfRange,
    /// `slow_window_per_brake` above 10.
    WindowPerBrakeOver10,
    /// `slow_floor_permille` outside 1–1.000.
    FloorOutOfRange,
}

impl GrowthCap {
    /// PO review R.5: for a potential of 93 the brake is the user's 12 at 18, 9 at 19, 0 at 25.
    pub const PROPOSED: Self = Self {
        base_ovr: 65,
        room_percent_by_age: [64, 54, 43, 32, 28, 21, 18, 11, 7, 0],
        slow_window: 40,
        slow_window_per_brake: 5,
        slow_floor_permille: 50,
    };

    /// Whether the season can run this table.
    pub fn validate(&self) -> Result<(), GrowthCapIssue> {
        let table = &self.room_percent_by_age;
        if table.iter().any(|&percent| percent > 100) {
            return Err(GrowthCapIssue::PercentOver100);
        }
        if table.windows(2).any(|pair| pair[1] > pair[0]) {
            return Err(GrowthCapIssue::RisesWithAge);
        }
        if table[AGES - 1] != 0 {
            return Err(GrowthCapIssue::BrakeAt25);
        }
        if self.base_ovr > 99 {
            return Err(GrowthCapIssue::BaseOver99);
        }
        if !(1..=99).contains(&self.slow_window) {
            return Err(GrowthCapIssue::WindowOutOfRange);
        }
        if self.slow_window_per_brake > 10 {
            return Err(GrowthCapIssue::WindowPerBrakeOver10);
        }
        if !(1..=1000).contains(&self.slow_floor_permille) {
            return Err(GrowthCapIssue::FloorOutOfRange);
        }
        Ok(())
    }

    /// The table's percent for a player of `age`: the first under 16, 0 from 26 on.
    fn room_percent(&self, age: u32) -> u32 {
        let index = age.saturating_sub(FIRST_AGE) as usize;
        self.room_percent_by_age
            .get(index)
            .map_or(0, |&percent| u32::from(percent))
    }

    /// Points under `potential` a player of `age` may not pass:
    /// (r(age) × max(potential − base_ovr, 0) + 50) / 100, integer division (half up).
    pub fn brake(&self, potential: u8, age: u32) -> u8 {
        let room = u32::from(potential.saturating_sub(self.base_ovr));
        let brake = (self.room_percent(age) * room + 50) / 100;
        // r ≤ 100 % of the room above base, so the brake never passes the potential.
        u8::try_from(brake).map_or(potential, |brake| brake.min(potential))
    }

    /// `potential − brake`: never above potential, never negative.
    pub fn ceiling(&self, potential: u8, age: u32) -> u8 {
        potential - self.brake(potential, age)
    }

    /// The highest chance per attribute at `ovr` for a player of `potential` and `age`: 1 when
    /// the brake is 0; 0 at or over the ceiling; otherwise (ceiling − ovr) / window, window =
    /// min(slow_window, slow_window_per_brake × brake), held between the floor and 1.
    pub fn pace(&self, ovr: u8, potential: u8, age: u32) -> f64 {
        let brake = self.brake(potential, age);
        if brake == 0 {
            return 1.0;
        }
        let ceiling = potential - brake;
        if ovr >= ceiling {
            return 0.0;
        }
        let window = u32::from(self.slow_window)
            .min(u32::from(self.slow_window_per_brake) * u32::from(brake));
        if window == 0 {
            return 1.0;
        }
        let floor = f64::from(self.slow_floor_permille) / 1000.0;
        (f64::from(ceiling - ovr) / f64::from(window)).clamp(floor, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAP: GrowthCap = GrowthCap::PROPOSED;

    /// Given the proposed table,
    /// when the ceiling is read for stars and ordinary players of several ages,
    /// then it is the PO's table (T1).
    #[test]
    fn the_ceiling_follows_the_proposed_table() {
        for (potential, age, ceiling) in [
            (93, 15, 75),
            (93, 16, 75),
            (93, 18, 81),
            (93, 19, 84),
            (93, 25, 93),
            (93, 40, 93),
            (99, 18, 84),
            (75, 18, 71),
            (65, 18, 65),
            (60, 18, 60),
            (10, 16, 10),
        ] {
            assert_eq!(
                CAP.ceiling(potential, age),
                ceiling,
                "P {potential} at {age}"
            );
        }
        for (age, brake) in [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
            .into_iter()
            .zip([18, 15, 12, 9, 8, 6, 5, 3, 2, 0])
        {
            assert_eq!(CAP.brake(93, age), brake, "P 93 at {age}");
        }
    }

    /// Given tables broken one way at a time,
    /// when they are validated,
    /// then each is refused for its own reason and the proposed one passes (T2).
    #[test]
    fn a_table_is_checked() {
        assert_eq!(CAP.validate(), Ok(()));
        let with = |change: fn(&mut GrowthCap)| {
            let mut cap = CAP;
            change(&mut cap);
            cap.validate()
        };
        assert_eq!(
            with(|c| c.room_percent_by_age[3] = 50),
            Err(GrowthCapIssue::RisesWithAge)
        );
        assert_eq!(
            with(|c| c.room_percent_by_age[0] = 101),
            Err(GrowthCapIssue::PercentOver100)
        );
        assert_eq!(
            with(|c| c.room_percent_by_age[9] = 1),
            Err(GrowthCapIssue::BrakeAt25)
        );
        assert_eq!(with(|c| c.base_ovr = 100), Err(GrowthCapIssue::BaseOver99));
        assert_eq!(
            with(|c| c.slow_window = 0),
            Err(GrowthCapIssue::WindowOutOfRange)
        );
        assert_eq!(
            with(|c| c.slow_floor_permille = 0),
            Err(GrowthCapIssue::FloorOutOfRange)
        );
        assert_eq!(
            with(|c| c.slow_floor_permille = 1001),
            Err(GrowthCapIssue::FloorOutOfRange)
        );
        assert_eq!(
            with(|c| c.slow_window_per_brake = 11),
            Err(GrowthCapIssue::WindowPerBrakeOver10)
        );
        assert_eq!(with(|c| c.slow_window_per_brake = 0), Ok(()));
    }

    /// Given an 18-year-old star and an ordinary 18-year-old,
    /// when the pace is read at several OVRs,
    /// then it falls from 1 to the floor towards the ceiling and is 0 on it (T3).
    #[test]
    fn the_pace_slows_towards_the_ceiling() {
        let close = |a: f64, b: f64| (a - b).abs() < 1e-9;
        for (ovr, pace) in [(81, 0.0), (85, 0.0), (80, 0.05), (61, 0.5), (30, 1.0)] {
            assert!(close(CAP.pace(ovr, 93, 18), pace), "P 93 OVR {ovr}");
        }
        for (ovr, pace) in [(61, 0.5), (70, 0.05)] {
            assert!(close(CAP.pace(ovr, 75, 18), pace), "P 75 OVR {ovr}");
        }
        assert!(close(CAP.pace(50, 60, 18), 1.0));
        assert!(close(CAP.pace(80, 93, 26), 1.0));
        let mut no_slowdown = CAP;
        no_slowdown.slow_window_per_brake = 0;
        assert!(close(no_slowdown.pace(80, 93, 18), 1.0));
        assert!(close(no_slowdown.pace(81, 93, 18), 0.0));
    }

    /// Given a table written as the ruleset writes it,
    /// when it is read,
    /// then every field lands where the ruleset meant.
    #[test]
    fn a_table_reads_as_the_ruleset_writes_it() {
        let json = serde_json::json!({
            "baseOvr": 65,
            "roomPercentByAge": [64, 54, 43, 32, 28, 21, 18, 11, 7, 0],
            "slowWindow": 40,
            "slowWindowPerBrake": 5,
            "slowFloorPermille": 50
        });
        let cap: GrowthCap = serde_json::from_value(json.clone()).expect("a growth cap");
        assert_eq!(cap, CAP);
        assert_eq!(serde_json::to_value(cap).expect("json"), json);
    }
}
