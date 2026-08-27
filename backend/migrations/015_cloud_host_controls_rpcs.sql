-- Draft only: apply after explicit user approval. All functions are server-only and record replay-safe results.
CREATE OR REPLACE FUNCTION public.word_impostor_update_lobby_settings(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_changes JSONB,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_active_count INTEGER; v_impostor_count INTEGER; v_cycle_limit INTEGER; v_categories JSONB; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
 IF jsonb_typeof(p_changes) <> 'object' THEN RAISE EXCEPTION 'settings changes must be an object'; END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 IF v_room.status='playing' THEN RAISE EXCEPTION 'change round settings before the game starts'; END IF;
 v_impostor_count:=COALESCE((p_changes->>'impostorCount')::INTEGER,v_room.impostor_count);
 v_cycle_limit:=COALESCE((p_changes->>'clueCycleLimit')::INTEGER,v_room.clue_cycle_limit);
 SELECT COUNT(*) INTO v_active_count FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked;
 IF v_impostor_count < 1 OR v_impostor_count >= GREATEST(v_active_count,2) THEN RAISE EXCEPTION 'impostor count must leave at least one civilian'; END IF;
 IF v_cycle_limit < 1 OR v_cycle_limit > 5 THEN RAISE EXCEPTION 'set between 1 and 5 clue cycles before the first vote'; END IF;
 v_categories:=CASE WHEN p_changes ? 'selectedCategories' THEN p_changes->'selectedCategories' ELSE v_room.selected_categories END;
 IF jsonb_typeof(v_categories) <> 'array' THEN RAISE EXCEPTION 'selected categories must be an array'; END IF;
 UPDATE public.rooms SET impostor_count=v_impostor_count,clue_cycle_limit=v_cycle_limit,
   show_category_to_impostor=CASE WHEN p_changes ? 'showCategoryToImpostor' THEN (p_changes->>'showCategoryToImpostor')::BOOLEAN ELSE v_room.show_category_to_impostor END,
   show_hint_to_impostor=CASE WHEN p_changes ? 'showHintToImpostor' THEN (p_changes->>'showHintToImpostor')::BOOLEAN ELSE v_room.show_hint_to_impostor END,
   selected_categories=v_categories,
   selected_word_entry_id=CASE WHEN p_changes ? 'selectedWordEntryId' THEN NULLIF(p_changes->>'selectedWordEntryId','') ELSE v_room.selected_word_entry_id END,
   sound_muted=CASE WHEN p_changes ? 'soundMuted' THEN (p_changes->>'soundMuted')::BOOLEAN ELSE v_room.sound_muted END,
   updated_at=p_created_at WHERE id=p_room_id;
 v_result:=jsonb_build_object('roomId',p_room_id,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'update_lobby_settings',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_reorder_players(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_player_ids JSONB,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_ids TEXT[]; v_active_count INTEGER; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
 IF jsonb_typeof(p_player_ids) <> 'array' THEN RAISE EXCEPTION 'invalid player order'; END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 IF v_room.status <> 'lobby' THEN RAISE EXCEPTION 'turn order can only be changed in the lobby'; END IF;
 SELECT COALESCE(array_agg(value),ARRAY[]::TEXT[]) INTO v_ids FROM jsonb_array_elements_text(p_player_ids);
 SELECT COUNT(*) INTO v_active_count FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked;
 IF cardinality(v_ids) <> v_active_count OR cardinality(v_ids) <> (SELECT COUNT(DISTINCT id) FROM unnest(v_ids) AS id) OR (SELECT COUNT(*) FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked AND id=ANY(v_ids)) <> v_active_count THEN RAISE EXCEPTION 'invalid player order'; END IF;
 UPDATE public.players AS player SET turn_position=ordered.position FROM (SELECT value AS player_id,ordinality-1 AS position FROM jsonb_array_elements_text(p_player_ids) WITH ORDINALITY) AS ordered WHERE player.id=ordered.player_id AND player.room_id=p_room_id;
 UPDATE public.rooms SET updated_at=p_created_at WHERE id=p_room_id; v_result:=jsonb_build_object('roomId',p_room_id,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'reorder_players',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_next_turn(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_active_count INTEGER; v_next_position INTEGER; v_player_id TEXT; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 IF v_room.status <> 'playing' OR v_room.game_phase <> 'clues' THEN RAISE EXCEPTION 'turns can only be advanced during clue time'; END IF;
 SELECT COUNT(*) INTO v_active_count FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked; IF v_active_count=0 THEN RAISE EXCEPTION 'no active players remain'; END IF;
 v_next_position:=(v_room.current_turn_position+1)%v_active_count;
 SELECT id INTO v_player_id FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked ORDER BY turn_position,joined_at OFFSET v_next_position LIMIT 1;
 UPDATE public.rooms SET current_turn_position=v_next_position,updated_at=p_created_at WHERE id=p_room_id; v_result:=jsonb_build_object('roomId',p_room_id,'playerId',v_player_id,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'next_turn',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_set_discussion_locked(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_locked BOOLEAN,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 IF v_room.status <> 'playing' OR v_room.game_phase NOT IN ('voting','runoff') THEN RAISE EXCEPTION 'discussion can only be locked during voting'; END IF;
 UPDATE public.rooms SET discussion_locked=p_locked,updated_at=p_created_at WHERE id=p_room_id; v_result:=jsonb_build_object('roomId',p_room_id,'locked',p_locked,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'set_discussion_locked',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_reveal_roles(
  p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_event_id TEXT,p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_round public.rounds%ROWTYPE; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 IF v_room.status <> 'playing' THEN RAISE EXCEPTION 'there is no active round to reveal'; END IF;
 SELECT * INTO v_round FROM public.rounds WHERE room_id=p_room_id ORDER BY round_number DESC LIMIT 1 FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'there is no active round to reveal'; END IF;
 UPDATE public.rooms SET status='revealed',game_phase='finished',winner='manual',vote_candidates='[]'::jsonb,updated_at=p_created_at WHERE id=p_room_id; UPDATE public.rounds SET status='revealed',revealed_at=p_created_at,finished_at=p_created_at WHERE id=v_round.id;
 INSERT INTO public.game_events(id,room_id,round_id,type,message,meta,created_at) VALUES(p_event_id,p_room_id,v_round.id,'roles_revealed','The host revealed the roles and word.','{}'::jsonb,p_created_at);
 v_result:=jsonb_build_object('roomId',p_room_id,'roundId',v_round.id,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'reveal_roles',v_result,p_created_at); RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.word_impostor_update_lobby_settings(TEXT,TEXT,TEXT,JSONB,BIGINT),public.word_impostor_reorder_players(TEXT,TEXT,TEXT,JSONB,BIGINT),public.word_impostor_next_turn(TEXT,TEXT,TEXT,BIGINT),public.word_impostor_set_discussion_locked(TEXT,TEXT,TEXT,BOOLEAN,BIGINT),public.word_impostor_reveal_roles(TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_update_lobby_settings(TEXT,TEXT,TEXT,JSONB,BIGINT),public.word_impostor_reorder_players(TEXT,TEXT,TEXT,JSONB,BIGINT),public.word_impostor_next_turn(TEXT,TEXT,TEXT,BIGINT),public.word_impostor_set_discussion_locked(TEXT,TEXT,TEXT,BOOLEAN,BIGINT),public.word_impostor_reveal_roles(TEXT,TEXT,TEXT,TEXT,BIGINT) TO service_role;
