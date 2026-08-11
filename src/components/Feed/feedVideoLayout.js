/**
 * Shared For You / MediaViewer video frame layout.
 *
 * Home's tab bar is `position: 'absolute'` (see App.js MainTabs), so the feed
 * cell height includes the area under the footer. MediaViewer is full-window
 * with bottom chrome (comment stream ~96 + home indicator). In both cases the
 * geometric center of an absolute-fill video sits optically low between the
 * top pill/header band and the footer.
 *
 * Negative Y shifts the decoded frame up without moving overlays (bottom action
 * bar, user pill, comment stream). Applied as a transform only — never changes
 * the reserved full-bleed cell size when natural aspect arrives.
 */
export const FEED_VIDEO_VERTICAL_NUDGE_Y = -20;
