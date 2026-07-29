# AI Generation Governance

## Decision

Autonomous creation uses one governed execution boundary:

```text
autonomous provider
  -> executeAiTask
  -> production compilation registry
  -> context / constraint snapshots
  -> provider adapter
  -> result artifact
```

The seven task types in this migration boundary are registered in the
production compilation registry. (`connection_test` and `setting_expand` were
already governed by the earlier compiler rollout.) The current boundary
includes the main chapter-generation path:

- `chapter_generate`
- `autonomous_plot_plan`
- `autonomous_character_evolution`
- `autonomous_world_build`
- `autonomous_conflict_generate`
- `autonomous_pacing_control`
- `autonomous_chapter_batch`

Calling `createAiClient().generate()` with one of these task types now fails
closed. This prevents governed work from silently bypassing compilation, budget
checks, cancellation, provider metadata, and the Tauri task runtime.

## Scope Terminology

Two governance layers are intentionally distinguished:

- **Transport/request governance** covers every production AI entry point. The
  shared client enforces rate and concurrency limits, daily token/cost budgets,
  request identity, signal propagation, process-local cancellation ownership,
  late-response isolation, usage capture, and frozen-price cost estimation. In
  the desktop runtime, migration 029 makes the policy, rolling window, active
  reservations, and daily usage authoritative SQLite facts shared by every
  process. Browser development keeps the existing LocalStorage ledger as an
  explicit non-desktop fallback.
  `test:ai-request-governance` parses every production TS/TSX source with the
  TypeScript AST and fails when `client.generate` or
  `createAiClient(...).generate` omits its explicit `AiGenerateOptions` argument;
  an empty scan also fails closed so moving or renaming the boundary cannot
  silently disable the gate.
- **Compiled execution governance** additionally requires `executeAiTask`, a
  production compilation definition, immutable snapshots, a candidate Artifact,
  and Tauri runtime facts. This stricter layer currently covers the task types
  listed above plus the previously migrated `connection_test` and
  `setting_expand` tasks.

Therefore, a task described below as a compatibility path still uses the P0
transport/request controls. It is not yet represented by the stricter compiled
contract and Artifact protocol. Documentation and release reports must preserve
this distinction rather than describing the current compiler registry as an
all-task migration.

The registry keeps the full autonomous request payload in `taskInput` and puts
only a small, non-sensitive request summary in `request_context`. The payload is
therefore included in the compiled request hash without being duplicated in
logs or source-specific context records.

## Global Desktop Request Policy

Migration `029_global_ai_request_policy` introduces three non-project tables:

```text
ai_request_policy          singleton revisioned global limits and frozen prices
ai_request_daily_usage     local-day actual/conservative usage aggregates
ai_request_reservations    owner, request identity, hashed lease, TTL and settlement
```

The settings page updates the singleton policy with revision compare-and-swap.
Snapshots are policy-read-only: an absent policy remains absent until an
explicit settings save or the first governed request initializes it from
normalized settings. On settings-page load, an existing policy hydrates the
governance/pricing form and the WebView pins that first observed revision
(including an observed absence) until a successful save, so later snapshots
cannot silently refresh away a stale form baseline. Reservation decisions read
the SQLite policy rather than trusting per-WebView limits. A stale process
therefore cannot widen concurrency, rate, token, or cost limits by submitting
looser local values.

Every desktop provider call follows this order:

```text
BEGIN IMMEDIATE
  reclaim expired reservations conservatively
  check the global rolling minute and active count
  check used + active reservations + new conservative token/cost estimate
  insert owner/request-bound reservation with a hashed lease token
COMMIT
→ Rust Provider command verifies the lease and marks one dispatch
→ Provider response or error
→ BEGIN IMMEDIATE: idempotent settlement and daily aggregate update
```

Input reservation uses UTF-8 bytes plus fixed and per-message chat envelopes;
output reservation uses the configured Provider maximum. This avoids the former
character-ratio underestimate for CJK, emoji and byte-heavy content. Actual
usage is always fully accounted even if it exceeds the reservation, and the next
request observes that overage.

