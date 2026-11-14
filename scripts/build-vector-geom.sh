#!/usr/bin/env bash
# Rebuilds the Vector tool's shape maths (wasm/vector-geom, Rust) into src/components/vector/geom/vector-geom.wasm.
# The .wasm is committed, so the app builds without this; run it only after changing wasm/vector-geom.
# Needs: rustup target add wasm32-unknown-unknown
set -euo pipefail
cd "$(dirname "$0")/../wasm/vector-geom"
cargo test --release
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/vector_geom.wasm ../../src/components/vector/geom/vector-geom.wasm
echo "Updated src/components/vector/geom/vector-geom.wasm"
