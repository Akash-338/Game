# The Word Impostor: Voting, Scoring, Reconnect, and Word-Pack Extension Plan

> **Status:** Proposal only. No gameplay logic in this document has been implemented. This revision caps each voting result at two eliminations and adds automatic voting plus a persistent discussion panel. The decisions in the final approval section should be confirmed before development begins.

## 1. Purpose and scope

This extension changes one secret-word game from a clue-only experience into a structured social-deduction game. The existing role assignment, private role vault, two-sided visibility rules, player cards, Ghost mode, room recovery, and word-selection rules remain in place. The new system will add a room-wide reconnect message, an initial two-clue phase, private simultaneous voting, player elimination to Ghost mode, a clear end-of-game rule, a public event log, per-game scoring, and safer category-based word-pack management.

The system will **not** add permanent player accounts, a cross-room leaderboard, automated clue-quality judgement, or a permanent history after the host terminates the room. Those would conflict with the current privacy rule that terminating a host room permanently removes its complete session data.

## 2. Recommended game flow

The following interpretation preserves your requested rule: everyone gets two chances to give clues before the first vote; if the game does not end, voting happens after every further clue cycle.

| Stage | What happens | Who participates | What is visible |
|---|---|---|---|
| Lobby | Players join and press Ready. Host starts the game. | Active players only | Roster, readiness, and category settings. |
| Clue cycle 1 | Every active player submits exactly one clue in turn order. | Active players | All player cards and submitted clues. |
| Clue cycle 2 | Every active player submits one more clue in turn order. | Active players | Two numbered clue rows per active player. |
| Vote 1 | Voting opens automatically as soon as the final active player submits the final required clue in cycle 2. | Active players | A live public ballot feed that names each voter and selected target, plus the ongoing discussion panel. |
| Tally and elimination | The server closes the ballot, announces the result, reveals eliminated roles, and moves eliminated players to Ghost mode. | Everyone can watch | Results notification, public log, changed player/ghost status, and score changes. |
| Later clue cycles | If neither side has won, every surviving active player gives one more clue. | Surviving active players | The next numbered clue row. |
| Later votes | A vote opens automatically as soon as the final survivor submits the last clue in every later completed clue cycle. | Surviving active players | Same live public ballot-feed and public-result behavior. |
| Final recap | When one side wins, the game reveals the word, all roles, full clue history, vote history, event log, and final score table. | Everyone | Full recap. |

The secret word stays the same during all clue-and-vote cycles of that game. It must **not** be revealed after an ordinary vote, because the game may continue. The full word and all roles are revealed only when civilians or impostors win, or if the host explicitly ends the game.

## 3. Voting rules

### 3.1 Ballot rules

Every player who is active, connected, not kicked, and not already a Ghost gets one vote. Ghosts can see the public vote progress and final tally but cannot vote. A player may vote only for another active player; self-voting is disabled by default because it adds little deduction value and can be abused to manipulate a tie.

Votes are public while the ballot is open. Each player sees a list of eligible targets, selects one person, and presses **Cast my public vote**. A confirmed vote cannot be changed. Immediately after confirmation, the room-wide feed shows a statement such as **“Akash voted for Maya.”** The progress count remains visible, and the host sees the same live feed as every player and Ghost.

If a player disconnects while voting, their ballot remains valid if they already confirmed it. If they have not voted, the host receives a controlled option after the existing recovery period to mark that player **Absent / abstain**. This avoids a disconnected phone blocking the whole game indefinitely. An abstention is a recorded no-vote and does not add a vote to any target.

### 3.2 Capped eliminations and ties, including three or more tied players

Every completed voting result can eliminate **at most two active players**. That cap is enforced by the server before it makes anyone a Ghost or evaluates the winner. It prevents a large group of tied civilians from being removed at once and immediately giving impostors an unintended win.

> **First ballot:** one highest-vote player is eliminated; two players tied for highest are both eliminated; more than two players tied for highest trigger a live public re-vote rather than an elimination.

**Approved rule:** when more than two players share the highest vote total, the server initiates a live public re-vote only among those tied leaders. All active players submit the re-vote ballot, but no other player can be selected as a target. No one is eliminated from the first ballot.

The re-vote preserves the two-elimination cap: one clear leader is eliminated; two tied leaders are both eliminated; and a remaining three-or-more-way tie produces **no elimination**. The room logs a stalemate and returns to the next clue cycle. It never runs an unlimited sequence of re-votes.

