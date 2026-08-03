import { useState } from "react";
import { initials } from "../lib/format";

type Props = {
  photoURL?: string | null;
  displayName?: string;
  username?: string;
  userId: string;
  size?: number;
  borderRadius?: number;
  avatarFrame?: string | null;
};

export default function AdminUserAvatar({
  photoURL,
  displayName,
  username,
  userId,
  size = 30,
  borderRadius,
  avatarFrame,
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const label = displayName || username || userId;
  const radius = borderRadius ?? Math.round(size * 0.3);
  const isGoldCrown = avatarFrame === "gold_crown";
  const showPhoto = Boolean(photoURL) && !imgFailed;

  const inner = showPhoto ? (
    <img
      src={photoURL!}
      alt=""
      loading="lazy"
      onError={() => setImgFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        objectFit: "cover",
        display: "block",
      }}
    />
  ) : (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, rgba(0,210,190,0.25), rgba(103,232,249,0.18))",
        color: "var(--brand-light)",
        fontSize: Math.max(10, Math.round(size * 0.36)),
        fontWeight: 800,
      }}
    >
      {initials(label, userId)}
    </span>
  );

  if (!isGoldCrown) {
    return <span style={{ flexShrink: 0, lineHeight: 0 }}>{inner}</span>;
  }

  return (
    <span
      style={{
        flexShrink: 0,
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 6,
        height: size + 6,
      }}
    >
      <span style={{ position: "absolute", top: -8, fontSize: Math.max(12, Math.round(size * 0.28)), zIndex: 2 }}>👑</span>
      <span
        style={{
          borderRadius: "50%",
          border: "3px solid #F5C542",
          boxShadow: "0 0 10px rgba(245,197,66,0.45)",
          overflow: "hidden",
          lineHeight: 0,
        }}
      >
        {inner}
      </span>
    </span>
  );
}
