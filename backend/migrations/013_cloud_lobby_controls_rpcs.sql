CREATE OR REPLACE FUNCTION public.word_impostor_set_ready(p_operation_id TEXT,p_room_id TEXT,p_session_token TEXT,p_ready BOOLEAN,p_created_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_player public.players%ROWTYPE; v_room public.rooms%ROWTYPE; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id FOR UPDATE; SELECT * INTO v_player FROM public.players WHERE room_id=p_room_id AND session_token=p_session_token AND NOT is_kicked;
 IF NOT FOUND OR v_player.is_ghost OR v_room.status<>'lobby' THEN RAISE EXCEPTION 'ready status is unavailable'; END IF;
 UPDATE public.players SET is_ready=p_ready WHERE id=v_player.id;
 v_result:=jsonb_build_object('roomId',p_room_id,'playerId',v_player.id,'ready',p_ready,'replayed',FALSE);
 INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'set_ready',v_result,p_created_at); RETURN v_result;
END; $$;
CREATE OR REPLACE FUNCTION public.word_impostor_kick_player(p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_player_id TEXT,p_created_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_player public.players%ROWTYPE; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 SELECT * INTO v_player FROM public.players WHERE id=p_player_id AND room_id=p_room_id; IF NOT FOUND THEN RAISE EXCEPTION 'player was not found'; END IF;
 UPDATE public.players SET is_kicked=TRUE,is_connected=FALSE,is_ready=FALSE,left_at=p_created_at WHERE id=v_player.id;
 v_result:=jsonb_build_object('roomId',p_room_id,'playerId',v_player.id,'sessionToken',v_player.session_token,'replayed',FALSE);
 INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'kick_player',v_result,p_created_at); RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.word_impostor_set_ready(TEXT,TEXT,TEXT,BOOLEAN,BIGINT),public.word_impostor_kick_player(TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_set_ready(TEXT,TEXT,TEXT,BOOLEAN,BIGINT),public.word_impostor_kick_player(TEXT,TEXT,TEXT,TEXT,BIGINT) TO service_role;
