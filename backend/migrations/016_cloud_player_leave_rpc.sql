-- Draft only: server-side voluntary departure with a room lock and replay-safe result.
CREATE OR REPLACE FUNCTION public.word_impostor_leave_player(
  p_operation_id TEXT, p_room_id TEXT, p_session_token TEXT, p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_player public.players%ROWTYPE; v_round public.rounds%ROWTYPE;
  v_eligible INTEGER; v_cast INTEGER; v_impostors INTEGER; v_civilians INTEGER; v_winner TEXT; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id;
  IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'room was not found'; END IF;
  SELECT * INTO v_player FROM public.players WHERE room_id=p_room_id AND session_token=p_session_token FOR UPDATE;
  IF NOT FOUND OR v_player.is_kicked THEN RAISE EXCEPTION 'player session is not valid'; END IF;
  IF v_player.user_id=v_room.host_user_id THEN RAISE EXCEPTION 'the host must end the room instead of leaving'; END IF;
  IF v_player.is_ghost THEN RAISE EXCEPTION 'this player has already left the active table'; END IF;

  SELECT * INTO v_round FROM public.rounds WHERE room_id=p_room_id ORDER BY round_number DESC LIMIT 1;
  UPDATE public.players SET is_ghost=TRUE,is_ready=FALSE,is_connected=FALSE,left_at=p_created_at WHERE id=v_player.id;
  UPDATE public.rooms SET current_turn_position=0,updated_at=p_created_at WHERE id=p_room_id;
  INSERT INTO public.game_events(id,room_id,round_id,type,message,meta,created_at)
  VALUES(CONCAT('cloud-event-',p_operation_id),p_room_id,v_round.id,'player_left',v_player.user_id || ' left the active table.',jsonb_build_object('playerId',v_player.id),p_created_at);

  IF v_room.status='playing' THEN
    SELECT COUNT(*) FILTER (WHERE role='impostor'),COUNT(*) FILTER (WHERE role='civilian') INTO v_impostors,v_civilians
    FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked;
    v_winner:=CASE WHEN v_impostors+v_civilians=0 THEN 'draw' WHEN v_impostors=0 THEN 'civilians' WHEN v_impostors>=v_civilians THEN 'impostors' ELSE NULL END;
    IF v_winner IS NOT NULL THEN
      UPDATE public.rooms SET status='revealed',game_phase='finished',winner=v_winner,vote_candidates='[]'::jsonb,updated_at=p_created_at WHERE id=p_room_id;
      UPDATE public.rounds SET status='revealed',revealed_at=p_created_at,finished_at=p_created_at WHERE id=v_round.id;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_eligible FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked;
  SELECT COUNT(*) INTO v_cast FROM public.votes WHERE round_id=v_round.id AND vote_stage=v_room.vote_number*10+CASE WHEN v_room.game_phase='runoff' THEN 1 ELSE 0 END;
  v_result:=jsonb_build_object('roomId',p_room_id,'playerId',v_player.id,'allVoted',v_room.game_phase IN ('voting','runoff') AND v_cast>=v_eligible,'winner',v_winner,'replayed',FALSE);
  INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'leave_player',v_result,p_created_at);
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.word_impostor_leave_player(TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_leave_player(TEXT,TEXT,TEXT,BIGINT) TO service_role;
