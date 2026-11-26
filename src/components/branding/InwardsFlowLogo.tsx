// InwardsFlow Enterprise WMS â€” Official Brand Logo & Lockup
// InwardsFlow Receiving & Inventory Engine
import Image from 'next/image';
import React, { useState } from 'react';

interface InwardsFlowLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'login' | 'lg';
  showText?: boolean;
}

export function InwardsFlowLogo({
  className = '',
  size = 'md',
  showText = false,
}: InwardsFlowLogoProps) {
  const [imageError, setImageError] = useState(false);

  const dimensionMap = {
    sm: { px: 32, class: 'w-8 h-8' },
    md: { px: 36, class: 'w-9 h-9 max-w-[36px] max-h-[36px]' },
    login: { px: 40, class: 'w-10 h-10 max-w-[40px] max-h-[40px]' },
    lg: { px: 48, class: 'w-12 h-12 max-w-[48px] max-h-[48px]' },
  }[size] || { px: 36, class: 'w-9 h-9 max-w-[36px] max-h-[36px]' };

  const iconElement = (
    <div className={`relative shrink-0 flex items-center justify-center ${dimensionMap.class} ${className}`}>
      {!imageError ? (
        <Image
          unoptimized
          width={dimensionMap.px}
          height={dimensionMap.px}
          src="/logo/InwardsFlow-App-Icon.svg"
          alt="InwardsFlow Logo"
          className="w-full h-full object-contain shrink-0"
          onError={() => setImageError(true)}
        />
      ) : (
        /* High-fidelity fallback SVG if image fails */
        <svg
          viewBox="110 55 280 280"
          className="w-full h-full shrink-0"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="InwardsFlow Vector Fallback"
        >
          {/* TOP CONTAINER ROOF */}
          <polygon points="248,68 140,130 206,168 314,106" fill="rgb(var(--accent))" />
          {/* LEFT DOOR WALL */}
          <polygon points="140,130 206,168 206,271 140,233" fill="rgb(var(--ink))" />
          <polygon points="206,168 214,163 214,266 206,271" fill="rgb(var(--deep))" />
          <polygon points="148,144 170,157 170,241 148,228" fill="rgb(var(--accent))" />
          <polygon points="176,160 198,173 198,257 176,244" fill="rgb(var(--accent))" />
          {/* CUTAWAY PALLET TILES */}
          <polygon points="214,168 318,108 366,136 366,192 260,254 214,250" fill="rgb(var(--surface))" />
          <polygon points="216,172 250,152 271,164 237,184" fill="rgb(var(--go))" stroke="rgb(var(--surface))" strokeWidth="3" />
          <polygon points="250,152 284,132 305,144 271,164" fill="rgb(var(--go))" stroke="rgb(var(--surface))" strokeWidth="3" />
          <polygon points="284,132 318,112 339,124 305,144" fill="rgb(var(--go))" stroke="rgb(var(--surface))" strokeWidth="3" />
          <polygon points="237,184 271,164 295,178 261,198" fill="rgb(var(--go))" stroke="rgb(var(--surface))" strokeWidth="3" />
          <polygon points="271,164 305,144 329,158 295,178" fill="rgb(var(--accent))" stroke="rgb(var(--surface))" strokeWidth="3" />
          <polygon points="305,144 339,124 363,138 329,158" fill="rgb(var(--accent))" stroke="rgb(var(--surface))" strokeWidth="3" />
        </svg>
      )}
    </div>
  );

  if (!showText) {
    return iconElement;
  }

  return (
    <div className="flex items-center gap-2.5 shrink-0">
      {iconElement}
      <span className="text-lg font-bold tracking-tight text-ink whitespace-nowrap">
        InwardsFlow
      </span>
    </div>
  );
}
