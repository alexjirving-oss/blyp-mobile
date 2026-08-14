/**
 * Canonical Blyp wordmark — matches mobile header (`BlypLogo.js`) and
 * blyp.world SiteChrome: lowercase "blyp" + teal pulse dot.
 * Asset source of truth: public/brand/ (copied from tip assets/brand + icon.png).
 */
type Size = "sm" | "md" | "lg" | "hero";

const SIZE_PX: Record<Size, number> = {
  sm: 22,
  md: 28,
  lg: 36,
  hero: 48,
};

export default function BlypWordmark({
  size = "md",
  className = "",
  withTile = false,
}: {
  size?: Size;
  className?: string;
  /** When true, show launcher-style app tile beside the wordmark */
  withTile?: boolean;
}) {
  const fontSize = SIZE_PX[size];
  const dot = Math.max(5, fontSize * 0.16);

  return (
    <span className={`blyp-wordmark ${className}`.trim()} style={{ fontSize }}>
      {withTile && (
        <img
          className="blyp-wordmark-tile"
          src="/brand/blyp-app-tile-512.png"
          alt=""
          width={Math.round(fontSize * 1.15)}
          height={Math.round(fontSize * 1.15)}
          aria-hidden
        />
      )}
      <span className="blyp-wordmark-text" aria-label="blyp">
        blyp
        <span
          className="blyp-wordmark-dot"
          style={{
            width: dot,
            height: dot,
            borderRadius: "50%",
            marginLeft: dot * 0.45,
            marginBottom: fontSize * 0.14,
          }}
          aria-hidden
        />
      </span>
    </span>
  );
}
