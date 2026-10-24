//! The online world grows one club at a time (phase 3, E3-5q1): each club from its own key, every
//! starter squad within the same bands and frame, every name allowed and unrepeated in its club.

use std::collections::{BTreeMap, HashSet};

use ofm_rules::worldgen::online::names::{fold, is_protected_person};
use ofm_rules::worldgen::online::starter::SquadStrength;
use ofm_rules::worldgen::online::{GenError, GeneratedClub, Generator, OnlineContentPack};

const SEED: u64 = 2_026;
const YEAR: u32 = 2026;

fn pack() -> OnlineContentPack {
    OnlineContentPack::builtin()
}

fn club(generator: &Generator<'_>, region: &str, ordinal: u64) -> GeneratedClub {
    generator
        .club(region, ordinal, 0, YEAR, None)
        .unwrap_or_else(|error| panic!("{region} {ordinal}: {error:?}"))
}

fn as_json(club: &GeneratedClub) -> serde_json::Value {
    // Players through `Persisted`, so their potential and traits are compared too.
    serde_json::json!({
        "team": club.team,
        "players": serde_json::to_value(domain::persisted::Persisted(&club.players)).expect("json"),
        "staff": club.staff, "coach": club.coach,
        "bot": club.bot_account_id, "nation": club.nation, "slot": club.name_slot,
    })
}

/// Given one seed and pack,
/// when club 17 of a region is generated on its own and again after clubs 0–16,
/// then both are the same club, ids included: a club needs no other club to be made.
#[test]
fn a_club_made_alone_is_the_club_made_in_a_batch() {
    let pack = pack();
    let generator = Generator::new(SEED, &pack).expect("a generator");
    let batch: Vec<GeneratedClub> = (0..=17)
        .map(|ordinal| club(&generator, "AsiaSoutheast", ordinal))
        .collect();

    let alone = club(
        &Generator::new(SEED, &pack).expect("a generator"),
        "AsiaSoutheast",
        17,
    );

    assert!(
        as_json(&alone) == as_json(&batch[17]),
        "club 17 depends on the clubs before it"
    );
}

/// Given one key,
/// when a club is generated twice, and once from another seed,
/// then the two from one key are identical and the other is another club.
#[test]
fn the_same_key_makes_the_same_club() {
    let pack = pack();
    let first = club(&Generator::new(SEED, &pack).unwrap(), "Europe", 3);
    let second = club(&Generator::new(SEED, &pack).unwrap(), "Europe", 3);
    let other = club(&Generator::new(SEED + 1, &pack).unwrap(), "Europe", 3);

    assert!(as_json(&first) == as_json(&second));
    assert_eq!(first.key.ordinal, 3);
    assert_eq!(
        first.key.world_rules_version,
        ofm_rules::WORLD_RULES_VERSION
    );
    assert_ne!(first.team.id, other.team.id);
    assert_ne!(first.players[0].id, other.players[0].id);
}

/// The frame of a squad: how many players fall in each age band and each potential band.
fn frame(club: &GeneratedClub) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for player in &club.players {
        let age = YEAR as i32 - player.date_of_birth[..4].parse::<i32>().unwrap();
        let age_band = match age {
            ..=20 => "≤20",
            21..=24 => "21–24",
            25..=29 => "25–29",
            _ => "30+",
        };
        *counts.entry(format!("age {age_band}")).or_insert(0) += 1;
        *counts
            .entry(format!("{:?}", player.position.to_group_position()))
            .or_insert(0) += 1;
    }
    counts
}

/// Given 56 clubs in each of the four regions,
/// when their starter squads are measured,
/// then every club is within all three bands, every club has the same frame, and no two clubs
/// share a name.
#[test]
fn every_starter_squad_is_within_the_bands_on_the_same_frame() {
    let pack = pack();
    let starter = &pack.profile.starter;
    let generator = Generator::new(SEED, &pack).unwrap();
    let mut names = HashSet::new();
    let mut frames = HashSet::new();
    for region in ofm_rules::worldgen::online::REGIONS {
        for ordinal in 0..56 {
            let club = club(&generator, region, ordinal);
            let strength = SquadStrength::of(&club.players);
            assert!(
                strength.within(starter),
                "{region} {ordinal} {}: {strength:?}",
                club.team.name
            );
            assert_eq!(club.players.len(), starter.template.len());
            frames.insert(format!("{:?}", frame(&club)));
            assert!(
                names.insert(fold(&club.team.name)),
                "{} twice",
                club.team.name
            );
        }
    }
    assert_eq!(frames.len(), 1, "clubs differ in frame: {frames:?}");
}

/// Given a region's clubs,
/// when their people are looked at,
/// then nobody shares a full name or a shirt name with a club mate, nobody is a protected
/// person, and every nationality has a pool of its own.
#[test]
fn people_are_named_by_their_culture_without_clashes() {
    let pack = pack();
    let generator = Generator::new(SEED, &pack).unwrap();
    for ordinal in 0..28 {
        let club = club(&generator, "AsiaSoutheast", ordinal);
        let mut full = HashSet::new();
        let mut shirts = HashSet::new();
        for player in &club.players {
            assert!(
                pack.names.contains_key(&player.nationality),
                "{}",
                player.nationality
            );
            assert!(
                full.insert(fold(&player.full_name)),
                "{} twice in {}",
                player.full_name,
                club.team.name
            );
            assert!(
                shirts.insert(fold(&player.match_name)),
                "shirt {} twice",
                player.match_name
            );
            assert!(
                !is_protected_person(&player.full_name, &[]),
                "{}",
                player.full_name
            );
        }
        for member in &club.staff {
            assert!(!is_protected_person(
                &format!("{} {}", member.first_name, member.last_name),
                &[]
            ));
        }
    }
    let vietnamese = club(&generator, "AsiaSoutheast", 0);
    assert_eq!(vietnamese.nation, "VN");
    let local = vietnamese
        .players
        .iter()
        .find(|player| player.nationality == "VN")
        .expect("a Vietnamese player at a Vietnamese club");
    assert_eq!(
        local.full_name.split(' ').count(),
        3,
        "family, middle and given name: {}",
        local.full_name
    );
    assert!(
        local.full_name.ends_with(&local.match_name),
        "{} / {}",
        local.full_name,
        local.match_name
    );
}

