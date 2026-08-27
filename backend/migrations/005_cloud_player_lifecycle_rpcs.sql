-- Server-only player lifecycle and cleanup RPCs for the staged cloud repository.

CREATE OR REPLACE FUNCTION public.word_impostor_join_or_reclaim_player(
  p_operation_id TEXT,
  p_room_id TEXT,
  p_existing_session_token TEXT,
  p_user_id TEXT,
  p_is_ghost BOOLEAN,
  p_new_player_id TEXT,
  p_new_session_token TEXT,
  p_avatar_id TEXT,
  p_avatar_color TEXT,
  p_joined_at BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing JSONB;
  v_room public.rooms%ROWTYPE;
  v_player public.players%ROWTYPE;
  v_turn_position INTEGER;
  v_result JSONB;
BEGIN
  SELECT result INTO v_existing
  FROM public.game_operation_results
  WHERE operation_id = p_operation_id;

  IF FOUND THEN
    RETURN v_existing || jsonb_build_object('replayed', TRUE);
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room was not found';
  END IF;

  IF p_existing_session_token IS NOT NULL THEN
    SELECT * INTO v_player
    FROM public.players
    WHERE room_id = p_room_id AND session_token = p_existing_session_token;

    IF FOUND AND NOT v_player.is_kicked THEN
      v_result := jsonb_build_object(
        'roomCode', v_room.room_code,
        'sessionToken', v_player.session_token,
        'playerId', v_player.id,
        'isGhost', v_player.is_ghost,
        'replayed', FALSE
      );
      INSERT INTO public.game_operation_results (operation_id, room_id, operation_type, result, created_at)
      VALUES (p_operation_id, p_room_id, 'join_or_reclaim_player', v_result, p_joined_at);
      RETURN v_result;
    END IF;
  END IF;

  SELECT * INTO v_player
  FROM public.players
  WHERE room_id = p_room_id AND user_id = p_user_id AND NOT is_kicked;

  IF FOUND THEN
    v_result := jsonb_build_object(
      'roomCode', v_room.room_code,
      'sessionToken', v_player.session_token,
      'playerId', v_player.id,
      'isGhost', v_player.is_ghost,
      'replayed', FALSE
    );
    INSERT INTO public.game_operation_results (operation_id, room_id, operation_type, result, created_at)
    VALUES (p_operation_id, p_room_id, 'join_or_reclaim_player', v_result, p_joined_at);
    RETURN v_result;
  END IF;

  SELECT * INTO v_player
  FROM public.players
  WHERE room_id = p_room_id AND user_id = p_user_id AND is_kicked;

  IF FOUND THEN
    UPDATE public.players
    SET is_kicked = FALSE,
        is_connected = FALSE,
        is_ready = FALSE,
        session_token = p_new_session_token
    WHERE id = v_player.id
    RETURNING * INTO v_player;
  ELSE
    IF v_room.status = 'playing' AND NOT p_is_ghost THEN
      RAISE EXCEPTION 'this round is already in progress; join as a ghost to watch';
    END IF;

    SELECT COUNT(*) INTO v_turn_position
    FROM public.players
    WHERE room_id = p_room_id;

    INSERT INTO public.players (
      id, room_id, user_id, session_token, avatar_id, avatar_color, is_ghost, turn_position, joined_at
    ) VALUES (
      p_new_player_id, p_room_id, p_user_id, p_new_session_token,
      p_avatar_id, p_avatar_color, p_is_ghost, v_turn_position, p_joined_at
    )
    RETURNING * INTO v_player;
  END IF;

  UPDATE public.rooms SET updated_at = p_joined_at WHERE id = p_room_id;

  v_result := jsonb_build_object(
    'roomCode', v_room.room_code,
    'sessionToken', v_player.session_token,
    'playerId', v_player.id,
    'isGhost', v_player.is_ghost,
    'replayed', FALSE
  );
  INSERT INTO public.game_operation_results (operation_id, room_id, operation_type, result, created_at)
  VALUES (p_operation_id, p_room_id, 'join_or_reclaim_player', v_result, p_joined_at);

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.word_impostor_purge_room_session(
  p_room_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_id TEXT;
BEGIN
  DELETE FROM public.rooms
  WHERE id = p_room_id
  RETURNING id INTO v_deleted_id;

  RETURN jsonb_build_object('roomId', p_room_id, 'deleted', v_deleted_id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.word_impostor_join_or_reclaim_player(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.word_impostor_purge_room_session(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.word_impostor_join_or_reclaim_player(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.word_impostor_purge_room_session(TEXT) TO service_role;
