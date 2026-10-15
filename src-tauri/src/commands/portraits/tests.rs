use super::*;
use catalog::FACES;

fn request(id: &str, nationality: &str, date_of_birth: &str) -> PlayerPortraitRequest {
    PlayerPortraitRequest {
        player_id: id.to_string(),
        full_name: Some(format!("Player {id}")),
        match_name: Some(id.to_string()),
        nationality: Some(nationality.to_string()),
        date_of_birth: Some(date_of_birth.to_string()),
    }
}

fn day(text: &str) -> NaiveDate {
    NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
}

fn temp_dir(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "ofm-portrait-{label}-{}",
        stable_hash_bytes(format!("{:?}", std::time::SystemTime::now()).as_bytes())
    ))
}

/// Given the bundled pool,
/// when every face is decoded,
/// then each is a square SIZE x SIZE cut-out with a transparent corner.
#[test]
fn bundled_faces_are_square_cutouts() {
    assert!(FACES.len() >= 200, "pool has only {} faces", FACES.len());
    for face in FACES {
        let image = image::load_from_memory(face.bytes)
            .unwrap_or_else(|error| panic!("{} does not decode: {error}", face.id))
            .to_rgba8();
        assert_eq!((image.width(), image.height()), (SIZE, SIZE), "{}", face.id);
        assert_eq!(
            image.get_pixel(0, 0).0[3],
            0,
            "{} has no transparent corner",
            face.id
        );
    }
}

/// Given the same player asked for twice,
/// when a face is chosen,
/// then it is the same face, mirrored the same way.
#[test]
fn same_player_always_gets_the_same_face() {
    let player = request("p-123", "PT", "2003-04-12");
    let reference = day("2025-07-01");
    let first = choose_face(&player, reference);
    let second = choose_face(&player, reference);
    assert_eq!(first.face.id, second.face.id);
    assert_eq!(first.mirrored, second.mirrored);
}

/// Given many Japanese players,
/// when their faces are chosen,
/// then every one is an East Asian face.
#[test]
fn single_group_nation_gets_faces_of_that_group() {
    let reference = day("2025-07-01");
    for n in 0..200 {
        let choice = choose_face(&request(&format!("jp-{n}"), "JP", "2000-01-01"), reference);
        assert_eq!(
            choice.face.group,
            AppearanceGroup::EastAsian,
            "{}",
            choice.face.id
        );
    }
}

/// Given 17-year-old and 34-year-old players from a well-stocked nation,
/// when their faces are chosen,
/// then teenagers get young faces and veterans get veteran faces.
#[test]
fn faces_follow_the_players_age() {
    let reference = day("2025-07-01");
    for n in 0..200 {
        let teen = choose_face(&request(&format!("t-{n}"), "IT", "2008-03-01"), reference);
        assert_eq!(teen.face.band, AgeBand::Young, "teen got {}", teen.face.id);
        let veteran = choose_face(&request(&format!("v-{n}"), "IT", "1991-03-01"), reference);
        assert_eq!(
            veteran.face.band,
            AgeBand::Veteran,
            "veteran got {}",
            veteran.face.id
        );
    }
}

/// Given a squad-sized set of players from one nation,
/// when their faces are chosen,
/// then they are spread over many different faces, not a handful repeated.
#[test]
fn a_squad_from_one_nation_gets_varied_faces() {
    let reference = day("2025-07-01");
    let faces: std::collections::HashSet<_> = (0..25)
        .map(|n| choose_face(&request(&format!("s-{n}"), "ES", "1999-05-05"), reference))
        .map(|choice| choice.cache_key())
        .collect();
    assert!(faces.len() >= 15, "only {} distinct faces", faces.len());
}

/// Given a birthday one day after the reference date,
/// when the age is taken,
/// then the birthday has not been counted yet.
#[test]
fn age_counts_whole_years_up_to_the_reference_date() {
    assert_eq!(age_on("2003-07-02", day("2025-07-01")), Some(21));
    assert_eq!(age_on("2003-07-01", day("2025-07-01")), Some(22));
    assert_eq!(age_on("2003-07-01T00:00:00Z", day("2025-07-01")), Some(22));
    assert_eq!(age_on("not a date", day("2025-07-01")), None);
}

