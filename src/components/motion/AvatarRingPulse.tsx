/** AvatarRingPulse — compatibility wrapper. Prefer AvatarRing. */
import React from 'react';
import AvatarRing, { type AvatarRingVariant } from './AvatarRing';

type Props = {
  children: React.ReactNode;
  active?: boolean;
  tone?: 'brand' | 'live' | 'story';
  size?: number;
  ringWidth?: number;
  style?: any;
};

export default function AvatarRingPulse({
  children,
  active = false,
  tone = 'brand',
  size = 34,
  ringWidth = 2,
  style,
}: Props) {
  const variant: AvatarRingVariant = tone;
  return (
    <AvatarRing
      variant={variant}
      animated={!!active || tone === 'live'}
      size={size}
      ringWidth={ringWidth}
      style={style}
    >
      {children}
    </AvatarRing>
  );
}
