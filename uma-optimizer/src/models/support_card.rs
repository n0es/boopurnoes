use serde::{Deserialize, Serialize};

/// Maps directly to the `support_card_effects.effect_type_id` column.
/// These IDs match the EFFECT_META in your frontend importer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum EffectType {
    FriendshipBonus = 1,
    MoodEffect = 2,
    SpeedBonus = 3,
    StaminaBonus = 4,
    PowerBonus = 5,
    GutsBonus = 6,
    WitBonus = 7,
    TrainingEffectiveness = 8,
    InitialSpeed = 9,
    InitialStamina = 10,
    InitialPower = 11,
    InitialGuts = 12,
    InitialWit = 13,
    InitialFriendship = 14,
    RaceBonus = 15,
    FanBonus = 16,
    HintLevels = 17,
    HintFrequency = 18,
    SpecialtyPriority = 19,
    EventRecovery = 25,
    EventEffectiveness = 26,
    FailureProtection = 27,
    EnergyCostReduction = 28,
    SkillPointBonus = 30,
}

impl EffectType {
    pub fn from_id(id: i32) -> Option<Self> {
        match id {
            1 => Some(Self::FriendshipBonus),
            2 => Some(Self::MoodEffect),
            3 => Some(Self::SpeedBonus),
            4 => Some(Self::StaminaBonus),
            5 => Some(Self::PowerBonus),
            6 => Some(Self::GutsBonus),
            7 => Some(Self::WitBonus),
            8 => Some(Self::TrainingEffectiveness),
            9 => Some(Self::InitialSpeed),
            10 => Some(Self::InitialStamina),
            11 => Some(Self::InitialPower),
            12 => Some(Self::InitialGuts),
            13 => Some(Self::InitialWit),
            14 => Some(Self::InitialFriendship),
            15 => Some(Self::RaceBonus),
            16 => Some(Self::FanBonus),
            17 => Some(Self::HintLevels),
            18 => Some(Self::HintFrequency),
            19 => Some(Self::SpecialtyPriority),
            25 => Some(Self::EventRecovery),
            26 => Some(Self::EventEffectiveness),
            27 => Some(Self::FailureProtection),
            28 => Some(Self::EnergyCostReduction),
            30 => Some(Self::SkillPointBonus),
            _ => None,
        }
    }

    /// Returns true if this is a flat stat bonus (Speed/Stamina/Power/Guts/Wit Bonus).
    pub fn is_stat_bonus(&self) -> bool {
        matches!(
            self,
            Self::SpeedBonus
                | Self::StaminaBonus
                | Self::PowerBonus
                | Self::GutsBonus
                | Self::WitBonus
        )
    }

    /// Map stat bonus effect type to stat index (0-4). Returns None for non-stat effects.
    pub fn stat_index(&self) -> Option<usize> {
        match self {
            Self::SpeedBonus | Self::InitialSpeed => Some(0),
            Self::StaminaBonus | Self::InitialStamina => Some(1),
            Self::PowerBonus | Self::InitialPower => Some(2),
            Self::GutsBonus | Self::InitialGuts => Some(3),
            Self::WitBonus | Self::InitialWit => Some(4),
            _ => None,
        }
    }
}

/// A single effect row from `support_card_effects`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportCardEffect {
    pub effect_type: EffectType,
    pub effect_name: String,
    pub unlock_level: i32,
    /// Values indexed by (level - 1). e.g. values_by_level[29] = value at level 30.
    pub values_by_level: Vec<i32>,
}

impl SupportCardEffect {
    /// Get the effect value at a specific card level (1-indexed).
    pub fn value_at_level(&self, level: i32) -> f64 {
        if level < self.unlock_level {
            return 0.0;
        }
        let idx = (level - 1).max(0) as usize;
        self.values_by_level
            .get(idx)
            .or_else(|| self.values_by_level.last())
            .copied()
            .unwrap_or(0) as f64
    }
}

/// A support card with all its effects pre-loaded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportCard {
    pub id: i32,
    pub name: String,
    pub rarity: String,         // SSR | SR | R
    pub card_type: String,      // speed | stamina | power | guts | intelligence | friend | group
    pub effects: Vec<SupportCardEffect>,
}

impl SupportCard {
    /// Get the value of a specific effect type at a given card level.
    pub fn effect_value(&self, effect_type: EffectType, level: i32) -> f64 {
        self.effects
            .iter()
            .find(|e| e.effect_type == effect_type)
            .map(|e| e.value_at_level(level))
            .unwrap_or(0.0)
    }

    /// Convenience: friendship bonus as a decimal (e.g. 35 -> 0.35).
    pub fn friendship_bonus(&self, level: i32) -> f64 {
        self.effect_value(EffectType::FriendshipBonus, level) / 100.0
    }

    /// Convenience: training effectiveness as a decimal.
    pub fn training_effectiveness(&self, level: i32) -> f64 {
        self.effect_value(EffectType::TrainingEffectiveness, level) / 100.0
    }

    /// Convenience: mood effect as a decimal.
    pub fn mood_effect(&self, level: i32) -> f64 {
        self.effect_value(EffectType::MoodEffect, level) / 100.0
    }

    /// Convenience: specialty priority (raw integer).
    pub fn specialty_priority(&self, level: i32) -> f64 {
        self.effect_value(EffectType::SpecialtyPriority, level)
    }

    /// Convenience: race bonus as a decimal.
    pub fn race_bonus(&self, level: i32) -> f64 {
        self.effect_value(EffectType::RaceBonus, level) / 100.0
    }

    /// Convenience: initial friendship gauge value.
    pub fn initial_friendship(&self, level: i32) -> f64 {
        self.effect_value(EffectType::InitialFriendship, level)
    }

    /// Get flat stat bonus for a given stat index at a card level.
    pub fn stat_bonus(&self, stat_index: usize, level: i32) -> f64 {
        let effect_type = match stat_index {
            0 => EffectType::SpeedBonus,
            1 => EffectType::StaminaBonus,
            2 => EffectType::PowerBonus,
            3 => EffectType::GutsBonus,
            4 => EffectType::WitBonus,
            _ => return 0.0,
        };
        self.effect_value(effect_type, level)
    }

    /// Get initial stat for a given stat index at a card level.
    pub fn initial_stat(&self, stat_index: usize, level: i32) -> f64 {
        let effect_type = match stat_index {
            0 => EffectType::InitialSpeed,
            1 => EffectType::InitialStamina,
            2 => EffectType::InitialPower,
            3 => EffectType::InitialGuts,
            4 => EffectType::InitialWit,
            _ => return 0.0,
        };
        self.effect_value(effect_type, level)
    }

    /// Map card_type to the training facility stat index (0-4).
    /// friend/group cards don't have a primary training facility.
    pub fn primary_stat_index(&self) -> Option<usize> {
        match self.card_type.as_str() {
            "speed" => Some(0),
            "stamina" => Some(1),
            "power" => Some(2),
            "guts" => Some(3),
            "intelligence" => Some(4),
            _ => None, // friend, group
        }
    }

    /// Max level for a given uncap tier.
    pub fn max_level_for_uncap(rarity: &str, uncap: u8) -> i32 {
        let base = match rarity {
            "SSR" => 30,
            "SR" => 25,
            "R" => 20,
            _ => 30,
        };
        base + (uncap as i32) * 5
    }
}