| First-ballot totals | Resolution | Maximum eliminated | Public notification |
|---|---|---:|---|
| Akash 4, Maya 2, Ravi 1 | Eliminate Akash. | 1 | “Akash received 4 votes and was a Civilian. Akash is now a Ghost.” |
| Akash 3, Maya 3, Ravi 1 | Eliminate Akash and Maya together. | 2 | “Akash and Maya tied with 3 votes. Their roles are revealed and both are now Ghosts.” |
| Akash 2, Maya 2, Ravi 2, Neha 1 | Open a runoff between Akash, Maya, and Ravi. | 0 initially | “Three players tied for the highest vote. A private runoff has started.” |
| Runoff: Akash 4, Maya 3, Ravi 1 | Eliminate Akash. | 1 | “Akash received the highest runoff vote and is now a Ghost.” |
| Runoff: Akash 3, Maya 3, Ravi 1 | Eliminate Akash and Maya. | 2 | “Akash and Maya tied in the runoff. Their roles are revealed and both are now Ghosts.” |
| Runoff: Akash 2, Maya 2, Ravi 2 | Stalemate; eliminate no one. | 0 | “The runoff remained tied between three players. No one was eliminated this vote.” |
| Everyone abstains | Stalemate; eliminate no one. | 0 | “No valid elimination: every eligible player abstained.” |

This is the recommended solution to the three-way tie problem: it is fair, limits eliminations to two, gives the group one chance to resolve the split, and avoids repeatedly cycling ballots forever.

## 4. Elimination and winning conditions

After every resolved tally, one or two eliminated players are changed to Ghost mode. Their submitted clues, avatar, public score, and player-card history remain visible. They can read the shared log, the discussion panel, and the final recap, but they cannot give clues, vote, be selected as a target, or affect turn order.

The server must evaluate victory immediately after applying all eliminations from the same resolved tally. It must use `impostorsRemaining >= civiliansRemaining`, not only equality. With the two-elimination cap, this prevents a double civilian elimination from being missed while also avoiding an uncontrolled mass elimination.

| Check order after tally | Condition | Outcome |
|---|---|---|
| 1 | `impostorsRemaining === 0` | **Civilians win.** All impostors have been eliminated. |
| 2 | `impostorsRemaining >= civiliansRemaining` | **Impostors win.** They have reached parity or outnumber civilians. |
| 3 | Otherwise | The game continues with one further clue cycle, then another vote. |

The initial two-cycle rule applies only before Vote 1. Once Vote 1 has happened and no side has won, the game alternates **one clue cycle → one vote** until a victory condition is reached. This makes the late game faster as fewer active players remain.

### 4.1 Required edge-condition rules

The following rules are part of the voting design, not optional polish. The server checks them in one transaction before broadcasting a result, so two devices cannot create conflicting outcomes.

| Edge condition | Required server behavior |
|---|---|
| 10 players, each impostor votes for one civilian | Vote totals—not who cast the votes—determine the result. Only the one highest target, or at most two tied highest targets, can be eliminated. All other civilians stay active. |
| More than two players tie for highest vote | Open one runoff among only those tied leaders. Do not eliminate anybody from the first ballot. |
| Runoff still has three or more players tied for highest | Close the voting stage as a stalemate, eliminate nobody, write the public result, and begin the next clue cycle. |
| Only one active player remains after a tally | The team win check runs before another clue or vote can open. |
| One civilian and one impostor are both eliminated in the same capped two-player result | Record a **draw: no active player remains**. Neither team receives the team-win bonus. This prevents a nonexistent “present impostor” from winning merely because `0 = 0`. |
| No impostors remain and at least one civilian remains | Civilians win immediately. |
| At least one impostor remains and impostors are equal to or more numerous than civilians | Impostors win immediately. |
| Only two active players begin a potential vote | The system requires at least three active players to begin a new game round. Existing games that fall to two active players resolve through the win check before a new vote can open. |
| A voter disconnects after confirming | Retain their confirmed public ballot; it remains valid. |
| A voter disconnects before confirming | Wait through the existing reconnect grace period. Then the host may record one abstention; the vote cannot be silently changed by another player. |
| A player reconnects during voting | Restore their active slot and ballot state. They can vote only if they have not already confirmed a ballot and the ballot is still open. |
| All valid voters abstain or no target has votes | Close as a stalemate with no elimination, then begin the next clue cycle. |
| A host disconnects during a ballot or runoff | Freeze the stage under the existing 20-second host-recovery window. No tally, abstention, or elimination runs until the host returns or the room is purged. |
| A player attempts to submit a clue while a ballot is open | Reject it; clue submission is locked until the server begins the next clue cycle. |

