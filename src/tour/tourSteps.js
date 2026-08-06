/**
 * Guided product tour — cinematic first-run / replayable beats.
 *
 * Design rules:
 *  - Short titles + one-line bodies (no walls of text)
 *  - One primary CTA label per step
 *  - Prefer live TourTarget measures; zones are layout-flexible fallbacks
 *  - Optional beat visuals (gifts wow, Stage Desk peek) render in the overlay
 *
 * Covers: For You → engage → Gifts → Home customize → Live + Stage Desk →
 * Promote → Messages → Profile.
 */

export const TOUR_VERSION = 3;

/**
 * @param {{ hasDating?: boolean, hasGames?: boolean }} opts
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   body: string,
 *   cta: string,
 *   icon: string,
 *   accent?: string,
 *   navigate?: { type: string, name?: string, params?: object, select?: string },
 *   targetId?: string,
 *   targetIds?: string[],
 *   targetZone?: string,
 *   preferredPlacement?: 'above' | 'below' | 'left' | 'right',
 *   beat?: 'intro' | 'gifts' | 'stageDesk' | 'done',
 *   soft?: boolean,
 * }>}
 */
export function buildTourSteps({ hasDating = true, hasGames = false } = {}) {
  // Dating / games remain discoverable in-app; the tour stays lean and product-critical.
  void hasDating;
  void hasGames;

  return [
    {
      id: 'forYou',
      title: 'For You',
      body: 'Your feed opens first — swipe clips, find people who match your vibe.',
      cta: 'Show me',
      icon: 'flame',
      navigate: { type: 'homeForYou' },
      targetId: 'headerTab:A',
      targetIds: ['headerTab:A', 'home.forYou'],
      targetZone: 'header.forYou',
      preferredPlacement: 'below',
      beat: 'intro',
    },
    {
      id: 'engage',
      title: 'React in place',
      body: 'Like, comment, share — right on the clip. No leaving the feed.',
      cta: 'Next',
      icon: 'heart',
      navigate: { type: 'homeForYou' },
      targetId: 'feedActions',
      targetIds: ['feedActions', 'feed.engage'],
      targetZone: 'foryou.actions',
      preferredPlacement: 'above',
    },
    {
      id: 'gifts',
      title: 'Gifts that land',
      body: 'Send a gift and the room feels it — cinematic, not a tip jar.',
      cta: 'Wow',
      icon: 'gift',
      navigate: { type: 'homeForYou' },
      targetId: 'feedGift',
      targetIds: ['feedGift', 'feed.gift'],
      targetZone: 'feed.gift',
      preferredPlacement: 'above',
      beat: 'gifts',
    },
    {
      id: 'homeCustomize',
      title: 'Make Home yours',
      body: 'Jump to Home, then customize rails — live, interests, shortcuts.',
      cta: 'Customize',
      icon: 'grid',
      navigate: { type: 'homeHub' },
      targetId: 'homeCustomize',
      targetIds: ['homeCustomize', 'headerTab:home'],
      targetZone: 'home.customize',
      preferredPlacement: 'below',
    },
    {
      id: 'liveStageDesk',
      title: 'Live + Stage Desk',
      body: 'Watch who’s live. Hosts get Stage Desk — your on-stream control surface.',
      cta: 'Peek',
      icon: 'videocam',
      navigate: { type: 'chatTab', select: 'notifications' },
      targetId: 'headerTab:notifications',
      targetIds: ['headerTab:notifications', 'create'],
      targetZone: 'header.live',
      preferredPlacement: 'below',
      beat: 'stageDesk',
    },
    {
      id: 'promote',
      title: 'Promote',
      body: 'Boost a battle, feed post, or spotlight — coin-powered reach when you’re ready.',
      cta: 'Next',
      icon: 'megaphone',
      navigate: { type: 'profileTab', select: 'Promote' },
      targetId: 'headerTab:Promote',
      targetIds: ['headerTab:Promote', 'promote.studio'],
      targetZone: 'header.promote',
      preferredPlacement: 'below',
    },
    {
      id: 'messages',
      title: 'Messages',
      body: 'DMs, calls, and pings — stay close to people you meet on Blyp.',
      cta: 'Next',
      icon: 'chatbubble',
      navigate: { type: 'tab', name: 'Messenger', select: 'chats' },
      targetId: 'tab.messenger',
      targetIds: ['tab.messenger'],
      targetZone: 'tab.messenger',
      preferredPlacement: 'above',
    },
    {
      id: 'profile',
      title: 'Your profile',
      body: 'Look, wallet, settings — and Replay tour anytime from Menu or Settings.',
      cta: 'Finish',
      icon: 'person',
      navigate: { type: 'profileTab', select: 'My Profile' },
      targetId: 'headerTab:My Profile',
      targetIds: ['headerTab:My Profile', 'tab.profile'],
      targetZone: 'tab.profile',
      preferredPlacement: 'above',
      beat: 'done',
    },
  ];
}
