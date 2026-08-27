-- Word Impostor authoritative game schema for PostgreSQL / Supabase.
-- This migration is intentionally NOT applied by local development. Timestamp values
-- remain epoch milliseconds (BIGINT) to match the existing JavaScript game service.

CREATE TABLE IF NOT EXISTS word_packs (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_at BIGINT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  host_user_id TEXT NOT NULL,
  host_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'lobby',
  impostor_count INTEGER NOT NULL DEFAULT 1,
  show_category_to_impostor BOOLEAN NOT NULL DEFAULT TRUE,
  show_hint_to_impostor BOOLEAN NOT NULL DEFAULT TRUE,
  selected_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_word_entry_id TEXT,
  current_turn_position INTEGER NOT NULL DEFAULT -1,
  sound_muted BOOLEAN NOT NULL DEFAULT FALSE,
  game_phase TEXT NOT NULL DEFAULT 'lobby',
  clue_cycle_limit INTEGER NOT NULL DEFAULT 2,
  vote_number INTEGER NOT NULL DEFAULT 0,
  runoff_used BOOLEAN NOT NULL DEFAULT FALSE,
  vote_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  vote_opened_at BIGINT,
  winner TEXT,
  discussion_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  avatar_id TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'civilian',
  is_ghost BOOLEAN NOT NULL DEFAULT FALSE,
  is_ready BOOLEAN NOT NULL DEFAULT FALSE,
  is_connected BOOLEAN NOT NULL DEFAULT FALSE,
  is_kicked BOOLEAN NOT NULL DEFAULT FALSE,
  turn_position INTEGER NOT NULL DEFAULT 0,
  joined_at BIGINT NOT NULL,
  left_at BIGINT,
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  word_entry_id TEXT NOT NULL,
  word_pack_id TEXT NOT NULL,
  category TEXT NOT NULL,
  actual_word TEXT NOT NULL,
  impostor_hint TEXT NOT NULL,
  impostor_count INTEGER NOT NULL,
  show_category_to_impostor BOOLEAN NOT NULL,
  show_hint_to_impostor BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'playing',
  started_at BIGINT NOT NULL,
  revealed_at BIGINT,
  finished_at BIGINT
);

CREATE TABLE IF NOT EXISTS hints (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  edited_at BIGINT,
  edited_by_host BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(round_id, player_id)
);

CREATE TABLE IF NOT EXISTS hint_entries (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  edited_at BIGINT,
  edited_by_host BOOLEAN NOT NULL DEFAULT FALSE,
  memorable BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(round_id, player_id, cycle_number)
);

CREATE TABLE IF NOT EXISTS used_word_entries (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  word_entry_id TEXT NOT NULL,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  used_at BIGINT NOT NULL,
  UNIQUE(room_id, word_entry_id)
);

CREATE TABLE IF NOT EXISTS room_word_packs (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES word_packs(pack_id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(room_id, pack_id)
);

CREATE TABLE IF NOT EXISTS host_alerts (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_id TEXT,
  message TEXT NOT NULL,
  target_player_id TEXT,
  type TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  vote_stage INTEGER NOT NULL,
  voter_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  abstained BOOLEAN NOT NULL DEFAULT FALSE,
  skipped BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  UNIQUE(round_id, vote_stage, voter_player_id),
  CHECK (NOT (abstained AND skipped))
);

CREATE TABLE IF NOT EXISTS game_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

-- Retained for historical room records during the discussion-to-private-message transition.
CREATE TABLE IF NOT EXISTS discussion_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  deleted_at BIGINT,
  deleted_by_host BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipient_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  deleted_at BIGINT
);

CREATE TABLE IF NOT EXISTS player_scores (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  correct_votes INTEGER NOT NULL DEFAULT 0,
  impostor_tally_survivals INTEGER NOT NULL DEFAULT 0,
  votes_received INTEGER NOT NULL DEFAULT 0,
  last_votes_received INTEGER NOT NULL DEFAULT 0,
  memorable_clue_awards INTEGER NOT NULL DEFAULT 0,
  UNIQUE(room_id, player_id)
);

CREATE TABLE IF NOT EXISTS score_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS players_room_active_idx ON players(room_id, is_ghost, is_kicked, turn_position);
CREATE INDEX IF NOT EXISTS rounds_room_number_idx ON rounds(room_id, round_number DESC);
CREATE INDEX IF NOT EXISTS hint_entries_round_cycle_idx ON hint_entries(round_id, cycle_number, created_at);
CREATE INDEX IF NOT EXISTS votes_round_stage_idx ON votes(round_id, vote_stage);
CREATE INDEX IF NOT EXISTS game_events_room_created_idx ON game_events(room_id, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_sender_created_idx ON direct_messages(sender_player_id, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_recipient_created_idx ON direct_messages(recipient_player_id, created_at);
CREATE INDEX IF NOT EXISTS score_events_player_created_idx ON score_events(player_id, created_at);
