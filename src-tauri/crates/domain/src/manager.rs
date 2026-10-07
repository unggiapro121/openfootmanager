use crate::team::PlayStyle;
use serde::{Deserialize, Serialize};

fn default_fan_approval() -> u8 {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manager {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: String,
    pub nationality: String,
    #[serde(default)]
    pub football_nation: String,
    #[serde(default)]
    pub birth_country: Option<String>,
    pub reputation: u32,
    pub satisfaction: u8, // 0 to 100
    #[serde(default = "default_fan_approval")]
    pub fan_approval: u8, // 0 to 100 — fan sentiment
    pub team_id: Option<String>,

    // Board warning stage at current club: 0 = none, 1 = warning, 2 = final warning.
    // Reset to 0 on hire so warnings don't carry over between clubs.
    #[serde(default)]
    pub warning_stage: u8,

    // Career stats (cumulative)
    pub career_stats: ManagerCareerStats,

    // Employment history
    pub career_history: Vec<ManagerCareerEntry>,

    /// How well the manager gets each play style across, one value per style.
    /// A save written before this existed loads neutral (50 in every style).
    #[serde(default)]
    pub play_style_mastery: PlayStyleMastery,
}

/// The neutral mastery: a style plays exactly as the engine's table prices it.
const NEUTRAL_MASTERY: u8 = 50;

/// A manager's command of each play style, 1–100. Keys serialize as the play
/// style names ("Balanced" … "HighPress"), the ids the frontend already uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct PlayStyleMastery {
    pub balanced: u8,
    pub attacking: u8,
    pub defensive: u8,
    pub possession: u8,
    pub counter: u8,
    pub high_press: u8,
}

impl Default for PlayStyleMastery {
    fn default() -> Self {
        Self {
            balanced: NEUTRAL_MASTERY,
            attacking: NEUTRAL_MASTERY,
            defensive: NEUTRAL_MASTERY,
            possession: NEUTRAL_MASTERY,
            counter: NEUTRAL_MASTERY,
            high_press: NEUTRAL_MASTERY,
        }
    }
}

impl PlayStyleMastery {
    pub fn for_style(&self, style: &PlayStyle) -> u8 {
        match style {
            PlayStyle::Balanced => self.balanced,
            PlayStyle::Attacking => self.attacking,
            PlayStyle::Defensive => self.defensive,
            PlayStyle::Possession => self.possession,
            PlayStyle::Counter => self.counter,
            PlayStyle::HighPress => self.high_press,
        }
    }

    pub fn set(&mut self, style: &PlayStyle, value: u8) {
        let slot = match style {
            PlayStyle::Balanced => &mut self.balanced,
            PlayStyle::Attacking => &mut self.attacking,
            PlayStyle::Defensive => &mut self.defensive,
            PlayStyle::Possession => &mut self.possession,
            PlayStyle::Counter => &mut self.counter,
            PlayStyle::HighPress => &mut self.high_press,
        };
        *slot = value;
    }

    /// The style the manager is strongest in; on a tie, the earlier style in
    /// `ALL_PLAY_STYLES` order, so a neutral manager prefers Balanced.
    pub fn best_style(&self) -> PlayStyle {
        let mut best = PlayStyle::Balanced;
        for style in ALL_PLAY_STYLES {
            if self.for_style(&style) > self.for_style(&best) {
                best = style;
            }
        }
        best
    }
}

