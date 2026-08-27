CREATE OR REPLACE FUNCTION public.word_impostor_set_presence(
  p_operation_id TEXT,p_room_id TEXT,p_session_token TEXT,p_connected BOOLEAN,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_player public.players%ROWTYPE; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_player FROM public.players WHERE room_id=p_room_id AND session_token=p_session_token AND NOT is_kicked FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'player session is not valid'; END IF;
 UPDATE public.players SET is_connected=p_connected,left_at=CASE WHEN p_connected THEN left_at ELSE p_created_at END WHERE id=v_player.id;
 v_result:=jsonb_build_object('roomId',p_room_id,'playerId',v_player.id,'connected',p_connected,'replayed',FALSE);
 INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'set_presence',v_result,p_created_at); RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.word_impostor_set_presence(TEXT,TEXT,TEXT,BOOLEAN,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_set_presence(TEXT,TEXT,TEXT,BOOLEAN,BIGINT) TO service_role;
