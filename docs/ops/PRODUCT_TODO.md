# Blyp — product to-do list

Saved from product brief session (2026-06-25).  
**Active queue** = items marked **Open** only. **Parked** = unsure / hand to colleague; not in active queue.

---

## Status key

| Status | Meaning |
|--------|---------|
| **Done** | Closed — fixed or no longer a problem |
| **Partial** | Started in codebase; not complete |
| **Open** | On the active queue — intend to do |
| **Parked** | Set aside — unsure or waiting on someone else |

---

## Phase 0 — Ship blockers (Done)

| ID | Item | Status |
|----|------|--------|
| L-01 | Live crashes when starting | Done |
| L-02 | Live ends but guest still sees it as live | Done |
| L-03 | Camera off but host UI still shows live/camera on | Done |
| L-04 | Cannot drop | Done |
| E-01 | Coins disappeared | Done |
| N-01 | Notifications arrive late | Done |

---

## Phase 1 — Live & feed UX

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L-05 | Host cannot gift / join live | **Parked** | Unsure; staff member will know |
| L-06 | Tap screen to like (live) | Open | |
| L-07 | Cannot like videos | Open | |
| L-08 | Likes only show as individual likes | Open | |
| L-09 | Chat covers whole screen | Open | |

---

## Phase 2 — Account & onboarding

| ID | Item | Status |
|----|------|--------|
| A-01 | Terms pop up every login | Open |
| A-02 | Sparse onboarding after signup (inbox, avatar, terms only) | Open |
| A-03 | TikTok import shows "Cancelled" but continues | Open |

---

## Phase 3 — Teams / agency

| ID | Item | Status | Notes |
|----|------|--------|-------|
| T-01 | 60% in-team / 50% solo payout split | Open | |
| T-02 | Leader sees member hours live | Partial | `MyTeamScreen` roster |
| T-03 | Leader sees member battle count | Partial | Battles listed; may need polish |
| T-04 | Leader sees average battle scores | Open | |
| T-05 | Agency member leaderboard | Open | |
| T-06 | Button: broadcast leaderboard to all members (in Blyp) | Open | |
| T-07 | Leader schedules battle between two members (not self) | Partial | Arrange-battle flow exists |
| T-08 | Group message to all members | Partial | Leader composer exists |

---

## Phase 4 — Admin operator tools

| ID | Item | Status |
|----|------|--------|
| AD-01 | Admin override view count on posts | Open |
| AD-02 | Admin override like count on posts | Open |

---

## Summary

| Status | Count |
|--------|------:|
| Done | 6 |
| Partial | 4 |
| Parked | 1 |
| Open | 13 |

---

## Active queue (Open only)

Work these next, in suggested order:

1. **Phase 1:** L-06, L-07, L-08, L-09  
2. **Phase 2:** A-01, A-02, A-03  
3. **Phase 3:** T-01, T-04, T-05, T-06 (+ verify Partial items T-02, T-03, T-07, T-08)  
4. **Phase 4:** AD-01, AD-02  

**Parked (not in queue):** L-05 — revisit when staff confirms gift/join-live behaviour.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-25 | Initial save from product brief; Phase 0 marked Done; L-05 Parked (gift + join live) |
