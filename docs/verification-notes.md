# Verification Notes

## 2026-08-20 — Post-modularization bug audit

The refreshed entry screen was verified at 1280 × 720 and 375 × 812 after the client views were modularized. The desktop view retained the balanced two-column layout, and the phone view retained a readable stacked introduction and full-width entry card. Neither capture showed clipped content, horizontal overflow, or overlap around the User ID input and primary action.

The audit also restored the shared sealed-role privacy contract, made the top-bar connection indicator react to Socket.IO connect and disconnect events, corrected the advertised UI audit, and aligned local Windows documentation and standalone QA defaults with port 4300.

## 2026-08-18 — Entry Screen

The Warm Party Table entry view was reviewed at 1280×720 and 390×844. The desktop layout preserves the split editorial composition, and the phone layout stacks the brand story above a full-width join card. The User ID field and entry action remain visible and readable at both sizes. No clipping, horizontal overflow, or low-contrast text was observed in these captures.

## 2026-08-18 — Entry Workflow

Live browser testing exposed that pressing Return in the initial User ID field submitted an incomplete room join rather than respecting the Host1234 route. The entry form now treats both a button click and Return as the initial identity action: Host1234, in any letter case, opens the host path; any other non-empty User ID reveals the Room ID and password fields.

The corrected Host1234 route was re-tested successfully. It opened the host room-creation screen, and a test room (`ROSE7`) was created with the expected guest list, ready count, private-peek control, category toggles, exact-word menu, random-unused-word control, custom-pack upload control, impostor slider, and disabled-until-ready start control.

## Final verification

The JavaScript rule test suite passes three focused checks: no round may start until every active player is connected and ready, a word entry cannot be repeated in the same room session, and custom word-pack JSON is validated before use. A saved Socket.IO end-to-end verification (`scripts/verify-realtime.mjs`) also passed against the live server, covering host room setup, player and ghost joining, readiness, random role assignment, privacy-aware snapshots, player hint submission, host-only hint editing, turn updates, private peeking, and reveal flow.

The production client build completes successfully. The only build notice is Vite's advisory that the JavaScript bundle is above its default 500 kB review threshold; it does not block loading or gameplay. The current development log shows the live server running and Vite hot-module updates without client or server errors after the final accessibility changes.

The entry page was reviewed at both 1280×720 laptop and 390×844 phone dimensions. The desktop presentation keeps the story and join card in a balanced two-column layout; the phone presentation stacks them cleanly without clipped controls. The responsive application uses distinct phone-first player and ghost screens, while the three-column host command center is intended for the laptop. The full game-state data and real-time sequence were exercised through the Socket.IO verification because the host, player, and ghost roles require independent browser sessions.

Accessibility verification includes visible `:focus-visible` styling, semantic labels for presence indicators and icon-only leave/envelope controls, alert and status live regions, keyboard-operable buttons and native form controls, and a global `prefers-reduced-motion: reduce` mode that nearly eliminates nonessential animation and transitions. Haptic feedback uses the standard browser vibration API only when supported; all gameplay remains usable when vibration or audio is unavailable.

Practical VS Code port-forwarding and local-network instructions are provided in `docs/running-locally-and-tunneling.md`. The final JavaScript and JSX source is maintained on the user laptop at `C:\Users\aksh0\Desktop\Word_hunt\Word_Imposter`.

## Public player-screen check

The running application was exposed through its public forwarded URL and reopened outside the local server context. A prepared playing-round session was restored for player Asha. The public browser displayed the expected live player state: room code, live-presence label, random avatar, turn banner, closed private envelope, clue-note board, and fixed hint composer. In this sample round Asha was the impostor; the closed envelope showed only the role title and did not expose the hidden category or hint until opened. This verifies the tunnel-facing route and role-privacy presentation for a joining phone browser.

## Responsive and results checks

The new-session screen was captured at a 1280 × 720 laptop viewport and a 375 × 812 phone viewport. The laptop layout correctly presents the editorial game introduction and a separate entrance card side by side; the phone layout stacks the introduction and touch-first entrance card without clipping the title, input, or primary action. Earlier host-dashboard checks covered the desktop command-center grid and a narrow layout. The public active-player view showed the envelope, turn banner, clue board, and fixed composer; after a real `revealRoles` Socket.IO event, the same public player session updated to the results screen, showing the named impostor, secret word, category, and clue recap.

## Accessibility and tunnel audit

Every interactive screen was audited for native buttons and form controls, visible focus treatment, descriptive input labels, semantic headings, and explicit names on icon-only actions. The private role envelope announces its open/closed state with `aria-expanded`; settings toggles announce their state with `aria-pressed`; roster, nudge, kick, and host-edit actions have specific labels. `accessibility.css` provides high-contrast focus styling and disables nonessential animations and transitions for `prefers-reduced-motion` users.

The temporary public forwarding endpoint successfully served the game and synchronized a prepared player session. A physical phone and the user's personal VS Code tunnel cannot be operated from this environment; the exact remaining manual step is documented in `docs/running-locally-and-tunneling.md`: run `npm run dev` in `C:\Users\aksh0\Desktop\Word_hunt\Word_Imposter`, forward port 4300 in VS Code, share the generated forwarding URL, and join from a phone using a regular player User ID, room code, and password.

`npm run audit:ui` now provides a repeatable source-level check of the two responsive breakpoints, host layout collapse, phone entry stacking, fixed clue composer, envelope state, focus visibility, reduced-motion rules, and accessible labels/states on private role, player clue, host hint, roster, and toggle controls. It passed together with the game-rule suite and production build after the final accessibility-label update.
