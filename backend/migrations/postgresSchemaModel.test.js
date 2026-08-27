import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(directory, "001_initial_game_schema.sql"), "utf8");
const rlsMigration = fs.readFileSync(path.join(directory, "002_enable_backend_only_rls.sql"), "utf8");
const indexMigration = fs.readFileSync(path.join(directory, "003_add_foreign_key_indexes.sql"), "utf8");
const cloudRepositoryMigration = fs.readFileSync(path.join(directory, "004_cloud_repository_foundations.sql"), "utf8");
const cloudLifecycleMigration = fs.readFileSync(path.join(directory, "005_cloud_player_lifecycle_rpcs.sql"), "utf8");
const cloudRoundMigration = fs.readFileSync(path.join(directory, "006_cloud_round_start_rpc.sql"), "utf8");
const cloudHintMigration = fs.readFileSync(path.join(directory, "007_cloud_hint_submission_rpc.sql"), "utf8");
const cloudVoteMigration = fs.readFileSync(path.join(directory, "008_cloud_vote_cast_rpc.sql"), "utf8");
const cloudTallyMigration = fs.readFileSync(path.join(directory, "009_cloud_vote_tally_rpc.sql"), "utf8");
const cloudContinueMigration = fs.readFileSync(path.join(directory, "010_cloud_continue_round_rpc.sql"), "utf8");
const cloudDirectMessageMigration = fs.readFileSync(path.join(directory, "011_cloud_direct_message_rpc.sql"), "utf8");
const cloudDiscussionMigration = fs.readFileSync(path.join(directory, "012_cloud_discussion_message_rpc.sql"), "utf8");
const cloudLobbyControlsMigration = fs.readFileSync(path.join(directory, "013_cloud_lobby_controls_rpcs.sql"), "utf8");
const cloudPresenceMigration = fs.readFileSync(path.join(directory, "014_cloud_player_presence_rpc.sql"), "utf8");
const cloudHostControlsMigration = fs.readFileSync(path.join(directory, "015_cloud_host_controls_rpcs.sql"), "utf8");
const cloudLeaveMigration = fs.readFileSync(path.join(directory, "016_cloud_player_leave_rpc.sql"), "utf8");
const cloudPackControlsMigration = fs.readFileSync(path.join(directory, "017_cloud_word_pack_controls_rpcs.sql"), "utf8");
const cloudPackDeleteFixMigration = fs.readFileSync(path.join(directory, "018_fix_cloud_word_pack_delete_rpc.sql"), "utf8");
const cloudModerationMigration = fs.readFileSync(path.join(directory, "019_cloud_moderation_and_alerts_rpcs.sql"), "utf8");
const cloudAbstentionFixMigration = fs.readFileSync(path.join(directory, "020_fix_cloud_abstention_vote_stage.sql"), "utf8");
const authoritativeTables = [
  "word_packs", "rooms", "players", "rounds", "hints", "hint_entries",
  "used_word_entries", "room_word_packs", "host_alerts", "votes", "game_events",
  "discussion_messages", "direct_messages", "player_scores", "score_events"
];

