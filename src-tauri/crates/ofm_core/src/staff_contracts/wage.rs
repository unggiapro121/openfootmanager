//! What a staff member asks to be paid.

use domain::staff::{Staff, StaffRole};

/// Asking wages are quoted to the nearest hundred, as a contract would be.
const WAGE_ROUNDING: u32 = 100;

/// The weekly wage the best expert in a role (rated 100) asks for.
///
/// Set from what top-flight clubs pay, roughly: an assistant manager £1–3m a
/// year, a first-team coach £0.4–1.3m, a head physio £0.1–0.4m and a chief
/// scout £0.1–0.3m. The assistant earns the most because they cover the manager.
fn role_ceiling(role: &StaffRole) -> f64 {
    match role {
        StaffRole::AssistantManager => 60_000.0,
        StaffRole::Coach => 25_000.0,
        StaffRole::Physio => 8_000.0,
        StaffRole::Scout => 6_000.0,
    }
}

/// How good the staff member is at the work their role does, 0–100.
///
/// Mirrors what the game consumes: training reads a coach's `coaching`,
/// recovery a physio's `physiotherapy`, scouting both judging attributes, and
/// the assistant's weighting is the one delegated renewals use.
fn role_rating(staff: &Staff) -> f64 {
    let attributes = &staff.attributes;
    let rating = match staff.role {
        StaffRole::Coach => f64::from(attributes.coaching),
        StaffRole::Physio => f64::from(attributes.physiotherapy),
        StaffRole::Scout => {
            (f64::from(attributes.judging_ability) + f64::from(attributes.judging_potential)) / 2.0
        }
        StaffRole::AssistantManager => {
            (f64::from(attributes.coaching) * 4.0
                + f64::from(attributes.judging_ability) * 3.0
                + f64::from(attributes.judging_potential) * 3.0)
                / 10.0
        }
    };
    rating.clamp(0.0, 100.0)
}

/// The weekly wage `staff` asks of any club that hires or keeps them.
///
/// Ability alone sets it, not the club: an expert costs a small club what they
/// cost a big one, and a club that cannot afford one has to make do. The cube
/// makes the top of the market expensive — a coach rated 90 costs well over
/// twice one rated 70 — so stacking experts is limited by money, not a quota.
pub fn staff_asking_wage(staff: &Staff) -> u32 {
    let floor = crate::contracts::MINIMUM_DEFAULT_WAGE as u32;
    let share_of_ceiling = (role_rating(staff) / 100.0).powi(3);
    let weekly = (role_ceiling(&staff.role) * share_of_ceiling) as u32;
    let rounded = (weekly + WAGE_ROUNDING / 2) / WAGE_ROUNDING * WAGE_ROUNDING;
    rounded.max(floor)
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::staff::StaffAttributes;

    fn staff_with(role: StaffRole, rating: u8) -> Staff {
        Staff::new(
            "staff-1".to_string(),
            "Alex".to_string(),
            "Expert".to_string(),
            "1980-01-01".to_string(),
            role,
            StaffAttributes {
                coaching: rating,
                judging_ability: rating,
                judging_potential: rating,
                physiotherapy: rating,
            },
        )
    }

    /// Given two coaches rated 90 and 70,
    /// When their asking wages are worked out,
    /// Then the better one asks for more than twice as much.
    #[test]
    fn a_better_expert_asks_for_a_much_higher_wage() {
        let elite = staff_asking_wage(&staff_with(StaffRole::Coach, 90));
        let good = staff_asking_wage(&staff_with(StaffRole::Coach, 70));

        assert!(elite > good * 2, "elite {elite}, good {good}");
    }

    /// Given an assistant, a coach, a physio and a scout of the same top rating,
    /// When their asking wages are worked out,
    /// Then each sits inside the agreed range for that role at the top of the game.
    #[test]
    fn top_experts_ask_for_their_roles_real_world_wage() {
        let cases = [
            (StaffRole::AssistantManager, 20_000..=60_000),
            (StaffRole::Coach, 8_000..=25_000),
            (StaffRole::Physio, 2_000..=8_000),
            (StaffRole::Scout, 2_000..=6_000),
        ];
        for (role, range) in cases {
            let wage = staff_asking_wage(&staff_with(role.clone(), 90));
            assert!(range.contains(&wage), "{role:?} asks {wage}");
        }
    }

    /// Given a coach with almost no ability,
    /// When their asking wage is worked out,
    /// Then it is the game's minimum wage, never zero.
    #[test]
    fn even_a_poor_expert_asks_for_the_minimum_wage() {
        let wage = staff_asking_wage(&staff_with(StaffRole::Coach, 5));

        assert_eq!(wage, crate::contracts::MINIMUM_DEFAULT_WAGE as u32);
    }

    /// Given a coach rated 77,
    /// When their asking wage is worked out,
    /// Then it is quoted to the nearest hundred.
    #[test]
    fn asking_wages_are_quoted_to_the_nearest_hundred() {
        let wage = staff_asking_wage(&staff_with(StaffRole::Coach, 77));

        assert_eq!(wage % WAGE_ROUNDING, 0, "{wage}");
    }

    /// Given a scout who judges ability well but potential badly,
    /// When their asking wage is worked out,
    /// Then coaching and physiotherapy, which a scout never uses, do not raise it.
    #[test]
    fn only_the_attributes_a_role_uses_set_its_wage() {
        let mut scout = staff_with(StaffRole::Scout, 60);
        let baseline = staff_asking_wage(&scout);
        scout.attributes.coaching = 99;
        scout.attributes.physiotherapy = 99;

        assert_eq!(staff_asking_wage(&scout), baseline);
    }
}
