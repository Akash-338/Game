-- Lock down every authoritative game table before a Supabase URL or key is used.
-- The deployed Node backend will use a private direct database credential; browser
-- clients receive only Socket.IO data from that backend and have no table policies.

ALTER TABLE public.word_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hint_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.used_word_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_word_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.word_packs FROM anon, authenticated;
REVOKE ALL ON TABLE public.rooms FROM anon, authenticated;
REVOKE ALL ON TABLE public.players FROM anon, authenticated;
REVOKE ALL ON TABLE public.rounds FROM anon, authenticated;
REVOKE ALL ON TABLE public.hints FROM anon, authenticated;
REVOKE ALL ON TABLE public.hint_entries FROM anon, authenticated;
REVOKE ALL ON TABLE public.used_word_entries FROM anon, authenticated;
REVOKE ALL ON TABLE public.room_word_packs FROM anon, authenticated;
REVOKE ALL ON TABLE public.host_alerts FROM anon, authenticated;
REVOKE ALL ON TABLE public.votes FROM anon, authenticated;
REVOKE ALL ON TABLE public.game_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.discussion_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.direct_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.player_scores FROM anon, authenticated;
REVOKE ALL ON TABLE public.score_events FROM anon, authenticated;