/// Given a club,
/// when its squad is drawn again as generation 1,
/// then the players are new people and the club is the same club.
#[test]
fn a_new_generation_is_a_new_squad_for_the_same_club() {
    let pack = pack();
    let generator = Generator::new(SEED, &pack).unwrap();
    let first = club(&generator, "AsiaEast", 5);
    let renewed = generator.club("AsiaEast", 5, 1, YEAR, None).unwrap();

    assert_eq!(first.team.id, renewed.team.id);
    assert_eq!(first.team.name, renewed.team.name);
    assert_eq!(first.coach.id, renewed.coach.id);
    let old: HashSet<&str> = first.players.iter().map(|p| p.id.as_str()).collect();
    assert!(renewed.players.iter().all(|p| !old.contains(p.id.as_str())));
}

/// Given a nation's names,
/// when a spare slot is asked for, and a slot past the end,
/// then the spare is a valid name no club in the first slots has, and past the end is an error.
#[test]
fn spare_slots_give_unused_names_and_the_end_is_an_error() {
    let pack = pack();
    let generator = Generator::new(SEED, &pack).unwrap();
    let capacity = generator.name_capacity("VN");
    let spare = generator.club_name("VN", capacity - 1).unwrap();
    let used: HashSet<String> = (0..50)
        .map(|slot| generator.club_name("VN", slot).unwrap().folded)
        .collect();

    assert!(!used.contains(&spare.folded));
    assert!(matches!(
        generator.club_name("VN", capacity),
        Err(GenError::NameSpaceExhausted { .. })
    ));
}

/// Given a batch of free agents,
/// when it is generated,
/// then every one is unattached, of a nation the pack names, and the batch repeats from its key.
#[test]
fn free_agents_belong_to_no_club_and_repeat_from_their_batch() {
    let pack = pack();
    let generator = Generator::new(SEED, &pack).unwrap();
    let batch = generator.free_agents(0, 40, YEAR).unwrap();
    let again = generator.free_agents(0, 40, YEAR).unwrap();

    assert_eq!(batch.len(), 40);
    assert!(
        batch
            .iter()
            .all(|p| p.team_id.is_none() && pack.names.contains_key(&p.nationality))
    );
    assert_eq!(
        batch.iter().map(|p| &p.id).collect::<Vec<_>>(),
        again.iter().map(|p| &p.id).collect::<Vec<_>>()
    );
}

/// Given the builtin pack,
/// when its canonical form is taken before and after a round trip through JSON with the keys in
/// another order,
/// then the bytes are the same: a server hashes this form (S-6 §3.5).
#[test]
fn a_packs_canonical_form_ignores_spacing_and_key_order() {
    let pack = pack();
    let reordered: serde_json::Value = serde_json::from_slice(&pack.canonical_json()).unwrap();
    let pretty = serde_json::to_string_pretty(&reordered).unwrap();
    let again = OnlineContentPack::from_json(&pretty).unwrap();
    assert_eq!(pack.canonical_json(), again.canonical_json());
}

/// Whether `player` has an identity of his own: a position, not only his group (a keeper's
/// group is one), inside that group; alternates that are positions too; an overall rated at that position.
fn has_own_identity(player: &domain::player::Player) -> bool {
    use domain::player::Position;
    let natural = &player.natural_position;
    // A keeper's group is his position.
    (*natural == Position::Goalkeeper || !natural.is_legacy_bucket())
        && natural.to_group_position() == player.position.to_group_position()
        && !player
            .alternate_positions
            .iter()
            .any(|alt| alt.is_legacy_bucket())
        && player.ovr == ofm_rules::player_rating::natural_ovr(player).round() as u8
}

/// Given the clubs of a region,
/// when they are generated,
/// then every player has a position of his own within his group (a left back, a winger, …),
/// rated at it, and the clubs between them field a spread of positions, as a desktop career's
/// players do once they are upgraded.
#[test]
fn every_club_player_has_a_position_of_his_own() {
    let pack = pack();
    let generator = Generator::new(SEED, &pack).expect("a generator");
    let mut positions = HashSet::new();
    for ordinal in 0..12 {
        for player in &club(&generator, "AsiaSoutheast", ordinal).players {
            assert!(
                has_own_identity(player),
                "{} {:?}",
                player.id,
                player.natural_position
            );
            positions.insert(format!("{:?}", player.natural_position));
        }
    }
    assert!(positions.len() >= 10, "only {positions:?}");
}

/// Given a batch of free agents,
/// when it is generated,
/// then each has a position of his own within his group, rated at it.
#[test]
fn every_free_agent_has_a_position_of_his_own() {
    let pack = pack();
    let generator = Generator::new(SEED, &pack).expect("a generator");
    for player in generator.free_agents(0, 40, YEAR).expect("free agents") {
        assert!(
            has_own_identity(&player),
            "{} {:?}",
            player.id,
            player.natural_position
        );
    }
}
