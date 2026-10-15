//! Portraits for players who have no photo of their own.
//!
//! Each player is given one face from a bundled pool of cut-out portraits
//! (`assets/portrait-sources/`, built by `ofm-packages/avatar/build_portraits.py`).
//! The face matches how players of his nationality look and roughly how old
//! he is, and is shown as drawn — earlier versions recoloured shirts, hair and
//! skin through fixed masks, which smeared shirt colour onto necks and cut a
//! seam across the eyes.

mod appearance;
mod catalog;

use chrono::{DateTime, Datelike, NaiveDate, Utc};
use ofm_core::state::StateManager;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Once};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

const GENERATOR_VERSION: &str = "runtime-face-pool-v3";
const SIZE: u32 = 256;
const CACHE_ROOT: &str = "generated-player-portraits";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerPortraitRequest {
    pub player_id: String,
    pub full_name: Option<String>,
    pub match_name: Option<String>,
    pub nationality: Option<String>,
    pub date_of_birth: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerPortraitResponse {
    pub generator: &'static str,
    pub cache_key: String,
    pub source_id: String,
    pub cache_path: String,
    pub data_url: Option<String>,
    pub generated: bool,
    pub render_ms: f64,
    pub elapsed_ms: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrewarmPlayerPortraitRecord {
    pub player_id: String,
    pub cache_key: String,
    pub source_id: String,
    pub cache_path: String,
    pub generated: bool,
    pub render_ms: f64,
    pub elapsed_ms: f64,
    pub data_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrewarmPlayerPortraitsResponse {
    pub generator: &'static str,
    pub requested_count: usize,
    pub generated_count: usize,
    pub cached_count: usize,
    pub failed_count: usize,
    pub render_ms: f64,
    pub elapsed_ms: f64,
    pub records: Vec<PrewarmPlayerPortraitRecord>,
}

/// How a face looks, broadly enough to match a nationality to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AppearanceGroup {
    Black,
    EastAsian,
    EuropeanNorth,
    EuropeanSouth,
    Latin,
    MiddleEastern,
    Polynesian,
    SouthAsian,
    SoutheastAsian,
}

/// How old a face looks: up to 22, 23 to 29, 30 and over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgeBand {
    Young,
    Prime,
    Veteran,
}

struct PortraitFace {
    id: &'static str,
    group: AppearanceGroup,
    band: AgeBand,
    bytes: &'static [u8],
}

/// The face a player gets, and whether it is shown mirrored. Mirroring
/// doubles the pool for free: a face and its mirror image read as two people
/// at avatar size.
struct FaceChoice {
    face: &'static PortraitFace,
    mirrored: bool,
}

impl FaceChoice {
    fn cache_key(&self) -> String {
        if self.mirrored {
            format!("{}-m", self.face.id)
        } else {
            self.face.id.to_string()
        }
    }
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
static PRUNE_OLD_CACHES: Once = Once::new();

#[tauri::command]
pub async fn generate_player_portrait(
    app: AppHandle,
    state: State<'_, Arc<StateManager>>,
    request: PlayerPortraitRequest,
) -> Result<PlayerPortraitResponse, String> {
    let cache_dir = portrait_cache_dir(&app)?;
    let reference_date = portrait_reference_date(&state);

    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let record = ensure_portrait_file(&cache_dir, &request, reference_date)?;
        let response = PlayerPortraitResponse {
            generator: GENERATOR_VERSION,
            cache_key: record.cache_key,
            source_id: record.source_id,
            cache_path: record.cache_path,
            data_url: None,
            generated: record.generated,
            render_ms: record.render_ms,
            elapsed_ms: round3(elapsed_ms(started)),
            width: SIZE,
            height: SIZE,
        };
        log::debug!(
            "[portraits] player_id={} face={} generated={}",
            request.player_id,
            response.source_id,
            response.generated
        );
        Ok(response)
    })
    .await
    .map_err(|error| format!("portrait generation task failed: {error}"))?
}

#[tauri::command]
pub async fn prewarm_player_portraits(
    app: AppHandle,
    state: State<'_, Arc<StateManager>>,
    requests: Vec<PlayerPortraitRequest>,
) -> Result<PrewarmPlayerPortraitsResponse, String> {
    let cache_dir = portrait_cache_dir(&app)?;
    let reference_date = portrait_reference_date(&state);

    tauri::async_runtime::spawn_blocking(move || {
        let result = prewarm_player_portraits_to_dir(&cache_dir, &requests, reference_date);
        log::debug!(
            "[portraits] prewarmed requested={} generated={} cached={} failed={}",
            result.requested_count,
            result.generated_count,
            result.cached_count,
            result.failed_count
        );
        Ok(result)
    })
    .await
    .map_err(|error| format!("portrait prewarm task failed: {error}"))?
}

/// The date a player's age is taken on: the day the save began.
///
/// Not today's game date, on purpose. The face is picked by age band, so
/// ageing a player through the game clock would swap his face for a stranger's
/// the season he turned 23 or 30. Measured from the save's start, a face stays
/// his for the whole save. Without an active game the real date stands in.
fn portrait_reference_date(state: &StateManager) -> NaiveDate {
    state
        .get_game(|game| game.clock.start_date)
        .unwrap_or_else(Utc::now)
        .date_naive()
}

fn portrait_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join(CACHE_ROOT);
    PRUNE_OLD_CACHES.call_once(|| prune_other_generator_versions(&root));
    Ok(root.join(GENERATOR_VERSION))
}

/// Delete caches written by earlier generator versions. Nothing reads them
/// again once the version changes, and the per-player recolouring version left
/// one file per player — thousands on a long save.
fn prune_other_generator_versions(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name() == GENERATOR_VERSION {
            continue;
        }
        if let Err(error) = fs::remove_dir_all(entry.path()) {
            log::warn!(
                "[portraits] could not remove old cache {}: {error}",
                entry.path().display()
            );
        }
    }
}

