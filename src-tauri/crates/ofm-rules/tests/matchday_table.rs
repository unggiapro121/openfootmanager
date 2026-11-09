//! The matchday rules over a whole season and with the published numbers (E5-14 §9 T-1, M-15).
//!
//! T-1 pins the season table of the tech-spec's Phụ lục A.2 to the euro, computed by its python
//! model (Phụ lục B) from `proposed()`. M-15 reads the `matchday` block of analysis bản 4 §3.5.1,
//! the one the reset and public rulesets carry (D-P5-24), and checks the sample matches of AC-13:
//! they only come out right if every factor is read from the block, not from `proposed()`.

use ofm_rules::facility_works::{FacilitiesRules, FacilityKind, capacity, upkeep_of};
use ofm_rules::matchday::{
    CommerceLevels, CrowdAdvantage, Form, MatchdayInput, MatchdayRules, TicketPrice,
    bot_stands_level, commerce_parts, crowd_effect, matchday, projections, pull_permille,
};

/// Home league matches a season in a league of 14.
const HOME_MATCHES: u32 = 13;

/// The reference fixture list: 9 ordinary home matches, 3 against a top-4 side, 1 against a
/// human club, as (opponent rank, opponent human, matches).
const SCHEDULE: [(Option<u32>, bool, u64); 3] =
    [(None, false, 9), (Some(1), false, 3), (None, true, 1)];

fn home_match(league_level: u32, capacity: u32) -> MatchdayInput {
    MatchdayInput {
        league_level,
        capacity,
        price: TicketPrice::Medium,
        form: Form {
            points: 7,
            matches: 5,
        },
        opponent_rank: None,
        opponent_human: false,
        commerce: CommerceLevels::default(),
    }
}

/// A season's ticket income at `capacity` seats over the reference fixture list.
fn season_tickets(rules: &MatchdayRules, league_level: u32, capacity: u32) -> u64 {
    SCHEDULE
        .iter()
        .map(|&(opponent_rank, opponent_human, matches)| {
            let input = MatchdayInput {
                opponent_rank,
                opponent_human,
                ..home_match(league_level, capacity)
            };
            matchday(rules, &input).ticket_revenue * matches
        })
        .sum()
}

/// Given the proposed blocks and the reference season,
/// when each league level 1–15 plays its 13 home matches at 10.000 seats and at a bot's stands,
/// then tickets, stands, upkeep and the net gain are Phụ lục A.2 to the euro.
#[test]
fn the_season_table_is_the_python_model() {
    let facilities = FacilitiesRules::proposed();
    let rules = MatchdayRules::proposed();
    // (level, tickets at 10.000, bot stands, seats, tickets at the bot's stands, upkeep, net)
    let expected: [(u32, u64, u8, u32, u64, u64, u64); 15] = [
        (1, 2_866_835, 1, 10_000, 2_866_835, 0, 0),
        (2, 3_013_835, 1, 10_000, 3_013_835, 0, 0),
        (3, 3_080_350, 2, 12_000, 3_400_482, 52_000, 268_132),
        (4, 3_126_500, 2, 12_000, 3_661_539, 52_000, 483_039),
        (5, 3_173_300, 3, 14_000, 4_116_664, 104_000, 839_364),
        (6, 3_220_880, 3, 14_000, 4_433_857, 104_000, 1_108_977),
        (7, 3_269_110, 4, 16_500, 5_065_408, 169_000, 1_627_298),
        (8, 3_318_120, 5, 19_500, 5_777_678, 247_000, 2_212_558),
        (9, 3_367_780, 5, 19_500, 6_521_703, 247_000, 2_906_923),
        (10, 3_418_220, 6, 23_000, 7_807_474, 338_000, 4_051_254),
        (11, 3_469_440, 7, 27_000, 9_302_634, 442_000, 5_391_194),
        (12, 3_521_440, 9, 36_000, 11_530_377, 676_000, 7_332_937),
        (13, 3_574_220, 10, 42_000, 14_044_284, 832_000, 9_638_064),
        (14, 3_627_780, 11, 50_000, 17_018_751, 1_040_000, 12_350_971),
        (15, 3_682_120, 12, 58_000, 20_451_337, 1_248_000, 15_521_217),
    ];
    for (level, small, stands, seats, built, upkeep, net) in expected {
        let bot = bot_stands_level(&facilities, &rules, level);
        let bot_seats = capacity(&facilities, bot);
        let at_ten_thousand = season_tickets(&rules, level, 10_000);
        let at_bot = season_tickets(&rules, level, bot_seats);
        let kept = upkeep_of(&facilities, FacilityKind::Stands, bot, 0, HOME_MATCHES);
        let gained = at_bot - at_ten_thousand - kept;
        assert_eq!(
            (at_ten_thousand, bot, bot_seats, at_bot, kept, gained),
            (small, stands, seats, built, upkeep, net),
            "league level {level}"
        );
    }
}