The raw lease token remains in the WebView only. SQLite stores its SHA-256, and
the Rust Provider commands require the reservation id, owner, provider request
id, and raw proof before any network dispatch. The provider request id is unique
and a reservation can be marked dispatched only once, so direct IPC calls and
proof replay fail closed.

Reported usage settles actual input/output tokens against the price pair frozen
by the authoritative policy. Successful responses without usage, Provider
failures/cancellation, and owner TTL expiry conservatively account the original
worst-case reservation. Unpriced usage remains explicit through a separate
counter and nullable accounted cost; it is never represented as a confirmed
zero-cost request. Hard-budget arithmetic uses integer 1e-8 USD units;
reservations round upward and budgets downward, so floating-point accumulation
cannot widen the configured limit. Identical settlement replay is stable, while a different
payload, owner, or token returns a lease conflict. Database triggers also make
dispatch single-use and freeze every terminal accounting field against direct
SQL mutation.

## Continuation Protocol

Autonomous planning has two modes:

- `greenfield`: create a new structure; applying it to a novel that already has
  volumes or chapters is rejected.
- `continuation`: append to a captured work baseline; existing rows are never
  updated or re-created.

Before planning, the application captures a baseline containing existing
volumes, chapters, active characters, and active world settings. The baseline
hash covers the ordered structural payload and excludes `capturedAt`, so a
timestamp change does not invalidate a plan. The full baseline remains on the
plan for idempotency and apply-time verification; only a bounded tail is sent to
creative agents as continuity context.

Continuation targets are final chapter numbers. If the baseline ends at chapter
40 and the user enters 80, the generated plan contains chapters 41 through 80,
not 80 additional chapters. Arcs, volume ranges, character beats, world first
appearance, conflicts, pacing, and chapter references are offset by the
baseline's last chapter number before the plan is saved.

Volumes declare materialization explicitly:

- `create`: insert a new volume after the highest existing order index.
- `existing`: reference an existing volume without inserting or updating it.

The UI defaults to `create_new_volume` and also supports
`append_to_last_volume`. The latter maps the first generated volume to the last
existing volume while preserving that volume's id and order index; later volumes
continue with new order indexes.

Applying a continuation plan is compare-and-swap guarded. Rust and browser
fallback persistence both re-read the live baseline and reject the apply when
its hash changed. They also verify existing volume positions, new volume order,
chapter ids, chapter numbers, and volume references before any write. This
protects edits made after planning and makes retries/replays count only newly
materialized volumes.

The plan schema remains version 1. Continuation fields are optional extensions,
so existing greenfield plans and migration 024 data remain readable without a
database migration.

## Migration Boundary

This change closes the autonomous creation bypass and migrates the main
`chapter_generate` path. Both the generation job and the writing-workbench
action now call `executeChapterGeneration`, retaining their existing streaming,
cancel, and draft-adoption behavior while producing a governed candidate
artifact. The rendered request is kept as a frozen `request_context` source so
the compiled contract remains auditable without duplicating business writes.

Other ordinary tasks (for example outline, quality, polish, character/event/
summary, chapter rewrite, and legacy multi-agent calls) still have compatibility
paths that use the historical task recorder. They are intentionally not
described as fully governed yet; each must be migrated with its own artifact
schema and source contract rather than being silently folded into a generic
prompt.

## Verification

The continuation and governance changes are covered by:

- TypeScript type-check and Vite production build.
- Autonomous service tests for chapter offsets, resume hash stability, and
  append-to-last-volume numbering.
- Browser persistence tests for baseline drift and replay counts.
- Rust tests for baseline hash stability, target conflict protection, atomic
  apply, and replay validation.
- Production compilation and AI execution pipeline tests.
- Main chapter generation tests, including the governed browser execution path
  and stream event propagation.
- Static transport governance fixtures plus a live production-source scan that
  rejects omitted, `undefined`, or `null` request options.
