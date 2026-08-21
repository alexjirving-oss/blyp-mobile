/**
 * Legacy export path — canonical implementation is BlypWordmark.js
 * (lowercase "blyp" + warm-night coral pulse, mount settle + gentle idle).
 */
import BlypWordmarkImpl, {
  BlypWordmark,
  BLYP_LOGO_GRADIENT_COLORS,
  BLYP_WORDMARK_PULSE,
} from './BlypWordmark';

export { BlypWordmark, BLYP_LOGO_GRADIENT_COLORS, BLYP_WORDMARK_PULSE };
export default BlypWordmarkImpl;
