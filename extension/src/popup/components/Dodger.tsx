import "./Dodger.css";

// Looping welcome animation: a figure Matrix-leans under a quantum computer, an AI robot and an
// AI chip, swapping its shield's scheme between dodges. Pure SVG + CSS keyframes, so it follows the theme.
export function Dodger() {
  return (
    <svg className="dodger" viewBox="0 0 320 170" role="img" aria-label="A figure dodging quantum computers and AIs">
      <defs>
        <pattern id="dodger-lattice" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="1" />
        </pattern>
      </defs>
      <rect className="dodger-lattice" width="320" height="170" fill="url(#dodger-lattice)" />
      <line className="dodger-ground" x1="0" y1="158.5" x2="320" y2="158.5" />
      <ellipse className="dodger-shadow" cx="160" cy="159" rx="16" ry="2.5" />

      <g className="dodger-figure">
        <path className="dodger-legs" d="M151 158 L156 142 L160 126 M169 158 L165 142 L160 126" />
        <g className="dodger-upper">
          <path d="M160 126 V96 M160 104 L172 112" />
          <path className="dodger-arm" d="M147 116 L153 110 L160 104" />
          <circle cx="160" cy="86" r="9" />
          <path className="dodger-shield" d="M170 106 h12 v6 c0 5 -3 8 -6 9 c-3 -1 -6 -4 -6 -9 z" />
        </g>
      </g>

      {/* Quantum computer: a dilution-fridge chandelier. */}
      <g className="dodger-quantum">
        <g className="dodger-trail">
          <path d="M22 -10 h14 M24 0 h16 M22 10 h14" />
        </g>
        <g className="dodger-gold">
          <path className="dodger-rods" d="M-12 -12 V4 M-4 -12 V10 M4 -12 V10 M12 -12 V4" />
          <rect x="-17" y="-16" width="34" height="4" rx="1" />
          <rect x="-13" y="-5" width="26" height="3.5" rx="1" />
          <rect x="-9" y="4" width="18" height="3" rx="1" />
          <rect x="-5" y="10" width="10" height="4" rx="1" />
        </g>
        <circle className="dodger-glow" cx="0" cy="16" r="2" />
      </g>

      {/* AI robot. */}
      <g className="dodger-robot">
        <g className="dodger-trail">
          <path d="M22 -6 h14 M24 2 h16 M22 10 h14" />
        </g>
        <path className="dodger-antenna" d="M0 -9 V-14" />
        <circle className="dodger-beacon" cx="0" cy="-15" r="2.2" />
        <rect className="dodger-robot-head" x="-13" y="-9" width="26" height="20" rx="5" />
        <circle className="dodger-glow" cx="-5" cy="0" r="3" />
        <circle className="dodger-glow" cx="5" cy="0" r="3" />
        <rect className="dodger-glow" x="-4" y="6" width="8" height="1.6" rx="0.8" />
      </g>

      {/* AI chip, spinning. */}
      <g className="dodger-chip">
        <g className="dodger-trail">
          <path d="M20 -8 h14 M22 0 h16 M20 8 h14" />
        </g>
        <g className="dodger-spin">
          <path className="dodger-pins" d="M-6 -10 V-14 M0 -10 V-14 M6 -10 V-14 M-6 10 V14 M0 10 V14 M6 10 V14 M-10 -6 H-14 M-10 0 H-14 M-10 6 H-14 M10 -6 H14 M10 0 H14 M10 6 H14" />
          <rect className="dodger-chip-body" x="-10" y="-10" width="20" height="20" rx="3" />
          <text className="dodger-glow" x="0" y="3.5" textAnchor="middle">
            AI
          </text>
        </g>
      </g>
    </svg>
  );
}
