-- Draft only: all pack management remains server-side; browser roles keep no data access.
CREATE OR REPLACE FUNCTION public.word_impostor_upload_word_pack(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_pack JSONB,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_pack_id TEXT; v_entries JSONB; v_entry JSONB; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
  IF jsonb_typeof(p_pack)<>'object' OR jsonb_typeof(p_pack->'entries')<>'array' OR jsonb_array_length(p_pack->'entries')=0 THEN RAISE EXCEPTION 'word pack entries must be a non-empty array'; END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
  IF v_room.status<>'lobby' THEN RAISE EXCEPTION 'change word packs before the round begins'; END IF;
  v_pack_id:=lower(trim(p_pack->>'packId')); v_entries:=p_pack->'entries';
  IF v_pack_id !~ '^[a-z0-9-]{3,64}$' THEN RAISE EXCEPTION 'pack id must contain 3-64 lowercase letters, numbers, or hyphens'; END IF;
  IF EXISTS(SELECT 1 FROM public.word_packs WHERE pack_id=v_pack_id AND is_default) THEN RAISE EXCEPTION 'default word packs cannot be replaced'; END IF;
  IF EXISTS(SELECT 1 FROM public.rounds round_record JOIN public.rooms room_record ON room_record.id=round_record.room_id WHERE round_record.word_pack_id=v_pack_id AND room_record.status='playing') THEN RAISE EXCEPTION 'cannot replace a pack used by an active room'; END IF;
  IF (SELECT COUNT(*) FROM jsonb_array_elements(v_entries))<>(SELECT COUNT(DISTINCT (value->>'id')::INTEGER) FROM jsonb_array_elements(v_entries)) THEN RAISE EXCEPTION 'word pack entry ids must be unique'; END IF;
  INSERT INTO public.word_packs(id,pack_id,name,version,file_path,uploaded_at,is_default) VALUES(p_pack->>'id',v_pack_id,trim(p_pack->>'name'),COALESCE((p_pack->>'version')::INTEGER,1),'supabase://word-packs/'||v_pack_id,p_created_at,FALSE)
  ON CONFLICT(pack_id) DO UPDATE SET name=EXCLUDED.name,version=EXCLUDED.version,file_path=EXCLUDED.file_path,uploaded_at=EXCLUDED.uploaded_at;
  DELETE FROM public.word_pack_entries WHERE pack_id=v_pack_id;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
    IF COALESCE(length(trim(v_entry->>'category')),0)=0 OR COALESCE(length(trim(v_entry->>'word')),0)=0 OR COALESCE(length(trim(v_entry->>'impostorHint')),0)=0 THEN RAISE EXCEPTION 'each pack entry needs category, word, and impostor hint'; END IF;
    INSERT INTO public.word_pack_entries(pack_id,entry_id,category,word,impostor_hint) VALUES(v_pack_id,(v_entry->>'id')::INTEGER,trim(v_entry->>'category'),trim(v_entry->>'word'),trim(v_entry->>'impostorHint'));
  END LOOP;
  INSERT INTO public.room_word_packs(room_id,pack_id,enabled) VALUES(p_room_id,v_pack_id,TRUE) ON CONFLICT(room_id,pack_id) DO UPDATE SET enabled=TRUE;
  v_result:=jsonb_build_object('roomId',p_room_id,'packId',v_pack_id,'entryCount',jsonb_array_length(v_entries),'replayed',FALSE);
  INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'upload_word_pack',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_set_word_pack_enabled(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_pack_id TEXT,p_enabled BOOLEAN,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
  IF v_room.status<>'lobby' THEN RAISE EXCEPTION 'change word packs before the round begins'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.word_packs WHERE pack_id=p_pack_id) THEN RAISE EXCEPTION 'word pack was not found'; END IF;
  INSERT INTO public.room_word_packs(room_id,pack_id,enabled) VALUES(p_room_id,p_pack_id,p_enabled) ON CONFLICT(room_id,pack_id) DO UPDATE SET enabled=EXCLUDED.enabled;
  v_result:=jsonb_build_object('roomId',p_room_id,'packId',p_pack_id,'enabled',p_enabled,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'set_word_pack_enabled',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_delete_word_pack(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_pack_id TEXT,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
  IF EXISTS(SELECT 1 FROM public.word_packs WHERE pack_id=p_pack_id AND is_default) THEN RAISE EXCEPTION 'default word packs cannot be deleted'; END IF;
  IF EXISTS(SELECT 1 FROM public.rounds round_record JOIN public.rooms room_record ON room_record.id=round_record.room_id WHERE round_record.word_pack_id=p_pack_id AND room_record.status='playing') THEN RAISE EXCEPTION 'this word pack is used by an active room'; END IF;
  DELETE FROM public.word_packs WHERE pack_id=p_pack_id; IF NOT FOUND THEN RAISE EXCEPTION 'word pack was not found'; END IF;
  v_result:=jsonb_build_object('roomId',p_room_id,'packId',p_pack_id,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'delete_word_pack',v_result,p_created_at); RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.word_impostor_upload_word_pack(TEXT,TEXT,TEXT,JSONB,BIGINT),public.word_impostor_set_word_pack_enabled(TEXT,TEXT,TEXT,TEXT,BOOLEAN,BIGINT),public.word_impostor_delete_word_pack(TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_upload_word_pack(TEXT,TEXT,TEXT,JSONB,BIGINT),public.word_impostor_set_word_pack_enabled(TEXT,TEXT,TEXT,TEXT,BOOLEAN,BIGINT),public.word_impostor_delete_word_pack(TEXT,TEXT,TEXT,TEXT,BIGINT) TO service_role;