/// Given every club at its bot's stands and the proposed crowd advantage,
/// when the reference season is played at each league level 1–15,
/// then the mean home advantage is the analysis' 1,0904 (python 1.090.416,77 millionths; the
/// mean here is rounded down).
#[test]
fn the_mean_home_advantage_at_full_stands_is_the_analysis_one() {
    let facilities = FacilitiesRules::proposed();
    let mut rules = MatchdayRules::proposed();
    rules.crowd_advantage = Some(CrowdAdvantage::PROPOSED);
    let mut total = 0u64;
    let mut matches = 0u64;
    for level in 1..=15 {
        let seats = capacity(&facilities, bot_stands_level(&facilities, &rules, level));
        for &(opponent_rank, opponent_human, count) in &SCHEDULE {
            let input = MatchdayInput {
                opponent_rank,
                opponent_human,
                ..home_match(level, seats)
            };
            let attendance = matchday(&rules, &input).attendance;
            let micros = crowd_effect(&rules, level, attendance)
                .home_advantage_micros
                .expect("on");
            total += u64::from(micros) * count;
            matches += count;
        }
    }
    let mean = total / matches;
    assert!((1_089_000..=1_092_000).contains(&mean), "mean {mean}");
    assert_eq!(mean, 1_090_416);
}

fn version_four() -> MatchdayRules {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/matchday_v4.json");
    let text = std::fs::read_to_string(path).expect("the fixture is committed");
    let ruleset: serde_json::Value = serde_json::from_str(&text).expect("the fixture is JSON");
    serde_json::from_value(ruleset["matchday"].clone()).expect("the block reads")
}

/// Given the `matchday` block of analysis bản 4 §3.5.1,
/// when it is validated,
/// then it is valid, without a crowd advantage.
#[test]
fn the_published_block_is_valid() {
    let rules = version_four();
    assert_eq!(rules.validate(), Ok(()));
    assert_eq!(rules.crowd_advantage, None);
}

/// Given the bản 4 block (AC-13),
/// when its sample matches are played,
/// then each comes out to the euro: a human opponent is an ordinary match, the car park adds no
/// fans and commerce reads 12 / 7 / 5.
#[test]
fn the_published_block_plays_its_sample_matches() {
    let rules = version_four();
    let opening = MatchdayInput {
        form: Form::default(),
        opponent_human: true,
        ..home_match(1, 10_000)
    };
    let first = matchday(&rules, &opening);
    assert_eq!(
        (
            first.attendance,
            first.sold_out,
            first.locked_out,
            first.ticket_revenue
        ),
        (9_500, false, 0, 218_500)
    );

    let shop = CommerceLevels {
        shop: 1,
        food: 0,
        park: 0,
    };
    let with_shop = MatchdayInput {
        commerce: shop,
        ..home_match(1, 10_000)
    };
    assert_eq!(matchday(&rules, &with_shop).commerce_revenue, 2_595);

    let all = CommerceLevels {
        shop: 5,
        food: 5,
        park: 5,
    };
    let built = matchday(
        &rules,
        &MatchdayInput {
            commerce: all,
            ..home_match(5, 14_000)
        },
    );
    assert_eq!(
        (
            built.attendance,
            built.ticket_revenue,
            built.commerce_revenue
        ),
        (12_573, 306_906, 36_828)
    );
    assert_eq!(
        commerce_parts(&rules, 5, 12_573, all),
        [18_414, 10_741, 7_672]
    );

    let park = CommerceLevels {
        shop: 0,
        food: 0,
        park: 5,
    };
    let parked = matchday(
        &rules,
        &MatchdayInput {
            commerce: park,
            ..home_match(5, 14_000)
        },
    );
    assert_eq!(
        (parked.attendance, parked.commerce_revenue),
        (12_573, 7_672)
    );

    assert_eq!(pull_permille(&rules, Some(1), true), 1100);
    assert_eq!(pull_permille(&rules, None, true), 1000);

    let rows = projections(
        &rules,
        &MatchdayInput {
            commerce: all,
            ..home_match(10, 23_000)
        },
    );
    let tickets: Vec<u64> = rows
        .iter()
        .map(|(_, outcome)| outcome.ticket_revenue)
        .collect();
    let commerce: Vec<u64> = rows
        .iter()
        .map(|(_, outcome)| outcome.commerce_revenue)
        .collect();
    assert_eq!(tickets, vec![514_047, 598_714, 617_866, 603_489]);
    assert_eq!(commerce, vec![72_571, 71_845, 61_786, 51_727]);
}
