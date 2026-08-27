-- Correct the disconnected-voter abstention stage key to match cloud ballot casting and tallying.
CREATE OR REPLACE FUNCTION public.word_impostor_abstain_disconnected_voter(p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_player_id TEXT,p_vote_id TEXT,p_created_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_round public.rounds%ROWTYPE; v_player public.players%ROWTYPE; v_stage INTEGER; v_all_voted BOOLEAN; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing||jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 IF v_room.status<>'playing' OR v_room.game_phase NOT IN ('voting','runoff') THEN RAISE EXCEPTION 'there is no open vote'; END IF;
 SELECT * INTO v_round FROM public.rounds WHERE room_id=p_room_id ORDER BY round_number DESC LIMIT 1; IF NOT FOUND THEN RAISE EXCEPTION 'there is no open vote'; END IF;
 SELECT * INTO v_player FROM public.players WHERE id=p_player_id AND room_id=p_room_id AND NOT is_ghost AND NOT is_kicked FOR UPDATE; IF NOT FOUND OR v_player.is_connected THEN RAISE EXCEPTION 'only an offline active player can be marked absent'; END IF;
 v_stage:=v_room.vote_number*10+CASE WHEN v_room.game_phase='runoff' THEN 1 ELSE 0 END;
 IF EXISTS(SELECT 1 FROM public.votes WHERE room_id=p_room_id AND round_id=v_round.id AND vote_stage=v_stage AND voter_player_id=p_player_id) THEN RAISE EXCEPTION 'that player''s ballot is already recorded'; END IF;
 INSERT INTO public.votes(id,room_id,round_id,vote_stage,voter_player_id,target_player_id,abstained,skipped,created_at) VALUES(p_vote_id,p_room_id,v_round.id,v_stage,p_player_id,NULL,TRUE,FALSE,p_created_at);
 INSERT INTO public.game_events(id,room_id,round_id,type,message,meta,created_at) VALUES('event-'||p_operation_id,p_room_id,v_round.id,'abstention_recorded',v_player.user_id||' is offline and has been recorded as absent from this vote.',jsonb_build_object('playerId',p_player_id),p_created_at);
 SELECT (SELECT COUNT(*) FROM public.votes WHERE room_id=p_room_id AND round_id=v_round.id AND vote_stage=v_stage)>=(SELECT COUNT(*) FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked) INTO v_all_voted;
 v_result:=jsonb_build_object('roomId',p_room_id,'allVoted',v_all_voted,'replayed',FALSE);
 INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'abstain_disconnected_voter',v_result,p_created_at);
 RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.word_impostor_abstain_disconnected_voter(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_abstain_disconnected_voter(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO service_role;
