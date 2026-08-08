/**
 * Guided product tour — autonomous page beats (first-run + Menu replay).
 *
 * Per stop: PRE_MS clean page → TEXT_MS explanation card → POST_MS clean → next.
 * No spotlight / slit / tap-to-advance primary flow.
 */

export const TOUR_VERSION = 4;

/** Clean page preview before the explanation card. */
export const TOUR_PRE_MS = 1000;
/** Explanation text visible on top of the live page. */
export const TOUR_TEXT_MS = 2000;
/** Clean beat after the card before auto-advancing. */
export const TOUR_POST_MS = 1000;

/**
 * @param {{ hasDating?: boolean, hasGames?: boolean }} opts
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   body: string,
 *   icon: string,
 *   soft?: boolean,
 *   navigate?: { type: string, name?: string, params?: object, select?: string },
 * }>}
 */
export function buildTourSteps({ hasDating = true, hasGames = false } = {}) {
  // Dating / games stay discoverable in-app; tour stays page-critical only.
  void hasDating;
  void hasGames;

  return [
    {
      id: 'forYou',
      title: 'For You',
      body: 'Your feed — swipe clips, react, and send gifts without leaving the vibe.',
      icon: 'flame',
      navigate: { type: 'homeForYou' },
    },
    {
      id: 'home',
      title: 'Home',
      body: 'Your hub — live rails, interests, and shortcuts you can customize.',
      icon: 'grid',
      navigate: { type: 'homeHub' },
    },
    {
      id: 'live',
      title: 'Live',
      body: "See who's on now. Hosts get Stage Desk — chat, gifts, guests, goals.",
      icon: 'videocam',
      navigate: { type: 'chatTab', select: 'notifications' },
    },
    {
      id: 'promote',
      title: 'Promote',
      body: 'Boost a battle, post, or spotlight when you want more reach.',
      icon: 'megaphone',
      navigate: { type: 'profileTab', select: 'Promote' },
    },
    {
      id: 'messages',
      title: 'Messages',
      body: 'DMs, calls, and pings — stay close to people you meet on Blyp.',
      icon: 'chatbubble',
      navigate: { type: 'tab', name: 'Messenger', select: 'chats' },
    },
    {
      id: 'profile',
      title: 'Your profile',
      body: 'Look, wallet, settings — replay this tour anytime from Menu.',
      icon: 'person',
      navigate: { type: 'profileTab', select: 'My Profile' },
    },
  ];
}
