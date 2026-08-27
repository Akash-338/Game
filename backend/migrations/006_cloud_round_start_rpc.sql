-- Server-only atomic round start for staged Supabase gameplay parity.

CREATE OR REPLACE FUNCTION public.word_impostor_start_round(
  p_operation_id TEXT,
  p_room_id TEXT,
  p_round JSONB,
  p_word_choice_key TEXT,
  p_impostor_player_ids JSONB,
  p_event_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing JSONB;
  v_room public.rooms%ROWTYPE;
  v_impostor_ids TEXT[];
  v_active_count INTEGER;
  v_result JSONB;
BEGIN
  SELECT result INTO v_existing
  FROM public.game_operation_results
  WHERE operation_id = p_operation_id;

  IF FOUND THEN
    RETURN v_existing || jsonb_build_object('replayed', TRUE);
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room was not found';
  END IF;
  IF v_room.status <> 'lobby' THEN
    RAISE EXCEPTION 'finish or continue the current round first';
  END IF;
  IF jsonb_typeof(p_impostor_player_ids) <> 'array' THEN
    RAISE EXCEPTION 'impostor player ids must be an array';
  END IF;

  SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
  INTO v_impostor_ids
  FROM jsonb_array_elements_text(p_impostor_player_ids);

  IF cardinality(v_impostor_ids) <> v_room.impostor_count THEN
    RAISE EXCEPTION 'impostor count does not match room settings';
  END IF;
  IF cardinality(v_impostor_ids) <> (SELECT COUNT(DISTINCT id) FROM unnest(v_impostor_ids) AS id) THEN
    RAISE EXCEPTION 'impostor player ids must be unique';
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM public.players
  WHERE room_id = p_room_id AND NOT is_ghost AND NOT is_kicked AND is_ready AND is_connected;
  IF v_active_count < 3 OR v_active_count <= v_room.impostor_count THEN
    RAISE EXCEPTION 'at least three connected ready players are needed';
  END IF;

  IF (SELECT COUNT(*) FROM public.players WHERE room_id = p_room_id AND NOT is_ghost AND NOT is_kicked AND id = ANY(v_impostor_ids)) <> cardinality(v_impostor_ids) THEN
    RAISE EXCEPTION 'impostor selection includes an ineligible player';
  END IF;
  IF EXISTS (SELECT 1 FROM public.used_word_entries WHERE room_id = p_room_id AND word_entry_id = p_word_choice_key) THEN
    RAISE EXCEPTION 'selected word has already been used';
  END IF;

  INSERT INTO public.rounds (
    id, room_id, round_number, word_entry_id, word_pack_id, category, actual_word, impostor_hint,
    impostor_count, show_category_to_impostor, show_hint_to_impostor, started_at
  ) VALUES (
    p_round ->> 'id', p_room_id, (p_round ->> 'roundNumber')::INTEGER,
    p_round ->> 'wordEntryId', p_round ->> 'wordPackId', p_round ->> 'category',
    p_round ->> 'actualWord', p_round ->> 'impostorHint', (p_round ->> 'impostorCount')::INTEGER,
    (p_round ->> 'showCategoryToImpostor')::BOOLEAN, (p_round ->> 'showHintToImpostor')::BOOLEAN,
    (p_round ->> 'startedAt')::BIGINT
  );

  INSERT INTO public.used_word_entries (id, room_id, word_entry_id, round_id, used_at)
  VALUES (
    p_round ->> 'usedWordEntryId', p_room_id, p_word_choice_key, p_round ->> 'id', (p_round ->> 'startedAt')::BIGINT
  );

  UPDATE public.players
  SET role = CASE WHEN id = ANY(v_impostor_ids) THEN 'impostor' ELSE 'civilian' END
  WHERE room_id = p_room_id AND NOT is_ghost AND NOT is_kicked;

  INSERT INTO public.player_scores (id, room_id, player_id)
  SELECT CONCAT('cloud-score-', p_room_id, '-', player.id), p_room_id, player.id
  FROM public.players AS player
  WHERE player.room_id = p_room_id AND NOT player.is_kicked
  ON CONFLICT (room_id, player_id) DO NOTHING;

  UPDATE public.rooms
  SET status = 'playing',
      game_phase = 'clues',
      vote_number = 0,
      runoff_used = FALSE,
      vote_candidates = '[]'::jsonb,
      vote_opened_at = NULL,
      winner = NULL,
      discussion_locked = FALSE,
      current_turn_position = 0,
      selected_word_entry_id = NULL,
      updated_at = (p_round ->> 'startedAt')::BIGINT
  WHERE id = p_room_id;

  INSERT INTO public.game_events (id, room_id, round_id, type, message, meta, created_at)
  VALUES (
    p_event_id,
    p_room_id,
    p_round ->> 'id',
    'round_started',
    'A new secret word round has started with ' || v_active_count || ' active players.',
    jsonb_build_object('impostorPlayerIds', to_jsonb(v_impostor_ids), 'operationId', p_operation_id),
    (p_round ->> 'startedAt')::BIGINT
  );

  v_result := jsonb_build_object('roomId', p_room_id, 'roundId', p_round ->> 'id', 'replayed', FALSE);
  INSERT INTO public.game_operation_results (operation_id, room_id, operation_type, result, created_at)
  VALUES (p_operation_id, p_room_id, 'start_round', v_result, (p_round ->> 'startedAt')::BIGINT);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.word_impostor_start_round(TEXT, TEXT, JSONB, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_start_round(TEXT, TEXT, JSONB, TEXT, JSONB, TEXT) TO service_role;
