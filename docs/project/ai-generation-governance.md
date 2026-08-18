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

The task types in this migration boundary are registered in the
production compilation registry. (`connection_test` and `setting_expand` were
already governed by the earlier compiler rollout.) The current boundary
includes the main chapter-generation path:

- `chapter_generate`
- `chapter_scene_generate`
- `chapter_scene_plan_generate`
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
`chapter_generate` path. The independent `chapter_scene_generate` path is the
first local-model prose slice: it uses a dedicated OpenAI-Compatible provider,
a single user message, a 4096-token context budget, and a 1024-token output
budget. Its Context is kept raw inside the trained full-width-label protocol;
the compiler does not add a source heading to the local user message. It never
falls back to the global external provider when the local service is
unavailable. `chapter_scene_plan_generate` remains an external-provider,
JSON-only candidate task: it can produce a Scene/Beat plan Artifact, but only a
user-confirmed save/apply action writes the engineering state.

The writing-workbench action, chapter-engineering job, and Autonomous candidate
workflow now converge on `Chapter Prose Orchestrator`. When the local route is
enabled it executes the applied ScenePlan serially through a dedicated
single-concurrency queue, passes an immediate state capsule from one Scene to
the next, records each Scene Task/Artifact, and rejects empty output, leaked
thinking, missing required Beat coverage, continuity failures, or internal
prose loops. A chapter must contain 3–5 ordered Beats, each Scene may contain
1–3 Beats, and every Beat is generated by one independent local call with a
500–900 effective-narrative-character envelope.
When the user explicitly starts the same failed chapter again, the job service
may offer the longest contiguous Beat prefix from one earlier failed job. Its
candidates include successful generation steps and completed external repair
Artifacts that the previous semantic validator rejected. Artifact recovery
requires immutable runtime identity, `finish_reason=stop`, the same source job
and frozen context hash, and a current safe-boundary trim; it never treats the
legacy task projection or a truncated response as reusable prose. All reuse
also requires the same local Provider/model route, generation-unit count, Scene
number, and Beat order. The orchestrator reruns the current length,
required-event, repetition, and cross-Scene continuity gates on each candidate
before accepting it; the first invalid or missing unit disables all later
reuse. New step records retain `reusedFromJobId`, and reused units contribute
zero new usage tokens. This is a user-triggered checkpoint resume, not
automatic replay after restart or transport interruption.
Required-Beat coverage is clause-aware: comma/semicolon-delimited event and
end-state clauses must each have ordered prose anchors. Matching two phrases
from an earlier clause cannot make a compound Beat pass while its final action
is absent. A small, explicit set of high-confidence semantic equivalents is
canonicalized before matching (for example, a policy warning that disclosure
would "affect stability" is equivalent to a "stability-maintenance" line, and
checking a tampered interface before the protagonist pushes through the exit is
an alert-and-leave sequence, while writing structured time/location/event facts
is an event-recording action). An opening that establishes the named witness's
home, doorway, or home window also anchors the visit before testimony, so later lexical
mentions cannot push the ordered cursor past an earlier monitoring statement.
Merely seeing that window from the street while explicitly not entering does
not establish a visit.
The generic action matcher also treats concrete structured aggregation such as
"merge into", side-by-side tables, and organizing records into one collection
as the same completed grouping action. Alert coverage must be carried by an
external participant's observable reaction (for example stopping, scrutinizing,
questioning, blocking, or calling after the protagonist); the protagonist's own
looking, noticing, or vigilance cannot satisfy an opponent-alert clause. These
equivalences still preserve clause order and completed-versus-prospective or
negated action status.
The same bounded canonicalization recognizes a patient examination established
by check-in plus electrodes, a memorized pulse period as a frequency capture,
a technician reacting to an auxiliary-channel disturbance as alertness, and a
protagonist pushing through the door as departure.
Preparing a patient cover story on the following day and actually entering the
named clinic is likewise the concrete form of a next-day infiltration decision.
The same decision may be stated as a next-morning plan across two sentences:
going to the named clinic, using a patient complaint as the cover, and intending
to register or enter. A mere plan to pass the clinic without registering or
entering does not satisfy that equivalence.
Once the preceding ordered clauses have already established the named clinic,
archive action, and stability-maintenance policy, the decision may also omit a
redundant clinic name: a future-time plan to go there using a patient identity
and mix inside is the same concrete infiltration decision. A mere visit with no
patient cover or no entry intent remains insufficient.
Canonical concepts required by a clause must all
occur in order in addition to the normal two-anchor minimum; an archive without
the policy signal, an exit without alertness, alertness without departure, or a
mere mention of records without a write/submit action remains incomplete.
When a Scene reaches `finish_reason=length`, or fails another deterministic
acceptance check, the same generation unit receives one complete rewrite with
the failure reason. There is no token-boundary continuation and no third local
attempt; a unit is rejected after the second failed attempt.

