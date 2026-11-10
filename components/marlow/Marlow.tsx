/**
 * Marlow: a calm capybara clerk with reading glasses and a clipboard. Original artwork drawn for
 * this project as inline SVG (see TRADEMARKS.md).
 *
 * moods: calm (default), working (pencil out, eyes on the clipboard), success (raised paw and a
 * tick on the clipboard), empty (cup of tea, nothing to do).
 */
export type MarlowMood = "calm" | "working" | "success" | "empty";

export function Marlow({ mood = "calm", size = 96, title }: { mood?: MarlowMood; size?: number; title?: string }) {
  const label = title ?? `Marlow the capybara clerk, ${mood === "success" ? "pleased" : mood === "working" ? "at work" : mood === "empty" ? "having tea" : "calm"}`;
  const fur = "#a9764b";
  const furDark = "#7b5234";
  const furLight = "#dcb992";
  const ink = "#2b1d12";
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      {/* body */}
      <ellipse cx="60" cy="92" rx="34" ry="24" fill={fur} />
      <ellipse cx="60" cy="97" rx="21" ry="16" fill={furLight} />
      {/* ears */}
      <ellipse cx="38" cy="27" rx="7" ry="6" fill={furDark} />
      <ellipse cx="82" cy="27" rx="7" ry="6" fill={furDark} />
      <ellipse cx="38" cy="28" rx="3.5" ry="3" fill="#c98d6b" />
      <ellipse cx="82" cy="28" rx="3.5" ry="3" fill="#c98d6b" />
      {/* head: the blocky capybara muzzle */}
      <rect x="28" y="26" width="64" height="52" rx="22" fill={fur} />
      <rect x="37" y="50" width="46" height="30" rx="14" fill={furLight} />
      {/* nose and mouth */}
      <ellipse cx="60" cy="58" rx="7.5" ry="4.8" fill={furDark} />
      <ellipse cx="57" cy="57.5" rx="1.4" ry="1.1" fill={ink} />
      <ellipse cx="63" cy="57.5" rx="1.4" ry="1.1" fill={ink} />
      {mood === "success" ? (
        <path d="M51 67 Q60 76 69 67" fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <path d="M54 68 Q60 72 66 68" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      )}
      {/* eyes */}
      {mood === "working" ? (
        <>
          <path d="M43 44 Q47 47 51 44" fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M69 44 Q73 47 77 44" fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        </>
      ) : mood === "success" ? (
        <>
          <path d="M43 45 Q47 40 51 45" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M69 45 Q73 40 77 45" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="47" cy="44" r="2.6" fill={ink} />
          <circle cx="73" cy="44" r="2.6" fill={ink} />
          <circle cx="47.9" cy="43.1" r="0.8" fill="#fff" />
          <circle cx="73.9" cy="43.1" r="0.8" fill="#fff" />
        </>
      )}
      {/* reading glasses */}
      <g fill="none" stroke="#1f2a24" strokeWidth="2">
        <circle cx="47" cy="44" r="8" fill="rgb(255 255 255 / 0.18)" />
        <circle cx="73" cy="44" r="8" fill="rgb(255 255 255 / 0.18)" />
        <path d="M55 43 Q60 40 65 43" />
        <path d="M39 42 L31 39" strokeLinecap="round" />
        <path d="M81 42 L89 39" strokeLinecap="round" />
      </g>
      {mood === "empty" ? (
        <>
          {/* a cup of tea */}
          <path d="M70 84 h18 v9 a8 8 0 0 1 -8 8 h-2 a8 8 0 0 1 -8 -8 z" fill="#fff" stroke="#1f2a24" strokeWidth="1.8" />
          <path d="M88 87 q7 1 5 7 q-1 4 -6 4" fill="none" stroke="#1f2a24" strokeWidth="1.8" />
          <path d="M75 79 q-2 -4 1 -7 M82 79 q-2 -4 1 -7" fill="none" stroke="#8b958f" strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="72" cy="92" rx="6" ry="5" fill={furDark} />
          <ellipse cx="42" cy="98" rx="7" ry="5.5" fill={furDark} />
        </>
      ) : (
        <>
          {/* clipboard */}
          <rect x="66" y="74" width="30" height="38" rx="4" fill="#f4efe2" stroke="#1f2a24" strokeWidth="2" />
          <rect x="75" y="70" width="12" height="8" rx="2.5" fill="#55625b" />
          {mood === "success" ? (
            <path d="M72 94 l6 6 l12 -13" fill="none" stroke="#2e7d5b" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <g stroke="#55625b" strokeWidth="2" strokeLinecap="round">
              <path d="M72 86 h18" />
              <path d="M72 93 h18" />
              <path d="M72 100 h11" />
            </g>
          )}
          {/* paws */}
          <ellipse cx="68" cy="97" rx="6" ry="5" fill={furDark} />
          {mood === "success" ? (
            <ellipse cx="30" cy="74" rx="6.5" ry="5.5" fill={furDark} transform="rotate(-25 30 74)" />
          ) : (
            <ellipse cx="42" cy="98" rx="7" ry="5.5" fill={furDark} />
          )}
          {mood === "working" && (
            <g transform="rotate(35 50 96)">
              <rect x="40" y="93" width="24" height="4" rx="1" fill="#e2a93b" />
              <path d="M64 93 l5 2 l-5 2 z" fill={ink} />
            </g>
          )}
          {mood === "success" && (
            <g fill="#e2a93b">
              <path d="M17 52 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" />
              <path d="M101 22 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 z" />
            </g>
          )}
        </>
      )}
    </svg>
  );
}

/** Small round mark for the header and avatars. */
export function MarlowMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <rect width="48" height="48" rx="12" fill="#2f5d4a" />
      <ellipse cx="15" cy="13" rx="4" ry="3.4" fill="#7b5234" />
      <ellipse cx="33" cy="13" rx="4" ry="3.4" fill="#7b5234" />
      <rect x="9" y="11" width="30" height="27" rx="11" fill="#a9764b" />
      <rect x="14" y="24" width="20" height="14" rx="7" fill="#dcb992" />
      <ellipse cx="24" cy="28.5" rx="4" ry="2.6" fill="#7b5234" />
      <g fill="none" stroke="#12201a" strokeWidth="1.6">
        <circle cx="18" cy="20" r="4.2" fill="rgb(255 255 255 / 0.25)" />
        <circle cx="30" cy="20" r="4.2" fill="rgb(255 255 255 / 0.25)" />
        <path d="M22.2 19.5 Q24 18.3 25.8 19.5" />
      </g>
      <circle cx="18" cy="20" r="1.4" fill="#2b1d12" />
      <circle cx="30" cy="20" r="1.4" fill="#2b1d12" />
    </svg>
  );
}