/// Given two players who share a face,
/// when both are prewarmed,
/// then the face is written once and the second is served from the cache.
#[test]
fn prewarm_writes_each_face_once_and_reuses_it() {
    let dir = temp_dir("prewarm");
    let reference = day("2025-07-01");
    let first = request("p-1", "JP", "2000-01-01");
    let target = choose_face(&first, reference).cache_key();
    let twin = (2..5000)
        .map(|n| request(&format!("p-{n}"), "JP", "2000-01-01"))
        .find(|candidate| choose_face(candidate, reference).cache_key() == target)
        .expect("some other player shares the face");

    let result = prewarm_player_portraits_to_dir(&dir, &[first, twin], reference);

    assert_eq!(result.requested_count, 2);
    assert_eq!(result.generated_count, 1);
    assert_eq!(result.cached_count, 1);
    assert_eq!(result.failed_count, 0);
    assert!(Path::new(&result.records[0].cache_path).exists());
    let _ = fs::remove_dir_all(dir);
}

/// Given a face chosen mirrored,
/// when its bytes are produced,
/// then they are a valid WebP of the same size, flipped left to right.
#[test]
fn mirrored_face_is_a_flipped_webp() {
    let face = &FACES[0];
    let bytes = face_bytes(&FaceChoice {
        face,
        mirrored: true,
    })
    .unwrap();
    assert!(bytes.starts_with(b"RIFF"));
    assert_eq!(&bytes[8..12], b"WEBP");
    let original = image::load_from_memory(face.bytes).unwrap().to_rgba8();
    let mirrored = image::load_from_memory(&bytes).unwrap().to_rgba8();
    assert_eq!(mirrored.dimensions(), original.dimensions());
    let y = SIZE / 2;
    let left = original.get_pixel(SIZE / 4, y).0;
    let flipped = mirrored.get_pixel(SIZE - 1 - SIZE / 4, y).0;
    for channel in 0..3 {
        assert!(left[channel].abs_diff(flipped[channel]) < 24);
    }
}

/// Given a cache root holding an older generator's directory,
/// when old versions are pruned,
/// then only the current version's directory survives.
#[test]
fn pruning_removes_only_other_generator_versions() {
    let root = temp_dir("prune");
    fs::create_dir_all(root.join("runtime-component-recipe-rust-v1")).unwrap();
    fs::write(root.join("runtime-component-recipe-rust-v1/a.webp"), b"x").unwrap();
    fs::create_dir_all(root.join(GENERATOR_VERSION)).unwrap();

    prune_other_generator_versions(&root);

    assert!(!root.join("runtime-component-recipe-rust-v1").exists());
    assert!(root.join(GENERATOR_VERSION).exists());
    let _ = fs::remove_dir_all(root);
}

/// Given a write into the cache,
/// when it completes,
/// then the final file is there and no temp file is left behind.
#[test]
fn atomic_cache_write_publishes_final_file_without_temp_leftovers() {
    let temp = temp_dir("atomic");
    fs::create_dir_all(&temp).unwrap();
    let cache_path = temp.join("portrait.webp");

    write_cache_file_atomically(&cache_path, b"portrait-bytes").unwrap();

    assert_eq!(fs::read(&cache_path).unwrap(), b"portrait-bytes");
    let leftovers = fs::read_dir(&temp)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp"))
        .count();
    assert_eq!(leftovers, 0);
    let _ = fs::remove_dir_all(temp);
}

/// Given many Mexican players,
/// when their faces are chosen,
/// then most of them get mixed-heritage Latin American faces, not European ones.
#[test]
fn latin_american_nations_mostly_get_latin_faces() {
    let reference = day("2025-07-01");
    let latin = (0..400)
        .map(|n| choose_face(&request(&format!("mx-{n}"), "MX", "1998-02-02"), reference))
        .filter(|choice| choice.face.group == AppearanceGroup::Latin)
        .count();
    assert!(
        latin >= 280,
        "only {latin} of 400 Mexican players got Latin faces"
    );
}
