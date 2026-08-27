-- Cloud repository foundations for The Word Impostor.
-- These objects remain server-only: browser roles receive no table or function access.

CREATE TABLE IF NOT EXISTS word_pack_entries (
  pack_id TEXT NOT NULL REFERENCES public.word_packs(pack_id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL CHECK (entry_id > 0),
  category TEXT NOT NULL,
  word TEXT NOT NULL,
  impostor_hint TEXT NOT NULL,
  PRIMARY KEY (pack_id, entry_id)
);

CREATE TABLE IF NOT EXISTS game_operation_results (
  operation_id TEXT PRIMARY KEY,
  room_id TEXT REFERENCES public.rooms(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS word_pack_entries_category_idx
  ON public.word_pack_entries(pack_id, category, entry_id);
CREATE INDEX IF NOT EXISTS game_operation_results_room_created_idx
  ON public.game_operation_results(room_id, created_at DESC);

ALTER TABLE public.word_pack_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_operation_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.word_pack_entries FROM anon, authenticated;
REVOKE ALL ON TABLE public.game_operation_results FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.word_pack_entries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.game_operation_results TO service_role;

CREATE OR REPLACE FUNCTION public.word_impostor_seed_pack(
  p_id TEXT,
  p_pack_id TEXT,
  p_name TEXT,
  p_version INTEGER,
  p_file_path TEXT,
  p_uploaded_at BIGINT,
  p_is_default BOOLEAN,
  p_entries JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry JSONB;
  v_result JSONB;
BEGIN
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'word pack entries must be a non-empty JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rounds AS round_record
    JOIN public.rooms AS room_record ON room_record.id = round_record.room_id
    WHERE round_record.word_pack_id = p_pack_id AND room_record.status = 'playing'
  ) THEN
    RAISE EXCEPTION 'cannot reseed a pack used by an active room';
  END IF;

  INSERT INTO public.word_packs (id, pack_id, name, version, file_path, uploaded_at, is_default)
  VALUES (p_id, p_pack_id, p_name, p_version, p_file_path, p_uploaded_at, p_is_default)
  ON CONFLICT (pack_id) DO UPDATE SET
    name = EXCLUDED.name,
    version = EXCLUDED.version,
    file_path = EXCLUDED.file_path,
    uploaded_at = EXCLUDED.uploaded_at,
    is_default = EXCLUDED.is_default;

  DELETE FROM public.word_pack_entries WHERE pack_id = p_pack_id;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO public.word_pack_entries (pack_id, entry_id, category, word, impostor_hint)
    VALUES (
      p_pack_id,
      (v_entry ->> 'id')::INTEGER,
      v_entry ->> 'category',
      v_entry ->> 'word',
      v_entry ->> 'impostorHint'
    );
  END LOOP;

  SELECT jsonb_build_object(
    'packId', p.pack_id,
    'entryCount', COUNT(e.entry_id),
    'isDefault', p.is_default
  )
  INTO v_result
  FROM public.word_packs AS p
  LEFT JOIN public.word_pack_entries AS e ON e.pack_id = p.pack_id
  WHERE p.pack_id = p_pack_id
  GROUP BY p.pack_id, p.is_default;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.word_impostor_create_room(
  p_operation_id TEXT,
  p_room_id TEXT,
  p_room_code TEXT,
  p_password_hash TEXT,
  p_host_user_id TEXT,
  p_host_token TEXT,
  p_created_at BIGINT,
  p_creator_player_id TEXT DEFAULT NULL,
  p_creator_user_id TEXT DEFAULT NULL,
  p_creator_session_token TEXT DEFAULT NULL,
  p_creator_avatar_id TEXT DEFAULT NULL,
  p_creator_avatar_color TEXT DEFAULT NULL,
  p_creator_joined_at BIGINT DEFAULT NULL,
  p_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing JSONB;
  v_result JSONB;
BEGIN
  SELECT result INTO v_existing
  FROM public.game_operation_results
  WHERE operation_id = p_operation_id;

  IF FOUND THEN
    RETURN v_existing || jsonb_build_object('replayed', TRUE);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_room_code, 0));

  IF EXISTS (SELECT 1 FROM public.rooms WHERE room_code = p_room_code) THEN
    RAISE EXCEPTION 'that room id already exists' USING ERRCODE = '23505';
  END IF;

  IF p_creator_player_id IS NOT NULL AND (
    p_creator_user_id IS NULL OR p_creator_session_token IS NULL OR
    p_creator_avatar_id IS NULL OR p_creator_avatar_color IS NULL OR
    p_creator_joined_at IS NULL
  ) THEN
    RAISE EXCEPTION 'creator player details are incomplete';
  END IF;

  INSERT INTO public.rooms (
    id, room_code, password_hash, host_user_id, host_token, created_at, updated_at
  ) VALUES (
    p_room_id, p_room_code, p_password_hash, p_host_user_id, p_host_token, p_created_at, p_created_at
  );

  IF p_creator_player_id IS NOT NULL THEN
    INSERT INTO public.players (
      id, room_id, user_id, session_token, avatar_id, avatar_color, is_ghost, turn_position, joined_at
    ) VALUES (
      p_creator_player_id, p_room_id, p_creator_user_id, p_creator_session_token,
      p_creator_avatar_id, p_creator_avatar_color, FALSE, 0, p_creator_joined_at
    );
  END IF;

  INSERT INTO public.room_word_packs (room_id, pack_id, enabled)
  SELECT p_room_id, pack_id, TRUE
  FROM public.word_packs;

  IF p_event_id IS NOT NULL THEN
    INSERT INTO public.game_events (id, room_id, round_id, type, message, meta, created_at)
    VALUES (
      p_event_id,
      p_room_id,
      NULL,
      'room_created',
      CASE WHEN p_creator_player_id IS NULL THEN 'The host opened the table.' ELSE p_creator_user_id || ' opened the table as host and player.' END,
      jsonb_build_object('operationId', p_operation_id),
      p_created_at
    );
  END IF;

  v_result := jsonb_build_object(
    'roomId', p_room_id,
    'roomCode', p_room_code,
    'hostToken', p_host_token,
    'creatorPlayerId', p_creator_player_id,
    'replayed', FALSE
  );

  INSERT INTO public.game_operation_results (operation_id, room_id, operation_type, result, created_at)
  VALUES (p_operation_id, p_room_id, 'create_room', v_result, p_created_at);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.word_impostor_seed_pack(TEXT, TEXT, TEXT, INTEGER, TEXT, BIGINT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.word_impostor_create_room(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_seed_pack(TEXT, TEXT, TEXT, INTEGER, TEXT, BIGINT, BOOLEAN, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.word_impostor_create_room(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
