-- Server-only continuation after a revealed round. Scores remain cumulative.
CREATE OR REPLACE FUNCTION public.word_impostor_continue_round(
  p_operation_id TEXT, p_room_id TEXT, p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id;
  IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'revealed' THEN RAISE EXCEPTION 'reveal the round before continuing'; END IF;
  UPDATE public.rooms SET status='lobby',game_phase='lobby',winner=NULL,vote_number=0,runoff_used=FALSE,vote_candidates='[]'::jsonb,vote_opened_at=NULL,current_turn_position=-1,selected_word_entry_id=NULL,discussion_locked=FALSE,updated_at=p_created_at WHERE id=p_room_id;
  UPDATE public.players SET is_ghost=FALSE,is_ready=FALSE,role='civilian' WHERE room_id=p_room_id AND NOT is_kicked;
  DELETE FROM public.used_word_entries WHERE room_id=p_room_id;
  INSERT INTO public.game_events(id,room_id,type,message,meta,created_at) VALUES(CONCAT('cloud-event-',p_operation_id),p_room_id,'next_round_ready','All non-kicked players are back at the table. Scores carry forward; the word pool has reset for the new round.',jsonb_build_object('operationId',p_operation_id),p_created_at);
  v_result:=jsonb_build_object('roomId',p_room_id,'status','lobby','replayed',FALSE);
  INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'continue_round',v_result,p_created_at);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.word_impostor_continue_round(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_continue_round(TEXT,TEXT,BIGINT) TO service_role;
