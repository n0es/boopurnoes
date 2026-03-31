use sqlx::postgres::PgPool;
use std::collections::HashMap;

use crate::models::{SupportCard, SupportCardEffect, EffectType, Trainee};

/// Load all support cards with their effects from Supabase PostgreSQL.
pub async fn load_support_cards(pool: &PgPool) -> Result<Vec<SupportCard>, sqlx::Error> {
    // Load all cards
    let card_rows: Vec<CardRow> = sqlx::query_as!(
        CardRow,
        r#"
        SELECT id, name, rarity, card_type
        FROM support_cards
        ORDER BY id
        "#
    )
    .fetch_all(pool)
    .await?;

    // Load all effects
    let effect_rows = sqlx::query_as!(
        EffectRow,
        r#"
        SELECT card_id, effect_type_id, effect_name, unlock_level, values_by_level
        FROM support_card_effects
        ORDER BY card_id, effect_type_id
        "#
    )
    .fetch_all(pool)
    .await?;

    // Group effects by card_id
    let mut effects_by_card: HashMap<i64, Vec<SupportCardEffect>> = HashMap::new();
    for row in effect_rows {
        if let Some(effect_type) = row.effect_type_id.and_then(EffectType::from_id) {
            let effect = SupportCardEffect {
                effect_type,
                effect_name: row.effect_name.unwrap_or_default(),
                unlock_level: row.unlock_level.unwrap_or(0),
                values_by_level: row.values_by_level.unwrap_or_default(),
            };
            effects_by_card
                .entry(row.card_id)
                .or_default()
                .push(effect);
        }
    }

    // Assemble cards
    let cards: Vec<SupportCard> = card_rows
        .into_iter()
        .map(|row| {
            let effects = effects_by_card
                .remove(&row.id)
                .unwrap_or_default();
            SupportCard {
                id: row.id as i32,
                name: row.name,
                rarity: row.rarity,
                card_type: row.card_type.unwrap_or_default(),
                effects,
            }
        })
        .collect();

    tracing::info!("Loaded {} support cards", cards.len());
    Ok(cards)
}

/// Load all trainees from Supabase PostgreSQL.
pub async fn load_trainees(pool: &PgPool) -> Result<Vec<Trainee>, sqlx::Error> {
    let rows: Vec<Trainee> = sqlx::query_as!(
        Trainee,
        r#"
        SELECT
            id,
            name,
            name_jp,
            title,
            rarity as "rarity!: i16",
            apt_turf, apt_dirt,
            apt_short, apt_mile, apt_mid, apt_long,
            apt_leading, apt_stalking, apt_mid_pack, apt_chasing,
            stats_base as "stats_base: sqlx::types::Json<Vec<i16>>",
            stats_two_star as "stats_two_star: sqlx::types::Json<Vec<i16>>",
            stats_three_star as "stats_three_star: sqlx::types::Json<Vec<i16>>",
            stats_four_star as "stats_four_star: sqlx::types::Json<Vec<i16>>",
            stats_five_star as "stats_five_star: sqlx::types::Json<Vec<i16>>",
            stat_growth as "stat_growth: sqlx::types::Json<Vec<i16>>"
        FROM trainees
        ORDER BY id
        "#
    )
    .fetch_all(pool)
    .await?;

    tracing::info!("Loaded {} trainees", rows.len());
    Ok(rows)
}

// ─── Internal row types for sqlx ────────────────────────────────────────────

struct CardRow {
    id: i64,
    name: String,
    rarity: String,
    card_type: Option<String>,
}

struct EffectRow {
    card_id: i64,
    effect_type_id: Option<i32>,
    effect_name: Option<String>,
    unlock_level: Option<i32>,
    values_by_level: Option<Vec<i32>>,
}
