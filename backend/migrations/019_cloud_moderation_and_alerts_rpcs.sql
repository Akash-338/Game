-- Draft only: host actions remain server-only, locked, and idempotent.
CREATE OR REPLACE FUNCTION public.word_impostor_abstain_disconnected_voter(p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_player_id TEXT,p_vote_id TEXT,p_created_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_round public.rounds%ROWTYPE; v_player public.players%ROWTYPE; v_stage INTEGER; v_all_voted BOOLEAN; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing||jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 IF v_room.status<>'playing' OR v_room.game_phase NOT IN ('voting','runoff') THEN RAISE EXCEPTION 'there is no open vote'; END IF;
 SELECT * INTO v_round FROM public.rounds WHERE room_id=p_room_id ORDER BY round_number DESC LIMIT 1; IF NOT FOUND THEN RAISE EXCEPTION 'there is no open vote'; END IF;
 SELECT * INTO v_player FROM public.players WHERE id=p_player_id AND room_id=p_room_id AND NOT is_ghost AND NOT is_kicked FOR UPDATE; IF NOT FOUND OR v_player.is_connected THEN RAISE EXCEPTION 'only an offline active player can be marked absent'; END IF;
 v_stage:=CASE WHEN v_room.game_phase='runoff' THEN 2 ELSE 1 END;
 IF EXISTS(SELECT 1 FROM public.votes WHERE room_id=p_room_id AND round_id=v_round.id AND vote_stage=v_stage AND voter_player_id=p_player_id) THEN RAISE EXCEPTION 'that player''s ballot is already recorded'; END IF;
 INSERT INTO public.votes(id,room_id,round_id,vote_stage,voter_player_id,target_player_id,abstained,skipped,created_at) VALUES(p_vote_id,p_room_id,v_round.id,v_stage,p_player_id,NULL,TRUE,FALSE,p_created_at);
 INSERT INTO public.game_events(id,room_id,round_id,type,message,meta,created_at) VALUES('event-'||p_operation_id,p_room_id,v_round.id,'abstention_recorded',v_player.user_id||' is offline and has been recorded as absent from this vote.',jsonb_build_object('playerId',p_player_id),p_created_at);
 SELECT COUNT(*)>=COUNT(*) FILTER(WHERE NOT is_ghost AND NOT is_kicked) INTO v_all_voted FROM public.players p WHERE p.room_id=p_room_id; -- active-player total is checked below to preserve readable lock scope.
 SELECT (SELECT COUNT(*) FROM public.votes WHERE room_id=p_room_id AND round_id=v_round.id AND vote_stage=v_stage)>=(SELECT COUNT(*) FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked) INTO v_all_voted;
 v_result:=jsonb_build_object('roomId',p_room_id,'allVoted',v_all_voted,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'abstain_disconnected_voter',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_edit_hint(p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_hint_id TEXT,p_content TEXT,p_created_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_hint public.hint_entries%ROWTYPE; v_clean TEXT; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing||jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 SELECT h.* INTO v_hint FROM public.hint_entries h JOIN public.rounds r ON r.id=h.round_id WHERE h.id=p_hint_id AND r.room_id=p_room_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'hint was not found'; END IF;
 v_clean:=regexp_replace(trim(p_content),'\s+',' ','g'); IF length(v_clean) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'hints must be 1-80 characters'; END IF;
 IF EXISTS(SELECT 1 FROM public.hint_entries h JOIN public.rounds r ON r.id=h.round_id WHERE r.room_id=p_room_id AND h.id<>p_hint_id AND lower(h.content)=lower(v_clean)) THEN RAISE EXCEPTION 'that hint has already been used'; END IF;
 UPDATE public.hint_entries SET content=v_clean,edited_at=p_created_at,edited_by_host=TRUE WHERE id=p_hint_id;
 v_result:=jsonb_build_object('roomId',p_room_id,'hintId',p_hint_id,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'edit_hint',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_remove_discussion_message(p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_message_id TEXT,p_created_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_round_id TEXT; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing||jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 UPDATE public.discussion_messages SET deleted_at=p_created_at,deleted_by_host=TRUE WHERE id=p_message_id AND room_id=p_room_id AND deleted_at IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'discussion message was not found'; END IF;
 SELECT id INTO v_round_id FROM public.rounds WHERE room_id=p_room_id ORDER BY round_number DESC LIMIT 1; INSERT INTO public.game_events(id,room_id,round_id,type,message,meta,created_at) VALUES('event-'||p_operation_id,p_room_id,v_round_id,'discussion_removed','The host removed a discussion message.',jsonb_build_object('messageId',p_message_id),p_created_at);
 v_result:=jsonb_build_object('roomId',p_room_id,'messageId',p_message_id,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'remove_discussion_message',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_mark_memorable_clue(p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_hint_id TEXT,p_created_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_hint public.hint_entries%ROWTYPE; v_delta INTEGER; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing||jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF; IF v_room.status<>'revealed' THEN RAISE EXCEPTION 'memorable clues are selected during the recap'; END IF;
 SELECT h.* INTO v_hint FROM public.hint_entries h JOIN public.rounds r ON r.id=h.round_id WHERE h.id=p_hint_id AND r.room_id=p_room_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'hint was not found'; END IF;
 v_delta:=CASE WHEN v_hint.memorable THEN -1 ELSE 1 END; UPDATE public.hint_entries SET memorable=NOT memorable WHERE id=p_hint_id;
 UPDATE public.player_scores SET points=points+v_delta,memorable_clue_awards=memorable_clue_awards+v_delta WHERE room_id=p_room_id AND player_id=v_hint.player_id;
 INSERT INTO public.score_events(id,room_id,round_id,player_id,delta,reason,created_at) VALUES('score-'||p_operation_id,p_room_id,v_hint.round_id,v_hint.player_id,v_delta,CASE WHEN v_delta=1 THEN 'Host awarded a memorable clue.' ELSE 'Host removed the memorable-clue award.' END,p_created_at);
 v_result:=jsonb_build_object('roomId',p_room_id,'hintId',p_hint_id,'delta',v_delta,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'mark_memorable_clue',v_result,p_created_at); RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.word_impostor_create_alert(p_operation_id TEXT,p_room_id TEXT,p_host_token TEXT,p_alert_id TEXT,p_message TEXT,p_target_player_id TEXT,p_type TEXT,p_created_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_existing JSONB; v_room public.rooms%ROWTYPE; v_round_id TEXT; v_clean TEXT; v_result JSONB;
BEGIN
 SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id; IF FOUND THEN RETURN v_existing||jsonb_build_object('replayed',TRUE); END IF;
 SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id AND host_token=p_host_token FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'host session is not valid'; END IF;
 v_clean:=trim(p_message); IF length(v_clean) NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'alert must be 1-90 characters'; END IF; IF p_type NOT IN ('flash','nudge') THEN RAISE EXCEPTION 'alert type is not valid'; END IF;
 IF p_target_player_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_target_player_id AND room_id=p_room_id) THEN RAISE EXCEPTION 'alert target was not found'; END IF;
 SELECT id INTO v_round_id FROM public.rounds WHERE room_id=p_room_id ORDER BY round_number DESC LIMIT 1; INSERT INTO public.host_alerts(id,room_id,round_id,message,target_player_id,type,created_at) VALUES(p_alert_id,p_room_id,v_round_id,v_clean,p_target_player_id,p_type,p_created_at);
 v_result:=jsonb_build_object('roomId',p_room_id,'message',v_clean,'targetPlayerId',p_target_player_id,'type',p_type,'replayed',FALSE); INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'create_alert',v_result,p_created_at); RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.word_impostor_abstain_disconnected_voter(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),public.word_impostor_edit_hint(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),public.word_impostor_remove_discussion_message(TEXT,TEXT,TEXT,TEXT,BIGINT),public.word_impostor_mark_memorable_clue(TEXT,TEXT,TEXT,TEXT,BIGINT),public.word_impostor_create_alert(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_abstain_disconnected_voter(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),public.word_impostor_edit_hint(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),public.word_impostor_remove_discussion_message(TEXT,TEXT,TEXT,TEXT,BIGINT),public.word_impostor_mark_memorable_clue(TEXT,TEXT,TEXT,TEXT,BIGINT),public.word_impostor_create_alert(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO service_role;