The win-condition evaluation should therefore use this ordered rule: first, if no active players remain, declare a draw; second, if zero impostors and at least one civilian remain, civilians win; third, if at least one impostor remains and impostors are equal to or greater than civilians, impostors win; otherwise the game continues.

## 5. Reconnect notices, public game log, and discussion panel

When a former player successfully reclaims their existing slot, the server will create a public event and broadcast a short toast:

> **“Akash is back at the table.”**

It will also remove the offline blur from their player card. A disconnect message is optional; the current red status dot and blur already provide that information, so the initial release should only add the positive reconnect message to avoid log noise.

The room will receive a chronological, read-only **Game Log** visible to active players, Ghosts, and the host. It records only public events: joins, reconnects, ready state milestones, clue-cycle completion, automatic voting opened, each live voter-to-target ballot, runoff opened, voting completed, tally results, eliminations and revealed roles, team wins, and scoring changes. Unrevealed roles are never added before they become public.

Alongside the Game Log, an always-available **Discussion** panel lets all current players and Ghosts write public comments during the entire game. Each message displays the sender’s visible game name and a local display time, for example: **“Maya · 8:41 PM — Sus on Akash; that clue does not fit the word.”** The panel is for social deduction, not private messaging: every message is visible to the whole room, Ghosts cannot learn an unrevealed role from the system, and the host receives a remove-message control for inappropriate or accidental posts.

Messages are limited to 180 characters, trimmed, plain text only, rate-limited to one message per 1.5 seconds per player, and saved only for the current room session. The discussion remains open during clues, votes, runoffs, and result screens. During voting, it supports verbal discussion beside the live public ballot feed.

## 6. Recommended scoring model

The score system should reward correct deduction and successful deception, not popularity. Therefore, the number of votes a player received should be displayed as a **Suspicion** statistic, not automatically converted into points. Awarding points merely for receiving votes would unfairly reward a civilian who is wrongly targeted and could encourage players to chase attention.

| Scoring event | Civilian points | Impostor points | Reason |
|---|---:|---:|---|
| Correctly vote for an impostor | +2 | — | Rewards successful deduction. |
| Vote for a civilian or abstain | +0 | — | No negative score; casual players should not be punished. |
| Survive one completed vote as an impostor | — | +1 | Rewards deception without making early votes too valuable. |
| Win the game as part of the winning side | +4 | +4 | Rewards the team result. |
| Lose the game | +0 | +0 | Keeps the score easy to understand. |
| Host manually marks a memorable clue in the recap | +1 optional | +1 optional | Allows a social award without pretending the system can objectively judge clue quality. |

The score panel will show **Round points**, **Game total**, **Correct votes**, **Votes received (last tally)**, and **Votes received (total)**. The last two are transparency statistics, not point multipliers. This fulfills your wish to track how many votes someone gained in earlier rounds without making the game unfair or difficult to explain.

At the final recap, the winner is the side with the highest team outcome under the victory rules. Individual scores rank players within the final table. Scores reset for the next new word by default. Because the host’s normal termination flow purges the whole room for privacy, the game does not retain scores after the session is ended.

## 7. End-of-game recap and strongest clues

The current recap already has the right foundation: actual word, impostors, and clue history. The extension will add final vote history, player scores, an event timeline, and optional strongest-clue markers.

“Strongest clue” should be **host-selected**, not guessed automatically. After the result is revealed, the host can mark one or more submitted clues as “memorable” or “best deduction clue.” Those selected clues appear with a small badge in the recap and receive the optional +1 score only if that setting is enabled. This prevents a false or arbitrary automated quality judgement.

## 8. Word-pack organization and manager

The current `Warm Party Classic` pack already uses the desired entry structure: numeric `id`, `category`, `word`, and one-word `impostorHint`. The migration will preserve that exact runtime format.

| Step | Planned change | Compatibility protection |
|---|---|---|
| 1 | Maintain one JSON source file per category: Animal, Fruits, Food, Object, Karnataka Big Cities, and Sports. | Entries retain their existing numeric IDs and one-word hints. |
| 2 | Register each category source as its own built-in runtime pack and database row. | Room selection, category checkboxes, custom uploads, and no-repeat logic use the source category pack identity directly. |
| 3 | Validate the assembled category sources at test time. | Missing entries, duplicate numeric IDs, invalid categories, or multi-word impostor hints cannot silently reach live games. |
| 4 | Keep the host Word Packs panel. | The existing category selector is populated from enabled packs. |

