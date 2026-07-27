# Immediate Actions Overview

The v2.12.0 delivery gate is:

- `npm run test:version-sync`
- `npm run test:autonomous`
- `npm test`
- `npm run build`
- `cargo check --locked`
- `cargo test --locked`

The only expected non-failing output is the existing bundle-size warning and unrelated Rust dead-code warnings. API Provider execution is opt-in; E2E remains Mock-only and network-isolated.
