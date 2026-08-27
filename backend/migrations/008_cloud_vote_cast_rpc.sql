-- Server-only, idempotent ballot casting. Tally resolution is a separate locked operation.
CREATE OR REPLACE FUNCTION public.word_impostor_cast_vote(
  p_operation_id TEXT, p_room_id TEXT, p_session_token TEXT, p_vote_id TEXT,
  p_target_player_id TEXT, p_skipped BOOLEAN, p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing JSONB; v_room public.rooms%ROWTYPE; v_round public.rounds%ROWTYPE;
  v_voter public.players%ROWTYPE; v_eligible INTEGER; v_cast INTEGER; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id = p_operation_id;
  IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed', TRUE); END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' OR v_room.game_phase NOT IN ('voting', 'runoff') THEN RAISE EXCEPTION 'voting is not open'; END IF;
  SELECT * INTO v_round FROM public.rounds WHERE room_id = p_room_id ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'there is no active round'; END IF;
  SELECT * INTO v_voter FROM public.players WHERE room_id = p_room_id AND session_token = p_session_token AND NOT is_kicked;
  IF NOT FOUND OR v_voter.is_ghost THEN RAISE EXCEPTION 'only active players may vote'; END IF;
  IF p_skipped AND p_target_player_id IS NOT NULL THEN RAISE EXCEPTION 'skip votes cannot select a player'; END IF;
  IF NOT p_skipped AND (p_target_player_id IS NULL OR p_target_player_id = v_voter.id OR NOT (v_room.vote_candidates ? p_target_player_id)) THEN RAISE EXCEPTION 'vote target is not eligible'; END IF;
  INSERT INTO public.votes (id, room_id, round_id, vote_stage, voter_player_id, target_player_id, skipped, created_at)
  VALUES (p_vote_id, p_room_id, v_round.id, v_room.vote_number * 10 + CASE WHEN v_room.game_phase = 'runoff' THEN 1 ELSE 0 END, v_voter.id, p_target_player_id, p_skipped, p_created_at);
  SELECT COUNT(*) INTO v_eligible FROM public.players WHERE room_id = p_room_id AND NOT is_ghost AND NOT is_kicked;
  SELECT COUNT(*) INTO v_cast FROM public.votes WHERE round_id = v_round.id AND vote_stage = v_room.vote_number * 10 + CASE WHEN v_room.game_phase = 'runoff' THEN 1 ELSE 0 END;
  INSERT INTO public.game_events (id, room_id, round_id, type, message, meta, created_at)
  VALUES (CONCAT('cloud-event-', p_operation_id), p_room_id, v_round.id, CASE WHEN p_skipped THEN 'live_vote_skipped' ELSE 'live_vote_cast' END, v_voter.user_id || CASE WHEN p_skipped THEN ' skipped this vote.' ELSE ' voted.' END, jsonb_build_object('voterPlayerId', v_voter.id, 'targetPlayerId', p_target_player_id, 'skipped', p_skipped), p_created_at);
  v_result := jsonb_build_object('roomId', p_room_id, 'votesCast', v_cast, 'eligibleVoters', v_eligible, 'allVoted', v_cast >= v_eligible, 'replayed', FALSE);
  INSERT INTO public.game_operation_results (operation_id, room_id, operation_type, result, created_at) VALUES (p_operation_id, p_room_id, 'cast_vote', v_result, p_created_at);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.word_impostor_cast_vote(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_cast_vote(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT) TO service_role;