describe("PostgreSQL game schema migration", () => {
  test("creates every current authoritative game record idempotently", () => {
    authoritativeTables.forEach((table) => {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    });
  });

  test("preserves critical private-message, voting, score, and word-reuse constraints", () => {
    expect(schema).toContain("UNIQUE(room_id, word_entry_id)");
    expect(schema).toContain("UNIQUE(round_id, vote_stage, voter_player_id)");
    expect(schema).toContain("CHECK (NOT (abstained AND skipped))");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS direct_messages");
    expect(schema).toContain("UNIQUE(room_id, player_id)");
  });

  test("requires backend-only access before any Supabase key is configured", () => {
    authoritativeTables.forEach((table) => {
      expect(rlsMigration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(rlsMigration).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated;`);
    });
  });

  test("covers the Supabase-advised foreign key access paths", () => {
    [
      "direct_messages_room_created_idx", "discussion_messages_player_created_idx", "game_events_round_idx",
      "hint_entries_player_idx", "hints_player_idx", "host_alerts_room_idx", "player_scores_player_idx",
      "room_word_packs_pack_idx", "score_events_round_idx", "used_word_entries_round_idx", "votes_target_idx"
    ].forEach((indexName) => expect(indexMigration).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`));
  });

  test("adds server-only cloud word data, idempotency, and transactional RPC foundations", () => {
    expect(cloudRepositoryMigration).toContain("CREATE TABLE IF NOT EXISTS word_pack_entries");
    expect(cloudRepositoryMigration).toContain("CREATE TABLE IF NOT EXISTS game_operation_results");
    expect(cloudRepositoryMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_seed_pack");
    expect(cloudRepositoryMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_create_room");
    expect(cloudRepositoryMigration).toContain("pg_advisory_xact_lock");
    expect(cloudRepositoryMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_create_room");
    expect(cloudRepositoryMigration).toContain("GRANT EXECUTE ON FUNCTION public.word_impostor_seed_pack");
  });

  test("adds server-only player lifecycle and cascade-cleanup RPCs", () => {
    expect(cloudLifecycleMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_join_or_reclaim_player");
    expect(cloudLifecycleMigration).toContain("FOR UPDATE");
    expect(cloudLifecycleMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_purge_room_session");
    expect(cloudLifecycleMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_join_or_reclaim_player");
  });

  test("adds a locked, idempotent cloud round-start transaction", () => {
    expect(cloudRoundMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_start_round");
    expect(cloudRoundMigration).toContain("FOR UPDATE");
    expect(cloudRoundMigration).toContain("selected word has already been used");
    expect(cloudRoundMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_start_round");
  });

  test("adds locked cloud clue submission with duplicate-clue and phase transition rules", () => {
    expect(cloudHintMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_submit_hint");
    expect(cloudHintMigration).toContain("wait for your turn before submitting a hint");
    expect(cloudHintMigration).toContain("that hint has already been used");
    expect(cloudHintMigration).toContain("game_phase = 'voting'");
  });

  test("adds an idempotent server-only ballot casting RPC", () => {
    expect(cloudVoteMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_cast_vote");
    expect(cloudVoteMigration).toContain("FOR UPDATE");
    expect(cloudVoteMigration).toContain("vote target is not eligible");
    expect(cloudVoteMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_cast_vote");
  });

  test("adds a locked server-only tally, runoff, elimination, and winner transition RPC", () => {
    expect(cloudTallyMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_resolve_vote_tally");
    expect(cloudTallyMigration).toContain("FOR UPDATE");
    expect(cloudTallyMigration).toContain("result','runoff'");
    expect(cloudTallyMigration).toContain("result','finished'");
    expect(cloudTallyMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_resolve_vote_tally");
  });

  test("adds an idempotent continuation transaction that preserves cumulative scores", () => {
    expect(cloudContinueMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_continue_round");
    expect(cloudContinueMigration).toContain("DELETE FROM public.used_word_entries");
    expect(cloudContinueMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_continue_round");
  });

  test("adds a recipient-only direct-message transaction with active-player and cooldown checks", () => {
    expect(cloudDirectMessageMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_send_direct_message");
    expect(cloudDirectMessageMigration).toContain("p_created_at-v_previous < 3000");
    expect(cloudDirectMessageMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_send_direct_message");
  });

  test("adds server-only discussion, readiness, and host-kick controls", () => {
    expect(cloudDiscussionMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_post_discussion_message");
    expect(cloudLobbyControlsMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_set_ready");
    expect(cloudLobbyControlsMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_kick_player");
    expect(cloudLobbyControlsMigration).toContain("public.word_impostor_kick_player(TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated");
  });

  test("adds an idempotent server-only player-presence transaction", () => {
    expect(cloudPresenceMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_set_presence");
    expect(cloudPresenceMigration).toContain("FOR UPDATE");
    expect(cloudPresenceMigration).toContain("game_operation_results");
    expect(cloudPresenceMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_set_presence");
  });

  test("drafts locked idempotent host controls for review before external application", () => {
    ["word_impostor_update_lobby_settings", "word_impostor_reorder_players", "word_impostor_next_turn", "word_impostor_set_discussion_locked", "word_impostor_reveal_roles"].forEach((functionName) => expect(cloudHostControlsMigration).toContain(`CREATE OR REPLACE FUNCTION public.${functionName}`));
    expect(cloudHostControlsMigration).toContain("FOR UPDATE");
    expect(cloudHostControlsMigration).toContain("game_operation_results");
    expect(cloudHostControlsMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_update_lobby_settings");
  });

  test("drafts a server-only voluntary player-leave transaction with lock, parity, and replay guards", () => {
    expect(cloudLeaveMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_leave_player");
    expect(cloudLeaveMigration).toContain("FOR UPDATE");
    expect(cloudLeaveMigration).toContain("v_impostors>=v_civilians");
    expect(cloudLeaveMigration).toContain("game_operation_results");
    expect(cloudLeaveMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_leave_player");
  });

  test("drafts server-only word-pack upload, enablement, and deletion controls", () => {
    ["word_impostor_upload_word_pack", "word_impostor_set_word_pack_enabled", "word_impostor_delete_word_pack"].forEach((functionName) => expect(cloudPackControlsMigration).toContain(`CREATE OR REPLACE FUNCTION public.${functionName}`));
    expect(cloudPackControlsMigration).toContain("FOR UPDATE");
    expect(cloudPackControlsMigration).toContain("game_operation_results");
    expect(cloudPackControlsMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_upload_word_pack");
  });

  test("drafts a foreign-key-safe server-only custom pack deletion correction", () => {
    expect(cloudPackDeleteFixMigration).toContain("CREATE OR REPLACE FUNCTION public.word_impostor_delete_word_pack");
    expect(cloudPackDeleteFixMigration).toContain("DELETE FROM public.room_word_packs WHERE pack_id=p_pack_id");
    expect(cloudPackDeleteFixMigration).toContain("DELETE FROM public.word_packs WHERE pack_id=p_pack_id");
    expect(cloudPackDeleteFixMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_delete_word_pack");
  });

  test("drafts locked server-only moderation, alert, score, and disconnected-voter controls", () => {
    ["word_impostor_abstain_disconnected_voter", "word_impostor_edit_hint", "word_impostor_remove_discussion_message", "word_impostor_mark_memorable_clue", "word_impostor_create_alert"].forEach((functionName) => expect(cloudModerationMigration).toContain(`CREATE OR REPLACE FUNCTION public.${functionName}`));
    expect(cloudModerationMigration).toContain("FOR UPDATE");
    expect(cloudModerationMigration).toContain("game_operation_results");
    expect(cloudModerationMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_abstain_disconnected_voter");
  });

  test("corrects cloud offline-abstention vote stages to match ballot and tally stages", () => {
    expect(cloudAbstentionFixMigration).toContain("v_stage:=v_room.vote_number*10+CASE WHEN v_room.game_phase='runoff' THEN 1 ELSE 0 END");
    expect(cloudAbstentionFixMigration).toContain("vote_stage=v_stage");
    expect(cloudAbstentionFixMigration).toContain("REVOKE ALL ON FUNCTION public.word_impostor_abstain_disconnected_voter");
  });
});