After all local units are merged, the external Provider scores the complete
chapter. The quality gate is `score >= 80` with zero pending `critical` or
`high` issues. A failed local-prose candidate may receive one external,
targeted quality-repair pass followed by a fresh score; if it still fails, the
candidate remains available for manual review and is never auto-adopted.
An external Beat repair performed before merge is a bounded rescue for one
malformed local generation unit. It does not consume the persisted source
draft's scored quality-repair round: the latter begins only after the merged
draft and its first quality report exist, and remains limited to one run for
that immutable source draft.
DeepSeek V4 enables high-effort thinking by default. Because this rescue is a
single bounded prose replacement rather than a reasoning task, its governed
contract explicitly uses DeepSeek V4 non-thinking mode and a 4,000-token final
output budget. The toggle is included in the immutable Provider options audit
snapshot; unrelated OpenAI-compatible models do not receive a DeepSeek-only
request field.
The final user instruction repeats the dynamic 500-character minimum, the
per-Beat hard maximum, and the complete required Beat so those constraints are
not left only in lower-priority compiled Context. Repair sampling is capped at
temperature 0.35 (while preserving a stricter user setting) to reduce verbose
setup that can push the required end state past the hard envelope.
The same final instruction requires every ordered event and the Beat end state
to be completed before 65% of the dynamic ceiling, limits setup to 80 effective
characters, and supplies a raw-character ceiling that includes punctuation and
whitespace. This leaves deterministic closing headroom instead of allowing an
otherwise complete alert-and-exit action to land only in a discarded suffix.
The requested repair range is the last 50 effective characters below that
dynamic ceiling through the ceiling itself, with 180 additional raw characters
reserved for punctuation and whitespace; this counteracts conservative model
undercounting while the deterministic hard maximum remains unchanged.
The final compiled user instruction carries that same requested lower bound and
raw-character headroom; it cannot silently fall back to the original Beat
target or the 500-character acceptance floor.
Because some providers still stop early after counting punctuation as prose,
the v5 contract aims at the dynamic effective-character ceiling and supplies an
800-character raw floor plus an exact ten-paragraph prose scaffold. Each
paragraph must contain at least two complete sentences. If the model is unsure
of its count, a normally completed slight overrun is preferred because the
orchestrator can trim at a safe sentence boundary; an under-run cannot be
recovered. The accepted-prefix context already contains the immediate previous
Beat, so it is not injected a second time. These controls improve adherence
without adding a second external repair call; the deterministic 500-effective-
character floor and dynamic maximum remain authoritative.
Completing that end state does not relax the minimum: the repair must then add
only current-Beat action resistance, sensory detail, immediate reaction, or
brief dialogue until the effective-character floor is reached, without moving
into the next Beat.
If that external Beat repair finishes with `finish_reason=stop` but exceeds the
dynamic Beat ceiling, the orchestrator may trim it once at the last complete
sentence or paragraph inside the 500-character minimum and dynamic maximum.
The trimmed text must then pass required-Beat coverage, repetition, and Scene
continuity checks again. A truncated Provider response, a missing safe boundary,
or required content located only in the discarded suffix still fails closed;
this normalization never creates another Provider call.
When prefix trimming and greedy paragraph or sentence removal cannot produce a
valid envelope, the orchestrator performs a bounded ordered-subset search over
complete sentence units and then complete paragraph units. It explores at most
120,000 states, prefers candidates that keep the opening and closing units,
retains source order, and ranks valid candidates by retained narrative length,
unit count, and fewer gaps. Every assembled candidate must independently pass
the completed-action semantic gate before it is returned, and the caller then
re-runs the full length, required-Beat, repetition, and cross-Scene continuity
checks. Exhausting the state budget or finding no valid subset fails closed and
does not trigger another Provider request.
The repair Provider returns only issue-bound `changed_ranges`: every range
contains an exact `before` span and its `after` replacement. The application
reconstructs the candidate deterministically from the immutable source draft;
it ignores any Provider-supplied full rewrite. Missing, ambiguous, duplicate,
unbound, or overlapping replacements fail closed before a candidate draft is
created. The same scope validation and 300-second repair timeout are shared by
the quality panel and the chapter-generation job. A persisted repair run
exhausts the single external-repair allowance for that source draft, including
failed attempts; subsequent work is manual.

The chapter-generation job and the quality panel use one quality-gate workflow.
Once an unadopted source draft and its completed first report exist, a retry
starts from those facts instead of entering Scene/Beat generation again. It
does not create a duplicate source draft or repeat the first score. A completed
`changed_ranges` set persists exact full-source UTF-16 offsets; if the process
stops before the target draft is saved, the application may deterministically
rebuild the same candidate only after source id, version, and content hash all
match. That recovery performs no second repair request. A saved target draft
and after-report are likewise replayed by identity rather than regenerated.

Every valid recheck is persisted even when the score does not improve or the
gate still fails. The target draft remains `is_adopted=0`; scoring or loading a
better candidate must not expire summaries or Context derived from the formal
adopted draft. DeepSeek V4 flash/pro quality-check and quality-fix JSON calls use
non-thinking mode. Quality checking reserves at most 8,192 output tokens;
quality repair dynamically reserves 2,048–7,168 for one to eight issue-bound
replacements (with an 8,192 hard ceiling). These budgets do not change the
local prose model's 1,024-token training contract.

Rewrite and other
non-initial prose tasks continue using the external `chapter_generate` contract.
The rendered request is kept as a frozen `request_context` source so the
compiled contract remains auditable without duplicating business writes.

Other ordinary tasks (for example outline, quality, polish, character/event/
summary, chapter rewrite, and legacy multi-agent calls) still have compatibility
paths that use the historical task recorder. They are intentionally not
described as fully governed yet; each must be migrated with its own artifact
schema and source contract rather than being silently folded into a generic
prompt.

## Verification

The Scene/Beat and governance changes are covered by:

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
