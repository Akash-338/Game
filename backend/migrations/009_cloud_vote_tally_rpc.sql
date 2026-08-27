-- Server-only tally resolution. It is called only after every active ballot is recorded.
CREATE OR REPLACE FUNCTION public.word_impostor_resolve_vote_tally(
  p_operation_id TEXT, p_room_id TEXT, p_created_at BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing JSONB; v_room public.rooms%ROWTYPE; v_round public.rounds%ROWTYPE;
  v_eligible INTEGER; v_cast INTEGER; v_max INTEGER; v_leaders TEXT[]; v_eliminated JSONB;
  v_impostors INTEGER; v_civilians INTEGER; v_winner TEXT; v_result JSONB;
BEGIN
  SELECT result INTO v_existing FROM public.game_operation_results WHERE operation_id=p_operation_id;
  IF FOUND THEN RETURN v_existing || jsonb_build_object('replayed', TRUE); END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' OR v_room.game_phase NOT IN ('voting','runoff') THEN RAISE EXCEPTION 'there is no tally to resolve'; END IF;
  SELECT * INTO v_round FROM public.rounds WHERE room_id=p_room_id ORDER BY round_number DESC LIMIT 1;
  SELECT COUNT(*) INTO v_eligible FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked;
  SELECT COUNT(*) INTO v_cast FROM public.votes WHERE round_id=v_round.id AND vote_stage=v_room.vote_number * 10 + CASE WHEN v_room.game_phase='runoff' THEN 1 ELSE 0 END;
  IF v_cast < v_eligible THEN RAISE EXCEPTION 'waiting for every active ballot'; END IF;
  UPDATE public.player_scores SET last_votes_received=0 WHERE room_id=p_room_id;
  UPDATE public.player_scores score SET votes_received=score.votes_received + tally.count, last_votes_received=tally.count
  FROM (SELECT target_player_id, COUNT(*)::INTEGER AS count FROM public.votes WHERE round_id=v_round.id AND vote_stage=v_room.vote_number * 10 + CASE WHEN v_room.game_phase='runoff' THEN 1 ELSE 0 END AND target_player_id IS NOT NULL GROUP BY target_player_id) tally
  WHERE score.room_id=p_room_id AND score.player_id=tally.target_player_id;
  SELECT MAX(count) INTO v_max FROM (SELECT COUNT(*)::INTEGER AS count FROM public.votes WHERE round_id=v_round.id AND vote_stage=v_room.vote_number * 10 + CASE WHEN v_room.game_phase='runoff' THEN 1 ELSE 0 END AND target_player_id IS NOT NULL GROUP BY target_player_id) counts;
  IF v_max IS NULL THEN
    UPDATE public.rooms SET game_phase='clues', discussion_locked=FALSE, current_turn_position=0, vote_candidates='[]'::jsonb, runoff_used=FALSE, vote_opened_at=NULL, updated_at=p_created_at WHERE id=p_room_id;
    v_result:=jsonb_build_object('roomId',p_room_id,'result','stalemate','message','Every voter abstained. No player is eliminated.','replayed',FALSE);
  ELSE
    SELECT array_agg(target_player_id ORDER BY target_player_id) INTO v_leaders FROM (SELECT target_player_id FROM public.votes WHERE round_id=v_round.id AND vote_stage=v_room.vote_number * 10 + CASE WHEN v_room.game_phase='runoff' THEN 1 ELSE 0 END GROUP BY target_player_id HAVING target_player_id IS NOT NULL AND COUNT(*)=v_max) leaders;
    IF cardinality(v_leaders)>2 AND v_room.game_phase <> 'runoff' THEN
      UPDATE public.rooms SET game_phase='runoff', runoff_used=TRUE, vote_candidates=to_jsonb(v_leaders), vote_opened_at=p_created_at, updated_at=p_created_at WHERE id=p_room_id;
      v_result:=jsonb_build_object('roomId',p_room_id,'result','runoff','candidates',to_jsonb(v_leaders),'replayed',FALSE);
    ELSIF cardinality(v_leaders)>2 THEN
      UPDATE public.rooms SET game_phase='clues', discussion_locked=FALSE, current_turn_position=0, vote_candidates='[]'::jsonb, runoff_used=FALSE, vote_opened_at=NULL, updated_at=p_created_at WHERE id=p_room_id;
      v_result:=jsonb_build_object('roomId',p_room_id,'result','stalemate','message','The re-vote remained tied among more than two players. No player is eliminated.','replayed',FALSE);
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object('playerId',id,'userId',user_id,'role',role) ORDER BY user_id),'[]'::jsonb) INTO v_eliminated FROM public.players WHERE room_id=p_room_id AND id=ANY(v_leaders);
      UPDATE public.player_scores score SET points=score.points+2, correct_votes=score.correct_votes+1 FROM public.votes ballot JOIN public.players voter ON voter.id=ballot.voter_player_id JOIN public.players target ON target.id=ballot.target_player_id WHERE score.room_id=p_room_id AND score.player_id=voter.id AND ballot.round_id=v_round.id AND ballot.vote_stage=v_room.vote_number * 10 + CASE WHEN v_room.game_phase='runoff' THEN 1 ELSE 0 END AND voter.role='civilian' AND target.role='impostor' AND target.id=ANY(v_leaders);
      UPDATE public.players SET is_ghost=TRUE,is_ready=FALSE WHERE room_id=p_room_id AND id=ANY(v_leaders);
      UPDATE public.player_scores score SET points=score.points+1,impostor_tally_survivals=score.impostor_tally_survivals+1 FROM public.players player WHERE score.room_id=p_room_id AND score.player_id=player.id AND player.role='impostor' AND NOT player.is_ghost AND NOT player.is_kicked;
      SELECT COUNT(*) FILTER (WHERE role='impostor'), COUNT(*) FILTER (WHERE role='civilian') INTO v_impostors,v_civilians FROM public.players WHERE room_id=p_room_id AND NOT is_ghost AND NOT is_kicked;
      v_winner:=CASE WHEN v_impostors+v_civilians=0 THEN 'draw' WHEN v_impostors=0 THEN 'civilians' WHEN v_impostors>=v_civilians THEN 'impostors' ELSE NULL END;
      IF v_winner IS NOT NULL THEN
        IF v_winner <> 'draw' THEN UPDATE public.player_scores score SET points=score.points+4 FROM public.players player WHERE score.room_id=p_room_id AND score.player_id=player.id AND player.role=CASE WHEN v_winner='civilians' THEN 'civilian' ELSE 'impostor' END AND NOT player.is_kicked; END IF;
        UPDATE public.rooms SET status='revealed',game_phase='finished',winner=v_winner,vote_candidates='[]'::jsonb,updated_at=p_created_at WHERE id=p_room_id;
        UPDATE public.rounds SET status='revealed',revealed_at=p_created_at,finished_at=p_created_at WHERE id=v_round.id;
        v_result:=jsonb_build_object('roomId',p_room_id,'result','finished','winner',v_winner,'eliminated',v_eliminated,'replayed',FALSE);
      ELSE
        UPDATE public.rooms SET game_phase='clues',discussion_locked=FALSE,current_turn_position=0,vote_candidates='[]'::jsonb,runoff_used=FALSE,vote_opened_at=NULL,updated_at=p_created_at WHERE id=p_room_id;
        v_result:=jsonb_build_object('roomId',p_room_id,'result','eliminated','eliminated',v_eliminated,'replayed',FALSE);
      END IF;
    END IF;
  END IF;
  INSERT INTO public.game_operation_results(operation_id,room_id,operation_type,result,created_at) VALUES(p_operation_id,p_room_id,'resolve_vote_tally',v_result,p_created_at);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.word_impostor_resolve_vote_tally(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_resolve_vote_tally(TEXT,TEXT,BIGINT) TO service_role;
