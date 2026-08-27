-- Server-only atomic clue submission and phase transition for staged Supabase gameplay parity.

CREATE OR REPLACE FUNCTION public.word_impostor_submit_hint(
  p_operation_id TEXT,
  p_room_id TEXT,
  p_session_token TEXT,
  p_hint_id TEXT,
  p_content TEXT,
  p_created_at BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing JSONB;
  v_room public.rooms%ROWTYPE;
  v_round public.rounds%ROWTYPE;
  v_player public.players%ROWTYPE;
  v_expected_player_id TEXT;
  v_active_count INTEGER;
  v_cycle_number INTEGER;
  v_cycle_submitted INTEGER;
  v_required_cycles INTEGER;
  v_next_player_id TEXT;
  v_vote_candidates JSONB;
  v_result JSONB;
BEGIN
  SELECT result INTO v_existing
  FROM public.game_operation_results
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    RETURN v_existing || jsonb_build_object('replayed', TRUE);
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'room was not found'; END IF;
  IF v_room.status <> 'playing' OR v_room.game_phase <> 'clues' THEN
    RAISE EXCEPTION 'hints are not available while voting or after the game ends';
  END IF;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE room_id = p_room_id
  ORDER BY round_number DESC
  LIMIT 1;
  IF NOT FOUND OR v_round.status <> 'playing' THEN RAISE EXCEPTION 'there is no active round'; END IF;

  SELECT * INTO v_player
  FROM public.players
  WHERE room_id = p_room_id AND session_token = p_session_token AND NOT is_kicked;
  IF NOT FOUND OR v_player.is_ghost THEN RAISE EXCEPTION 'ghosts cannot submit hints'; END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM public.players
  WHERE room_id = p_room_id AND NOT is_ghost AND NOT is_kicked;
  IF v_active_count = 0 THEN RAISE EXCEPTION 'no active players remain'; END IF;

  SELECT id INTO v_expected_player_id
  FROM public.players
  WHERE room_id = p_room_id AND NOT is_ghost AND NOT is_kicked
  ORDER BY turn_position, joined_at
  OFFSET v_room.current_turn_position
  LIMIT 1;
  IF v_expected_player_id IS DISTINCT FROM v_player.id THEN RAISE EXCEPTION 'wait for your turn before submitting a hint'; END IF;

  p_content := regexp_replace(trim(p_content), '\s+', ' ', 'g');
  IF p_content = '' OR char_length(p_content) > 80 THEN RAISE EXCEPTION 'hints must be 1-80 characters'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.hint_entries AS hint
    JOIN public.rounds AS past_round ON past_round.id = hint.round_id
    WHERE past_round.room_id = p_room_id
      AND lower(regexp_replace(trim(hint.content), '\s+', ' ', 'g')) = lower(p_content)
  ) THEN
    RAISE EXCEPTION 'that hint has already been used';
  END IF;

  SELECT COALESCE(MAX(cycle_number), 0) INTO v_cycle_number
  FROM public.hint_entries WHERE round_id = v_round.id;
  IF v_cycle_number = 0 THEN
    v_cycle_number := 1;
  ELSE
    SELECT COUNT(*) INTO v_cycle_submitted
    FROM public.hint_entries
    WHERE round_id = v_round.id AND cycle_number = v_cycle_number;
    IF v_cycle_submitted >= v_active_count THEN v_cycle_number := v_cycle_number + 1; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hint_entries
    WHERE round_id = v_round.id AND player_id = v_player.id AND cycle_number = v_cycle_number
  ) THEN RAISE EXCEPTION 'you have already submitted in this hint round'; END IF;

  INSERT INTO public.hint_entries (id, round_id, player_id, cycle_number, content, created_at)
  VALUES (p_hint_id, v_round.id, v_player.id, v_cycle_number, p_content, p_created_at);

  UPDATE public.rooms
  SET current_turn_position = (current_turn_position + 1) % v_active_count,
      updated_at = p_created_at
  WHERE id = p_room_id
  RETURNING * INTO v_room;

  SELECT COUNT(*) INTO v_cycle_submitted
  FROM public.hint_entries
  WHERE round_id = v_round.id AND cycle_number = v_cycle_number;
  v_required_cycles := CASE WHEN v_room.vote_number = 0 THEN v_room.clue_cycle_limit ELSE 1 END;

  IF v_cycle_submitted >= v_active_count AND v_cycle_number >= v_required_cycles THEN
    SELECT COALESCE(jsonb_agg(id ORDER BY turn_position, joined_at), '[]'::jsonb) INTO v_vote_candidates
    FROM public.players
    WHERE room_id = p_room_id AND NOT is_ghost AND NOT is_kicked;
    UPDATE public.rooms
    SET game_phase = 'voting',
        vote_number = vote_number + 1,
        runoff_used = FALSE,
        vote_candidates = v_vote_candidates,
        vote_opened_at = p_created_at,
        current_turn_position = -1,
        updated_at = p_created_at
    WHERE id = p_room_id
    RETURNING * INTO v_room;
    INSERT INTO public.game_events (id, room_id, round_id, type, message, meta, created_at)
    VALUES (
      CONCAT('cloud-event-', p_operation_id), p_room_id, v_round.id, 'voting_opened',
      'Clue cycle complete. Live public vote ' || v_room.vote_number || ' is now open.',
      jsonb_build_object('candidates', v_vote_candidates, 'operationId', p_operation_id), p_created_at
    );
    v_result := jsonb_build_object('roomId', p_room_id, 'cycleNumber', v_cycle_number, 'voteOpened', TRUE, 'voteNumber', v_room.vote_number, 'replayed', FALSE);
  ELSE
    SELECT id INTO v_next_player_id
    FROM public.players
    WHERE room_id = p_room_id AND NOT is_ghost AND NOT is_kicked
    ORDER BY turn_position, joined_at
    OFFSET v_room.current_turn_position
    LIMIT 1;
    IF v_cycle_submitted >= v_active_count THEN
      INSERT INTO public.game_events (id, room_id, round_id, type, message, meta, created_at)
      VALUES (CONCAT('cloud-event-', p_operation_id), p_room_id, v_round.id, 'clue_cycle_complete', 'Clue cycle ' || v_cycle_number || ' is complete.', jsonb_build_object('operationId', p_operation_id), p_created_at);
    END IF;
    v_result := jsonb_build_object('roomId', p_room_id, 'cycleNumber', v_cycle_number, 'voteOpened', FALSE, 'nextPlayerId', v_next_player_id, 'replayed', FALSE);
  END IF;

  INSERT INTO public.game_operation_results (operation_id, room_id, operation_type, result, created_at)
  VALUES (p_operation_id, p_room_id, 'submit_hint', v_result, p_created_at);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.word_impostor_submit_hint(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_submit_hint(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO service_role;
