use serde::{Deserialize, Serialize};
use sqlx::types::Json;

/// A trainee (character) loaded from the `trainees` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trainee {
    pub id: i32,
    pub name: String,
    pub name_jp: Option<String>,
    pub title: Option<String>,
    pub rarity: i16, // 1 | 2 | 3

    // Aptitude grades: S/A/B/C/D/E/F/G
    pub apt_turf: Option<String>,
    pub apt_dirt: Option<String>,
    pub apt_short: Option<String>,
    pub apt_mile: Option<String>,
    pub apt_mid: Option<String>,
    pub apt_long: Option<String>,
    pub apt_leading: Option<String>,   // Front Runner
    pub apt_stalking: Option<String>,  // Pace Chaser
    pub apt_mid_pack: Option<String>,  // Late Surger
    pub apt_chasing: Option<String>,   // End Closer

    // Stats arrays: [speed, stamina, power, guts, wisdom] — stored as JSONB
    pub stats_base: Option<Json<Vec<i16>>>,
    pub stats_two_star: Option<Json<Vec<i16>>>,
    pub stats_three_star: Option<Json<Vec<i16>>>,
    pub stats_four_star: Option<Json<Vec<i16>>>,
    pub stats_five_star: Option<Json<Vec<i16>>>,

    // Growth rate percentages: [speed, stamina, power, guts, wisdom] — stored as JSONB
    pub stat_growth: Option<Json<Vec<i16>>>,
}

impl Trainee {
    /// Get the growth rate for a given stat index (0=speed, 1=stamina, 2=power, 3=guts, 4=wisdom).
    /// Returns the percentage as a float (e.g. 20 -> 0.20).
    pub fn growth_rate(&self, stat_index: usize) -> f64 {
        self.stat_growth
            .as_ref()
            .and_then(|g| g.0.get(stat_index))
            .map(|&v| v as f64 / 100.0)
            .unwrap_or(0.0)
    }

    /// Get starting stats for a given star rank (1-5).
    pub fn starting_stats(&self, star_rank: u8) -> [f64; 5] {
        let stats = match star_rank {
            1 => &self.stats_base,
            2 => &self.stats_two_star,
            3 => &self.stats_three_star,
            4 => &self.stats_four_star,
            5 => &self.stats_five_star,
            _ => &self.stats_five_star,
        };
        let v = stats.as_ref().map(|j| &j.0).or(self.stats_base.as_ref().map(|j| &j.0));
        match v {
            Some(s) if s.len() >= 5 => [
                s[0] as f64, s[1] as f64, s[2] as f64, s[3] as f64, s[4] as f64,
            ],
            _ => [0.0; 5],
        }
    }

    // /// Convert an aptitude grade string to a numeric multiplier.
    // /// S=1.1, A=1.0, B=0.9, C=0.8, D=0.7, E=0.6, F=0.5, G=0.4
    // pub fn aptitude_multiplier(grade: &str) -> f64 {
    //     match grade {
    //         "S" => 1.1,
    //         "A" => 1.0,
    //         "B" => 0.9,
    //         "C" => 0.8,
    //         "D" => 0.7,
    //         "E" => 0.6,
    //         "F" => 0.5,
    //         "G" => 0.4,
    //         _ => 1.0,
    //     }
    // }

    // /// Get the strategy aptitude grade for a running style.
    // pub fn strategy_aptitude(&self, strategy: &str) -> Option<&str> {
    //     match strategy {
    //         "leading" | "runner" => self.apt_leading.as_deref(),
    //         "stalking" | "leader" => self.apt_stalking.as_deref(),
    //         "mid_pack" | "betweener" => self.apt_mid_pack.as_deref(),
    //         "chasing" | "chaser" => self.apt_chasing.as_deref(),
    //         _ => None,
    //     }
    // }

    // /// Get the distance aptitude grade.
    // pub fn distance_aptitude(&self, distance: &str) -> Option<&str> {
    //     match distance {
    //         "short" | "sprint" => self.apt_short.as_deref(),
    //         "mile" => self.apt_mile.as_deref(),
    //         "mid" | "medium" => self.apt_mid.as_deref(),
    //         "long" => self.apt_long.as_deref(),
    //         _ => None,
    //     }
    // }
}
