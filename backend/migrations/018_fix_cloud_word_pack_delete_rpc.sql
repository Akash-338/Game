-- Draft only: replace the deletion RPC to honor the room_word_packs foreign key.
CREATE OR REPLACE FUNCTION public.word_impostor_delete_word_pack(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_pack_id TEXT,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
  IF EXISTS(SELECT 1 FROM public.word_packs WHERE pack_id=p_pack_id AND is_default) THEN RAISE EXCEPTION 'default word packs cannot be deleted'; END IF;
  IF EXISTS(SELECT 1 FROM public.rounds round_record JOIN public.rooms room_record ON room_record.id=round_record.room_id WHERE round_record.word_pack_id=p_pack_id AND room_record.status='playing') THEN RAISE EXCEPTION 'this word pack is used by an active room'; END IF;
  DELETE FROM public.room_word_packs WHERE pack_id=p_pack_id;
  DELETE FROM public.word_packs WHERE pack_id=p_pack_id; IF NOT FOUND THEN RAISE EXCEPTION 'word pack was not found'; END IF;
  v_result:=jsonb_build_object('roomId',p_room_id,'packId',p_pack_id,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'delete_word_pack',v_result,p_created_at); RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.word_impostor_delete_word_pack(TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_delete_word_pack(TEXT,TEXT,TEXT,TEXT,BIGINT) TO service_role;
