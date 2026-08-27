-- Cover foreign keys that are not already the leading column of an existing index.
-- These indexes protect cascading updates/deletes and room-scoped realtime lookups.

CREATE INDEX IF NOT EXISTS direct_messages_room_created_idx ON public.direct_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS discussion_messages_room_created_idx ON public.discussion_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS discussion_messages_player_created_idx ON public.discussion_messages(player_id, created_at);
CREATE INDEX IF NOT EXISTS game_events_round_idx ON public.game_events(round_id);
CREATE INDEX IF NOT EXISTS hint_entries_player_idx ON public.hint_entries(player_id);
CREATE INDEX IF NOT EXISTS hints_player_idx ON public.hints(player_id);
CREATE INDEX IF NOT EXISTS host_alerts_room_idx ON public.host_alerts(room_id);
CREATE INDEX IF NOT EXISTS player_scores_player_idx ON public.player_scores(player_id);
CREATE INDEX IF NOT EXISTS room_word_packs_pack_idx ON public.room_word_packs(pack_id);
CREATE INDEX IF NOT EXISTS score_events_room_idx ON public.score_events(room_id);
CREATE INDEX IF NOT EXISTS score_events_round_idx ON public.score_events(round_id);
CREATE INDEX IF NOT EXISTS used_word_entries_round_idx ON public.used_word_entries(round_id);
CREATE INDEX IF NOT EXISTS votes_room_idx ON public.votes(room_id);
CREATE INDEX IF NOT EXISTS votes_voter_idx ON public.votes(voter_player_id);
CREATE INDEX IF NOT EXISTS votes_target_idx ON public.votes(target_player_id);
