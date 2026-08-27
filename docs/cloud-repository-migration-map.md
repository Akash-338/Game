# Cloud Repository Migration Map

## Purpose

This document maps the current synchronous SQLite authority in `server/game/service.js` to a staged repository architecture for Supabase. It is a migration design record, not an activation guide. **SQLite remains the only active game store** until every state-changing cloud operation has transactional parity coverage.

## Constraints That Shape the Design

The existing service reads and writes through Node’s synchronous SQLite API. Supabase’s server Data API is asynchronous, so a direct one-for-one replacement of `db.prepare()` is not safe or practical. The service must therefore move gradually to an explicit asynchronous repository contract, and every multi-table state change must execute in a PostgreSQL RPC transaction rather than as a sequence of independent Data API calls.

The game stores secret roles, private messages, password hashes, host tokens, and session tokens. Repository methods are server-only. Browser clients continue to receive only the existing audience-filtered snapshots; neither Supabase credentials nor raw rows may cross the Socket.IO boundary.

## Current SQLite Responsibility Map

| Domain | Current service operations | Read/write characteristics | Cloud migration requirement |
| --- | --- | --- | --- |
| Word packs | `registerPack`, `bootstrapPacks`, `listPacks`, `entriesForPacks`, pack enable/delete/upload | Local JSON files plus `word_packs` and `room_word_packs` records | Seed the six built-in category packs as DB records; retain server-side custom-pack storage policy before enabling uploads in cloud mode. |
| Room identity | `createRoom`, `recoverHostRoom`, host/player session lookup | Room, creator player, enabled packs, event created atomically | One RPC with room-code uniqueness handling and creator-seat creation. |
| Player lifecycle | `joinRoom`, `setReady`, `setPresence`, `leaveRoom`, `reorderPlayers`, `kickPlayer` | Roster changes can alter clue/vote completion and winner state | Lock the room row in every conflicting lifecycle RPC and make reconnect/rejoin idempotent. |
| Read snapshots | `snapshot`, player/round/event/score/message helper queries | Audience-filtered aggregate read | Add a server-only aggregate read method that fetches scoped data without role or direct-message leakage. |
| Round start | `availableWords`, `chooseRandomWord`, `startRound` | Selects a word, writes round and used-word record, assigns roles, initializes scores and phase | One transactional RPC with room lock, no-repeat constraint, deterministic input IDs, and an idempotency key. |
| Clue flow | `submitHint`, `editHint`, `nextTurn`, `resumeClues` | Checks turn, uniqueness, cycle completion, then may open vote | One RPC for submit-and-advance that serializes the room and returns the resulting phase. |
| Voting | `openVoteStage`, `submitVote`, `submitSkipVote`, `abstainDisconnectedVoter`, `applyVoteTally` | Concurrent submissions and scoring/elimination/winner transitions | RPCs must use unique ballot constraints plus room-row locking; the tally must run once and be idempotent. |
| Results and continuation | `finishGame`, `revealRoles`, `continueRound`, memorable-clue scoring | Modifies room, round, players, used words, scores, and event ledger | Transactional RPCs with explicit state preconditions and response state version. |
| Private messaging | `postDirectMessage`, `directMessageRows` | Recipient-only visibility and sender cooldown | Server-side query constrained by sender/recipient; no bulk room message query in player snapshots. |
| Cleanup | `restartSession`, `endRoom`, `purgeRoomSession`, unfinished-room purge | Deletes an entire related session graph | Single delete by room ID through foreign-key cascade or a dedicated RPC; verify all dependent rows are removed. |

## Required Repository Layers

| Layer | Responsibility | Activation state |
| --- | --- | --- |
| `sqliteGameRepository` | Encapsulates existing SQLite queries and transactions behind repository methods without behavior changes. | First implementation target. |
| `supabaseGameRepository` | Uses the Supabase server client for reads and reviewed database RPCs for atomic writes. | Building block currently exposes health only. |
| `gameRepositoryFactory` | Selects SQLite by default and rejects cloud selection until configuration and parity guards pass. | Must remain fail-closed. |
| `service.js` | Holds rules, validation, privacy projections, random selection, and Socket.IO-facing results; invokes repository methods rather than SQL. | Refactor only in behavior-preserving slices. |

## Transactional RPC Groups

The following operations cannot be implemented as independent REST/Data API requests because an interleaving request could create duplicate actions, stale turns, or incorrect win results.

| RPC family | Atomic work |
| --- | --- |
| `create_room_with_creator` | Create room, optional creator-player seat, enable all packs, append room-created event. |
| `join_or_reclaim_player` | Validate room state, reserve/reclaim identity, update session state, choose avatar, and advance roster version. |
| `start_round` | Lock room, validate lobby and readiness, reserve unused word, create round, assign roles, initialize scores, set playing phase, append event. |
| `submit_hint_and_advance` | Lock room, verify actor/turn/cycle/uniqueness, create clue, advance turn, and open voting when the cycle gate is satisfied. |
| `cast_vote_and_maybe_resolve` | Lock room, enforce one ballot and eligible target, append event, and either return waiting or resolve one tally. |
| `resolve_vote_tally` | Update vote metrics, execute runoff/eliminations, award scores, append public result, evaluate win, and move to next phase exactly once. |
| `continue_after_reveal` | Restore eligible Ghosts, reset round lobby state, clear used words under the approved policy, preserve score ledger, append event. |
| `purge_room_session` | Delete all room-owned rows and the room in a transaction, relying on documented cascading foreign keys. |

## Concurrency and Idempotency Rules

Every state-changing repository method accepts an `operationId` generated once per Socket.IO request. The database records or derives idempotent results from the unique constraints already present for room code, player identity, hint cycle, word use, and ballot stage. RPCs lock the target `rooms` row with `FOR UPDATE` before inspecting state. A response includes the current room update timestamp or a monotonic room version added in a reviewed migration before cloud mode.

Duplicate submits must return the original accepted result instead of applying an action twice. Conflicts that observe an already-advanced phase must return the current authoritative state. The Socket.IO server broadcasts only after a successful committed repository result.

## Migration Sequence

1. Encapsulate SQLite reads and writes behind a repository contract with unchanged test outcomes.
2. Seed all six built-in category packs into the secured Supabase database and verify their metadata and entries.
3. Add reviewed PostgreSQL migrations for a room version, idempotency records, and transactional RPC functions.
4. Refactor one bounded service flow at a time, beginning with room and player lifecycle, then round start, clues, voting, results, private messaging, and cleanup.
5. Run isolated cloud parity tests that create and purge their own rooms. Do not use production gameplay rooms as test fixtures.
6. Enable cloud mode only in a non-production realtime instance after every full flow passes and no browser-visible response exposes secrets.

## Explicit Non-Goals for This Stage

This inventory does not enable `WORD_IMPOSTOR_CLOUD_MODE` or `WORD_IMPOSTOR_REDIS_ADAPTER_ENABLED`; it does not alter the existing local SQLite game; and it does not deploy a Vercel frontend or external Socket.IO backend.
