#!/usr/bin/env bash
# Deploy eligibility_registry to Stellar Testnet
set -euo pipefail
cd "$(dirname "$0")/eligibility_registry"
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/eligibility_registry.wasm \
  --source "${DEPLOYER_SECRET:-default}" \
  --network testnet \
  --alias eligibility_registry

echo "Run initialize(admin) after deploy. Record address in README."
