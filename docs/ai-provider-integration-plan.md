# AI Provider Integration Plan

## Scope

Phase 0-5 autonomous services use `createProviderAdapter` through `autonomousProvider.ts`. Mock mode is deterministic and API mode uses the configured OpenAI-compatible endpoint without persisting secrets.

## Contracts

- Outline generation returns `overallTheme` and chapter records.
- Summary generation returns plot points, characters, foreshadowing and ending state.
- Polish generation returns only revised正文.
- Continuity and expert review return validated JSON with scores and issues.
- Token counts are read from completed AI Task records and accumulated as deltas.

## Verification

Run `npm run test:autonomous`, `npm run build`, and `cargo test --locked`. Real API calls remain opt-in through Settings; E2E mode always uses Mock and blocks external network access.
