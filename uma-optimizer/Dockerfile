# ── Stage 1: cache dependencies ─────────────────────────────────────────────
FROM rust:bookworm AS builder
WORKDIR /app

# Copy manifests first so this layer is only invalidated when deps change
COPY Cargo.toml Cargo.lock ./
ENV SQLX_OFFLINE=true
RUN mkdir src && echo 'fn main() {}' > src/main.rs && \
    cargo build --release && \
    rm -rf src

# ── Stage 2: build real binary ───────────────────────────────────────────────
COPY src ./src
COPY .sqlx ./.sqlx
ENV SQLX_OFFLINE=true
RUN touch src/main.rs && cargo build --release

# ── Stage 3: minimal runtime image ──────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/uma-optimizer /usr/local/bin/uma-optimizer
EXPOSE 3001
CMD ["uma-optimizer"]