/// Every play style, in the order the game lists them.
pub const ALL_PLAY_STYLES: [PlayStyle; 6] = [
    PlayStyle::Balanced,
    PlayStyle::Attacking,
    PlayStyle::Defensive,
    PlayStyle::Possession,
    PlayStyle::Counter,
    PlayStyle::HighPress,
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManagerCareerStats {
    pub matches_managed: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub trophies: u32,
    pub best_finish: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagerCareerEntry {
    pub team_id: String,
    pub team_name: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub matches: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub best_league_position: Option<u32>,
}

impl ManagerCareerEntry {
    pub fn open(team_id: String, team_name: String, start_date: String) -> Self {
        Self {
            team_id,
            team_name,
            start_date,
            end_date: None,
            matches: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            best_league_position: None,
        }
    }
}

impl Manager {
    pub fn new(
        id: String,
        first_name: String,
        last_name: String,
        date_of_birth: String,
        nationality: String,
    ) -> Self {
        let football_nation = crate::identity::normalize_football_nation_code(&nationality);
        let birth_country = crate::identity::derive_birth_country_code(&nationality);
        Self {
            id,
            first_name,
            last_name,
            date_of_birth,
            nationality,
            football_nation,
            birth_country,
            reputation: 500,
            satisfaction: 100,
            fan_approval: 50,
            team_id: None,
            warning_stage: 0,
            career_stats: ManagerCareerStats::default(),
            career_history: Vec::new(),
            play_style_mastery: PlayStyleMastery::default(),
        }
    }

    pub fn hire(&mut self, team_id: String) {
        self.team_id = Some(team_id);
        self.warning_stage = 0;
    }

    pub fn fire(&mut self, date: &str) {
        if let Some(entry) = self
            .career_history
            .iter_mut()
            .find(|e| e.end_date.is_none())
        {
            entry.end_date = Some(date.to_string());
        }
        self.team_id = None;
        self.warning_stage = 0;
    }

    pub fn full_name(&self) -> String {
        format!("{} {}", self.first_name, self.last_name)
    }

    pub fn win_rate(&self) -> f32 {
        if self.career_stats.matches_managed == 0 {
            return 0.0;
        }
        self.career_stats.wins as f32 / self.career_stats.matches_managed as f32 * 100.0
    }

    /// A player-OVR-style overall rating (≈30–95) summarising the manager's
    /// standing, track record, and experience. Drives AI squad-management quality
    /// (rotation aggressiveness) and can be surfaced in the UI like a player's OVR.
    ///
    /// Blend: 50% reputation, 30% track record (win rate + trophies), 20%
    /// experience (matches managed). A fresh mid-reputation manager sits near 50;
    /// a decorated, experienced one approaches the high 80s.
    ///
    /// Reputation is normalised against the 300–900 club-reputation domain (the
    /// same scale `management_quality` uses) because AI managers inherit their
    /// club's reputation; a narrower domain would saturate every elite club at
    /// the top and flatten the rotation gradient.
    pub fn rating(&self) -> u8 {
        let reputation = ((f64::from(self.reputation) - 300.0) / 600.0).clamp(0.0, 1.0);
        let experience = (f64::from(self.career_stats.matches_managed) / 250.0).clamp(0.0, 1.0);
        let win_rate = (f64::from(self.win_rate()) / 100.0).clamp(0.0, 1.0);
        let trophies = (f64::from(self.career_stats.trophies) / 10.0).clamp(0.0, 1.0);
        let track_record = 0.7 * win_rate + 0.3 * trophies;
        let score = 0.50 * reputation + 0.30 * track_record + 0.20 * experience;
        (30.0 + 65.0 * score).round() as u8
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> Manager {
        Manager::new(
            "m1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        )
    }

    #[test]
    fn rating_for_fresh_mid_reputation_manager_is_mid_range() {
        // Mid of the 300–900 reputation domain, no career → sits around the middle.
        let mut m = manager();
        m.reputation = 600;
        let r = m.rating();
        assert!((45..=55).contains(&r), "expected mid-range rating, got {r}");
    }

    #[test]
    fn rating_rises_with_reputation_experience_and_success() {
        let mut elite = manager();
        elite.reputation = 800;
        elite.career_stats.matches_managed = 250;
        elite.career_stats.wins = 150; // 60% win rate
        elite.career_stats.trophies = 8;

        let mut journeyman = manager();
        journeyman.reputation = 250;
        journeyman.career_stats.matches_managed = 20;
        journeyman.career_stats.wins = 4; // 20% win rate

        let elite_rating = elite.rating();
        let journeyman_rating = journeyman.rating();

        assert!(
            elite_rating > journeyman_rating,
            "elite ({elite_rating}) should outrate journeyman ({journeyman_rating})"
        );
        assert!(
            elite_rating >= 80,
            "decorated manager should be high, got {elite_rating}"
        );
        assert!(
            (30..=99).contains(&elite_rating) && (30..=99).contains(&journeyman_rating),
            "ratings stay in the OVR-like band"
        );
    }

    /// Given a newly created manager — the player's own character,
    /// When their play style mastery is read,
    /// Then every style is 50, the neutral level at which a style plays as designed.
    #[test]
    fn a_new_manager_is_neutral_in_every_style() {
        let mastery = manager().play_style_mastery;

        for style in ALL_PLAY_STYLES {
            assert_eq!(mastery.for_style(&style), 50, "{style:?}");
        }
    }

    /// Given a manager strongest at Counter,
    /// When their preferred style is asked for,
    /// Then it is Counter, and each style reads its own value.
    #[test]
    fn the_best_style_is_the_highest_mastery() {
        let mastery = PlayStyleMastery {
            balanced: 40,
            attacking: 55,
            defensive: 30,
            possession: 61,
            counter: 77,
            high_press: 12,
        };

        assert_eq!(mastery.best_style(), PlayStyle::Counter);
        assert_eq!(mastery.for_style(&PlayStyle::Possession), 61);
        assert_eq!(mastery.for_style(&PlayStyle::HighPress), 12);
    }

    /// Given a mastery table,
    /// When it is serialized,
    /// Then its keys are the play style names the frontend already uses.
    #[test]
    fn mastery_is_keyed_by_play_style_name() {
        let json = serde_json::to_value(PlayStyleMastery::default()).expect("serialize");

        assert_eq!(json["Balanced"], 50);
        assert_eq!(json["HighPress"], 50);
    }

    /// Given a saved manager written before managers had a play style mastery,
    /// When it is loaded,
    /// Then the manager is neutral in every style rather than failing to load.
    #[test]
    fn a_manager_saved_without_mastery_loads_neutral() {
        let mut json = serde_json::to_value(manager()).expect("serialize");
        json.as_object_mut()
            .expect("object")
            .remove("play_style_mastery");

        let loaded: Manager = serde_json::from_value(json).expect("old save should load");

        assert_eq!(loaded.play_style_mastery.for_style(&PlayStyle::Counter), 50);
    }
}
