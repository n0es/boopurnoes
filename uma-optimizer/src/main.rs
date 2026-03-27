mod algorithms;
mod api;
mod models;

use axum::{routing::{get, post}, Router};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::EnvFilter;

use api::db;
use api::handlers::{self, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env from parent directory (shared with the Vite app)
    dotenvy::from_filename("../.env.local").ok();
    dotenvy::dotenv().ok();

    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("RUST_LOG")
                .unwrap_or_else(|_| EnvFilter::new("uma_optimizer=info,tower_http=info"))
        )
        .init();

    // Connect to Supabase PostgreSQL
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set (e.g. in ../.env.local)");

    tracing::info!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Load all data into memory
    tracing::info!("Loading support cards...");
    let cards = db::load_support_cards(&pool).await?;

    tracing::info!("Loading trainees...");
    let trainees = db::load_trainees(&pool).await?;

    // Build shared state
    let state = Arc::new(AppState::new(cards, trainees));

    // CORS: allow requests from Vite dev server (local + Tailscale)
    let cors = CorsLayer::new()
        .allow_origin(Any) // permissive for dev; tighten for production
        .allow_methods(Any)
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        .route("/health", get(handlers::health))
        .route("/api/algorithms", get(handlers::list_algorithms))
        .route("/api/trainees", get(handlers::list_trainees))
        .route("/api/cards", get(handlers::list_cards))
        .route("/api/optimize", post(handlers::optimize))
        .route("/api/optimize/stream", post(handlers::optimize_stream))
        .route("/api/optimize/pause", post(handlers::optimize_pause))
        .route("/api/optimize/resume", post(handlers::optimize_resume))
        .route("/api/score", post(handlers::score_deck))
        .route("/api/simulate-turn", post(handlers::simulate_turn))
        .layer(cors)
        .with_state(state);

    let port = std::env::var("OPTIMIZER_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .unwrap_or(3001);

    let addr = format!("0.0.0.0:{port}");
    tracing::info!("Uma Optimizer listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
