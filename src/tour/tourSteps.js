/**
 * Guided tour step catalogue.
 *
 * Each step can optionally navigate so the real surface is visible behind the
 * coach card. Dating is soft-mentioned for free users (no hard paywall push).
 */

export const TOUR_VERSION = 1;

/**
 * @param {{ hasDating?: boolean }} opts
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   body: string,
 *   icon: string,
 *   accent?: string,
 *   navigate?: { type: 'tab' | 'stack' | 'homeForYou', name?: string, params?: object },
 *   soft?: boolean,
 * }>}
 */
export function buildTourSteps({ hasDating = true } = {}) {
  const steps = [
    {
      id: 'welcome',
      title: 'Welcome to Blyp',
      body: 'A quick tour of the places you’ll use every day. Skip anytime — you can replay it from Settings.',
      icon: 'sparkles',
      navigate: { type: 'tab', name: 'Home' },
    },
    {
      id: 'forYou',
      title: 'For You',
      body: 'Your personalized feed opens first. Tap the pinned Home chip beside For You to open your Home base hub (Jump in, Dating, live rails).',
      icon: 'flame',
      navigate: { type: 'homeForYou' },
    },
    {
      id: 'create',
      title: 'Create',
      body: 'Tap the teal + in the tab bar to post a clip, photo, or story. That’s how you show up on Blyp.',
      icon: 'add-circle',
      navigate: { type: 'tab', name: 'Home' },
    },
    {
      id: 'blypSearch',
      title: 'Ask Blyp',
      body: 'Blyp is your AI search — ask about games, places, people, or what’s on. Open it anytime from Home or Search.',
      icon: 'search',
      navigate: { type: 'stack', name: 'Blyp' },
    },
    {
      id: 'live',
      title: 'Live & battles',
      body: 'Chat/Games is where Live streams, battles, and team play live. Catch a stream or jump into a battle.',
      icon: 'radio',
      navigate: { type: 'tab', name: 'Chat' },
    },
    {
      id: 'messenger',
      title: 'Messages & Rooms',
      body: 'Messages keeps DMs and notifications. Rooms are voice hangouts with friends — open Rooms from here or Battles.',
      icon: 'chatbubble',
      navigate: { type: 'tab', name: 'Messenger' },
    },
    {
      id: 'rooms',
      title: 'Rooms',
      body: 'Jump into a Room to talk live with people who share your vibe. Ambassadors help keep the energy high.',
      icon: 'mic',
      navigate: { type: 'stack', name: 'Rooms' },
    },
    {
      id: 'profile',
      title: 'Your profile',
      body: 'Edit your look, wallet, subscription, and settings from Profile. This is your home base on Blyp.',
      icon: 'person',
      navigate: { type: 'tab', name: 'Profile' },
    },
  ];

  if (hasDating) {
    steps.push({
      id: 'dating',
      title: 'Dating',
      body: 'Meet people who share your world. Open Dating from Home → Jump in, Profile → Menu, or the Chat menu. Included with Plus / trial.',
      icon: 'heart',
      navigate: { type: 'stack', name: 'Dating' },
    });
  } else {
    steps.push({
      id: 'dating',
      title: 'Dating (Plus)',
      body: 'Dating is on Home → Jump in, Profile → Menu, or Chat → menu. Free users see plans; Plus / trial unlocks Discover.',
      icon: 'heart',
      soft: true,
      navigate: { type: 'tab', name: 'Profile' },
    });
  }

  steps.push({
    id: 'rankings',
    title: 'Rankings',
    body: 'See who’s climbing — gifts, streams, and glory boards. Rankings are open to everyone.',
    icon: 'trophy',
    navigate: { type: 'stack', name: 'Rankings' },
  });

  steps.push({
    id: 'done',
    title: 'You’re set',
    body: 'That’s the tour. Explore at your own pace — and reopen this anytime from Notifications or Settings.',
    icon: 'checkmark-circle',
    navigate: { type: 'tab', name: 'Home' },
  });

  return steps;
}
