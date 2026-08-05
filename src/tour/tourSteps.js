/**
 * Guided tour step catalogue.
 *
 * Each step can optionally navigate so the real surface is visible behind the
 * coach card. Dating is soft-mentioned for free users (no hard paywall push).
 *
 * targetId  — live measure from TourTarget (preferred)
 * targetZone — heuristic spotlight when measure is missing
 * preferredPlacement — hint for callout placement (above|below|left|right)
 */

export const TOUR_VERSION = 2;

/**
 * @param {{ hasDating?: boolean, hasGames?: boolean }} opts
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   body: string,
 *   icon: string,
 *   accent?: string,
 *   navigate?: { type: string, name?: string, params?: object, select?: string },
 *   targetId?: string,
 *   targetZone?: string,
 *   preferredPlacement?: 'above' | 'below' | 'left' | 'right',
 *   soft?: boolean,
 * }>}
 */
export function buildTourSteps({ hasDating = true, hasGames = false } = {}) {
  const steps = [
    {
      id: 'welcome',
      title: 'Welcome to Blyp',
      body: 'A quick tour of the places you’ll use every day. Skip anytime — replay from Settings or Notifications.',
      icon: 'sparkles',
      navigate: { type: 'tab', name: 'Home', select: 'A' },
      targetZone: 'center.soft',
      preferredPlacement: 'below',
    },
    {
      id: 'forYou',
      title: 'For You',
      body: 'Your personalized feed opens first. Swipe through clips and discover people who match your vibe.',
      icon: 'flame',
      navigate: { type: 'homeForYou' },
      targetId: 'headerTab:A',
      targetZone: 'header.forYou',
      preferredPlacement: 'below',
    },
    {
      id: 'forYouActions',
      title: 'For You actions',
      body: 'Use the side actions to like, comment, share, and save. That’s how you engage without leaving the feed.',
      icon: 'heart',
      navigate: { type: 'homeForYou' },
      targetZone: 'foryou.actions',
      preferredPlacement: 'left',
    },
    {
      id: 'homeHub',
      title: 'Home hub',
      body: 'Tap the Home chip beside For You for your hub — Jump in, live rails, Dating, and quick shortcuts.',
      icon: 'home',
      navigate: { type: 'homeHub' },
      targetId: 'headerTab:home',
      targetZone: 'header.home',
      preferredPlacement: 'below',
    },
    {
      id: 'create',
      title: 'Create (+)',
      body: 'Tap the teal + to open Create — photo, video, library, or resume a draft. This is how you post on Blyp.',
      icon: 'add-circle',
      navigate: { type: 'tab', name: 'Home' },
      targetId: 'create',
      targetZone: 'tab.create',
      preferredPlacement: 'above',
    },
    {
      id: 'goLive',
      title: 'Go Live',
      body: 'Inside Create, tap Go Live to start a stream. Hosts go live from the same + button.',
      icon: 'radio',
      navigate: { type: 'tab', name: 'Home' },
      targetId: 'create',
      targetZone: 'tab.create',
      preferredPlacement: 'above',
    },
    {
      id: 'blypSearch',
      title: 'Ask Blyp',
      body: 'Blyp is your AI search — ask about games, places, people, or what’s on. Open it from Home or Search.',
      icon: 'search',
      navigate: { type: 'stack', name: 'Blyp' },
      targetZone: 'center.soft',
      preferredPlacement: 'below',
    },
    {
      id: 'live',
      title: 'Live',
      body: 'Chat/Games → Live shows who’s streaming now. Tap in to watch or chat with the room.',
      icon: 'videocam',
      navigate: { type: 'chatTab', select: 'notifications' },
      targetId: 'headerTab:notifications',
      targetZone: 'header.tabs',
      preferredPlacement: 'below',
    },
    {
      id: 'battlesPromote',
      title: 'Battles & Promote',
      body: 'Battles are head-to-head live matchups. Promote (coins) can boost battles or spotlight — use it lightly when you’re ready.',
      icon: 'trophy',
      navigate: { type: 'chatTab', select: 'battles' },
      targetId: 'headerTab:battles',
      targetZone: 'header.tabs',
      preferredPlacement: 'below',
    },
    {
      id: 'messenger',
      title: 'Messages',
      body: 'Messages holds DMs, calls, and notifications. Stay close with people you meet on Blyp.',
      icon: 'chatbubble',
      navigate: { type: 'tab', name: 'Messenger', select: 'chats' },
      targetZone: 'tab.messenger',
      preferredPlacement: 'above',
    },
    {
      id: 'rooms',
      title: 'Rooms',
      body: 'Rooms are live voice hangouts. Jump in to talk with people who share your vibe — ambassadors help keep energy high.',
      icon: 'mic',
      navigate: { type: 'stack', name: 'Rooms' },
      targetZone: 'center.soft',
      preferredPlacement: 'below',
    },
    {
      id: 'profile',
      title: 'Your profile',
      body: 'Edit your look, wallet, subscription, and settings from Profile. This is your home base on Blyp.',
      icon: 'person',
      navigate: { type: 'tab', name: 'Profile' },
      targetZone: 'tab.profile',
      preferredPlacement: 'above',
    },
  ];

  if (hasDating) {
    steps.push({
      id: 'dating',
      title: 'Dating',
      body: 'Meet people who share your world. Open Dating from Chat → Dating, Home → Jump in, or Profile → Menu. Included with Plus / trial.',
      icon: 'heart',
      navigate: { type: 'chatTab', select: 'dating' },
      targetId: 'headerTab:dating',
      targetZone: 'header.tabs',
      preferredPlacement: 'below',
    });
  } else {
    steps.push({
      id: 'dating',
      title: 'Dating (Plus)',
      body: 'Dating lives on Chat → Dating, Home → Jump in, or Profile → Menu. Free users see plans; Plus / trial unlocks Discover.',
      icon: 'heart',
      soft: true,
      navigate: { type: 'chatTab', select: 'dating' },
      targetId: 'headerTab:dating',
      targetZone: 'header.tabs',
      preferredPlacement: 'below',
    });
  }

  if (hasGames) {
    steps.push({
      id: 'games',
      title: 'Games',
      body: 'Chat/Games → Games covers Marble Race (start from your live) and Battle game (Artillery). Classic lobby stay paused.',
      icon: 'game-controller',
      navigate: { type: 'chatTab', select: 'games' },
      targetId: 'headerTab:games',
      targetZone: 'header.tabs',
      preferredPlacement: 'below',
    });
  }

  steps.push({
    id: 'rankings',
    title: 'Rankings',
    body: 'See who’s climbing — gifts, streams, and glory boards. Rankings are open to everyone.',
    icon: 'trophy',
    navigate: { type: 'stack', name: 'Rankings' },
    targetZone: 'center.soft',
    preferredPlacement: 'below',
  });

  steps.push({
    id: 'done',
    title: 'You’re set',
    body: 'That’s the tour. Explore at your own pace — reopen anytime from Notifications or Settings. Skip was always available too.',
    icon: 'checkmark-circle',
    navigate: { type: 'tab', name: 'Home', select: 'A' },
    targetZone: 'center.soft',
    preferredPlacement: 'below',
  });

  return steps;
}
