CREATE OR REPLACE FUNCTION public.word_impostor_post_discussion_message(
  p_operation_id TEXT,p_room_id TEXT,p_session_token TEXT,p_message_id TEXT,p_content TEXT,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_existing JSONB; v_sender public.players%ROWTYPE; v_room public.rooms%ROWTYPE; v_previous BIGINT; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id;
  IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id FOR UPDATE;
  SELECT * INTO v_sender FROM public.players WHERE room_id=p_room_id AND session_token=p_session_token AND NOT is_kicked;
  IF NOT FOUND OR v_sender.is_ghost OR v_room.discussion_locked THEN RAISE EXCEPTION 'discussion is unavailable'; END IF;
  SELECT created_at INTO v_previous FROM public.discussion_messages WHERE room_id=p_room_id AND player_id=v_sender.id ORDER BY created_at DESC LIMIT 1;
  IF v_previous IS NOT NULL AND p_created_at-v_previous < 15000 THEN RAISE EXCEPTION 'please wait 15 seconds before sending another discussion message'; END IF;
  IF length(trim(p_content))=0 OR length(trim(p_content))>500 THEN RAISE EXCEPTION 'discussion message content is invalid'; END IF;
  INSERT INTO public.discussion_messages(id,room_id,player_id,content,created_at) VALUES(p_message_id,p_room_id,v_sender.id,trim(p_content),p_created_at);
  v_result:=jsonb_build_object('roomId',p_room_id,'messageId',p_message_id,'playerId',v_sender.id,'content',trim(p_content),'createdAt',p_created_at,'replayed',FALSE);
  INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'post_discussion_message',v_result,p_created_at);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.word_impostor_post_discussion_message(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_post_discussion_message(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO service_role;