The Word Packs panel will list each saved pack with its name, version, entry count, categories, enabled state, and preview. The default pack cannot be deleted. A custom pack can be disabled without deleting it. Deletion requires confirmation and is blocked while that pack is used by an active room; this prevents a live session from losing its selected words.

For a room, the host first enables the packs allowed in that session, then uses the existing category checkboxes across those enabled packs. The random selector and exact-word selector draw only from enabled packs and selected categories. Custom JSON uploads keep the existing validation behavior.

## 9. Technical implementation outline

The server remains authoritative. Clients only submit intents; the server calculates clue completion, eligible voters, tally results, eliminations, scores, and win conditions in SQLite transactions.

| Area | Planned work |
|---|---|
| SQLite schema | Add vote-stage records, confidential vote rows, public game-event rows, public discussion-message rows, and per-game player-score rows. Add room/round fields for phase, initial clue limit, current vote number, ballot status, and runoff state as needed. |
| Service rules | Add authoritative functions for automatically opening a ballot after the final required clue, submitting one valid vote, marking an absent player as abstaining, resolving the two-player cap, starting and resolving a single runoff, moving eliminated players to Ghost mode, awarding points, checking victory, and starting the next clue cycle. |
| Socket events | Add real-time events for vote state, ballot progress count, tally results, runoff state, reconnect notices, public game-log entries, public discussion messages, score changes, and final recap. Do not expose targets before tallying. |
| Host dashboard | Add a clue-cycle setting defaulting to 2, automatic-vote status, a controlled absent-voter action, discussion moderation, public log panel, score board, word-pack manager, and a recap marking tool. |
| Player screen | Add a locked/private ballot dialog, confirmation state, waiting progress, runoff notice, tally notification, always-available discussion panel, readable score/log panels, and Ghost-only access after elimination. |
| Data deletion | Extend `purgeRoomSession()` so new vote, score, and log records are deleted together with rooms, players, rounds, hints, and alerts. |
| Tests | Add unit, integration, Socket.IO, build, Windows, and browser checks for the full game flow and all privacy boundaries. |

## 10. Required tests before release

The release test must run an end-to-end room with enough players to exercise every result: two initial clue cycles; automatic vote opening after the final clue; private vote; a unique elimination; a two-way top tie; a three-way top tie; a one- and two-player runoff result; a persistent three-way runoff stalemate; an impostor elimination; a civilian elimination; a reconnect during clues; a reconnect during voting; an absent-voter abstention; public discussion messages and moderation; Ghost access; a civilian win; an impostor parity win; full score recap; and permanent room-session purge.

Automated regression tests must additionally verify that a client cannot vote twice, self-vote, vote as a Ghost, vote for an eliminated player, see another player’s live ballot, submit clues during voting, create more than two eliminations from a tally, bypass the single-runoff limit, or continue after a win. They must also verify message length, rate limiting, moderation, and room-session deletion for discussion records. The existing stale-room startup cleanup and host-disconnect recovery tests must continue passing.

## 11. Decisions to approve before coding

1. **Tie rule — approved:** a maximum of two players can be eliminated per voting result. When more than two players share the highest first-ballot total, a private re-vote starts among only those tied leaders. If that re-vote remains tied among three or more, nobody is eliminated and the game proceeds to the next clue cycle.
2. **Vote timing:** approve automatic vote opening immediately after the final required clue: two full clue cycles before the first vote, then one full clue cycle before every later vote if the game continues.
3. **Ballot rule:** approve one private, irreversible, no-self-vote ballot per active player; absent players become recorded abstentions only through host action.
4. **Role disclosure:** approve revealing each eliminated player’s role immediately to everyone, while keeping other roles and the word hidden until the final outcome.
5. **Win rule:** approve civilians winning at zero remaining impostors, and impostors winning when their remaining count is equal to or greater than remaining civilians.
6. **Scoring:** approve the proposed `+2 correct impostor vote`, `+1 impostor survives a tally`, `+4 winning side`, and optional host-selected `+1 memorable clue` model.
7. **Discussion:** approve an always-visible public discussion panel, including Ghost viewing/posting permissions, 180-character messages, rate limiting, and host moderation.
8. **Scores:** approve session-only per-game scores that are displayed during the recap and purged when the host terminates the room.

Once these decisions are confirmed, the implementation can be split into safe milestones: database/service rules first, private voting and elimination UI second, scoring/logs third, word-pack organization and manager fourth, and complete multi-device validation last.
