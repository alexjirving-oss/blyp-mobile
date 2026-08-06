# Team + Battle dashboards (2026-08-06)

## Shipped
- **MyTeam** (`src/screens/MyTeamScreen.js`) — Team dashboard with hero crest, honest stats strip (wins/battles/gifts/active/weekly → `—` when unknown), Message / Set up battle / Invite CTAs, roster + presence, empty premium states.
- **Battle HQ** (`src/components/Battles/BattlesContent.js`) — Filters (All/Live/Upcoming/My team/Past), prearrange/promote/leaderboard/diary grid, team banner.
- **Teams** tab hero polish; CreateBattle team roster quick-picks; `blyp://team/{id}` deep link; Profile `openPromote`; BattleDetail rematch + promote link.
- Helpers: `computeTeamDashboardStats`, `subscribeMembersPresence`, `shareTeam`.

## Click-test (Alex / Melzi)
1. Chat → **Teams** → **My Team dashboard**
2. Chat → **Battles** → Battle HQ filters + Prearrange / Promote
3. From team: Message, Invite share, Set up battle

## Empty until members join
Wins / gifts / weekly stay `—`; roster empty CTA invites first member. No fake metrics.
