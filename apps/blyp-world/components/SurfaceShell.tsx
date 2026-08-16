import type { ReactNode } from "react";

export function SurfaceShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-5 sm:py-12 md:py-16">
      {eyebrow ? (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--blyp-teal)]">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
        {title}
      </h1>
      <div className="mt-6 sm:mt-8">{children}</div>
    </div>
  );
}