fn prewarm_player_portraits_to_dir(
    cache_dir: &Path,
    requests: &[PlayerPortraitRequest],
    reference_date: NaiveDate,
) -> PrewarmPlayerPortraitsResponse {
    let started = Instant::now();
    let mut records = Vec::with_capacity(requests.len());
    let mut failed_count = 0usize;

    for request in requests {
        match ensure_portrait_file(cache_dir, request, reference_date) {
            Ok(record) => records.push(record),
            Err(error) => {
                failed_count += 1;
                log::warn!(
                    "[portraits] failed to prewarm portrait for player_id={}: {}",
                    request.player_id,
                    error
                );
            }
        }
    }

    let generated_count = records.iter().filter(|record| record.generated).count();
    let cached_count = records.len().saturating_sub(generated_count);
    let render_ms = records.iter().map(|record| record.render_ms).sum();

    PrewarmPlayerPortraitsResponse {
        generator: GENERATOR_VERSION,
        requested_count: requests.len(),
        generated_count,
        cached_count,
        failed_count,
        render_ms: round3(render_ms),
        elapsed_ms: round3(elapsed_ms(started)),
        records,
    }
}

fn choose_face(request: &PlayerPortraitRequest, reference_date: NaiveDate) -> FaceChoice {
    let mut state = portrait_seed(request);
    let group = appearance::pick_group(request.nationality.as_deref(), next_u64(&mut state));
    let age = request
        .date_of_birth
        .as_deref()
        .and_then(|dob| age_on(dob, reference_date));
    let candidates = appearance::candidates(group, appearance::age_band(age));
    let face = candidates[(next_u64(&mut state) as usize) % candidates.len()];
    FaceChoice {
        face,
        mirrored: next_u64(&mut state) % 2 == 1,
    }
}

fn age_on(date_of_birth: &str, on: NaiveDate) -> Option<i32> {
    let born = date_of_birth
        .get(..10)
        .and_then(|day| NaiveDate::parse_from_str(day, "%Y-%m-%d").ok())
        .or_else(|| {
            DateTime::parse_from_rfc3339(date_of_birth)
                .ok()
                .map(|moment| moment.date_naive())
        })?;
    let mut age = on.year() - born.year();
    if (on.month(), on.day()) < (born.month(), born.day()) {
        age -= 1;
    }
    Some(age)
}

/// Faces are shared between players, so the cache holds one file per face
/// (and per mirror), not one per player.
fn ensure_portrait_file(
    cache_dir: &Path,
    request: &PlayerPortraitRequest,
    reference_date: NaiveDate,
) -> Result<PrewarmPlayerPortraitRecord, String> {
    let started = Instant::now();
    let choice = choose_face(request, reference_date);
    let cache_key = choice.cache_key();
    fs::create_dir_all(cache_dir)
        .map_err(|error| format!("failed to create portrait cache: {error}"))?;
    let cache_path = cache_dir.join(format!("{cache_key}.webp"));

    let generated = !cache_path.exists();
    let mut render_ms = 0.0;
    if generated {
        let render_started = Instant::now();
        let bytes = face_bytes(&choice)?;
        render_ms = elapsed_ms(render_started);
        write_cache_file_atomically(&cache_path, &bytes)?;
    }

    Ok(PrewarmPlayerPortraitRecord {
        player_id: request.player_id.clone(),
        cache_key,
        source_id: choice.face.id.to_string(),
        cache_path: cache_path.to_string_lossy().to_string(),
        generated,
        render_ms: round3(render_ms),
        elapsed_ms: round3(elapsed_ms(started)),
        data_url: None,
    })
}

fn face_bytes(choice: &FaceChoice) -> Result<Vec<u8>, String> {
    if !choice.mirrored {
        return Ok(choice.face.bytes.to_vec());
    }
    let image = image::load_from_memory(choice.face.bytes)
        .map_err(|error| format!("failed to decode portrait {}: {error}", choice.face.id))?
        .fliph()
        .to_rgba8();
    let encoded =
        webp::Encoder::from_rgba(image.as_raw(), image.width(), image.height()).encode(85.0);
    Ok(encoded.to_vec())
}

fn write_cache_file_atomically(cache_path: &Path, bytes: &[u8]) -> Result<(), String> {
    let file_name = cache_path
        .file_name()
        .ok_or_else(|| "portrait cache path has no file name".to_string())?;
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut temp_file_name = file_name.to_os_string();
    temp_file_name.push(format!(".{}.tmp", counter));
    let temp_path = cache_path.with_file_name(temp_file_name);

    if let Err(error) = fs::write(&temp_path, bytes) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("failed to write portrait cache temp file: {error}"));
    }

    match fs::rename(&temp_path, cache_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::AlreadyExists && cache_path.exists() => {
            let _ = fs::remove_file(&temp_path);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(format!("failed to publish portrait cache: {error}"))
        }
    }
}

fn portrait_seed(request: &PlayerPortraitRequest) -> u64 {
    let part = |value: Option<&str>| value.unwrap_or_default().trim().to_lowercase();
    stable_hash_bytes(
        format!(
            "{}|{}|{}|{}|{}|{}",
            GENERATOR_VERSION,
            request.player_id.trim().to_lowercase(),
            part(request.full_name.as_deref()),
            part(request.match_name.as_deref()),
            part(request.nationality.as_deref()),
            part(request.date_of_birth.as_deref()),
        )
        .as_bytes(),
    )
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn stable_hash_bytes(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn next_u64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests;
