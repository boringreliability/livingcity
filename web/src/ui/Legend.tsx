import { useState, type ReactElement } from 'react';

const STORAGE_KEY = 'livingcity.legend.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // storage unavailable (private mode, blocked): default open
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore: the legend still works, it just isn't remembered
  }
}

/** Small drawn samples of each map symbol: every state reads by shape, pattern or lightness, never by hue alone. */
const SAMPLES: { label: string; svg: ReactElement }[] = [
  {
    label: 'Closed road (hatch, ring)',
    svg: (
      <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
        <defs>
          <pattern id="lg-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#0d0d0d" />
            <rect width="2.5" height="5" fill="#f2c229" />
          </pattern>
        </defs>
        <rect x="0" y="3" width="34" height="8" fill="url(#lg-hatch)" />
        <rect x="5" y="0" width="4" height="14" fill="#f7f7f7" stroke="#0a0a0a" strokeWidth="1" />
        <circle cx="24" cy="7" r="4.5" fill="none" stroke="#0a0a0a" strokeWidth="3.5" />
        <circle cx="24" cy="7" r="4.5" fill="none" stroke="#f7f7f7" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    label: 'Queued car (square, brake band)',
    svg: (
      <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
        <rect x="11" y="2" width="10" height="10" fill="#f5a833" />
        <rect x="11" y="2" width="3" height="10" fill="#381a05" />
      </svg>
    ),
  },
  {
    label: 'Moving car (long, slim)',
    svg: (
      <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
        <rect x="6" y="5" width="22" height="4" fill="#dbe5f2" />
      </svg>
    ),
  },
  {
    label: 'Congestion (wider, lighter)',
    svg: (
      <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
        <line x1="0" y1="4" x2="34" y2="4" stroke="#3d4550" strokeWidth="2" />
        <line x1="0" y1="10" x2="34" y2="10" stroke="#a88f61" strokeWidth="5" />
      </svg>
    ),
  },
  {
    label: 'Selected / followed (halo, brackets)',
    svg: (
      <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
        <line x1="0" y1="7" x2="18" y2="7" stroke="#ffffff" strokeWidth="6" />
        <line x1="0" y1="7" x2="18" y2="7" stroke="#3d4550" strokeWidth="2.5" />
        <path d="M22 4 V2 H25 M29 2 H32 V4 M32 10 V12 H29 M25 12 H22 V10" fill="none" stroke="#f7f7f7" strokeWidth="2" />
      </svg>
    ),
  },
];

/** `stacked`: the legend sits above the metrics (they do not fit side by side: `ui/bottomBand.ts`). */
export function Legend({ stacked = false }: { stacked?: boolean }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });
  };
  return (
    <section className={`panel legend${stacked ? ' stacked' : ''}`} aria-label="Legend">
      <button type="button" className="legend-toggle" aria-expanded={!collapsed} onClick={toggle}>
        Legend
      </button>
      {!collapsed && (
        <ul>
          {SAMPLES.map((s) => (
            <li key={s.label}>
              {s.svg}
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
