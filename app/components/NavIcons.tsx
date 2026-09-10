import type { ReactNode } from 'react';

type IconProps = { size?: number };

const s = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  'aria-hidden': true as const,
  focusable: false as const,
});

export function HomeIcon({ size = 22 }: IconProps): ReactNode {
  return (
    <svg {...s(size)}>
      <path d="M3 10.5L12 3l9 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M5 9.5v9a1.5 1.5 0 001.5 1.5h4V15h3v5h4a1.5 1.5 0 001.5-1.5v-9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Projects: a document with lines, same family as FastQuote's Offers icon. */
export function ProjectsIcon({ size = 22 }: IconProps): ReactNode {
  return (
    <svg {...s(size)}>
      <path d="M14 3H6.5A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
      <path d="M8 13h8M8 16.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** RMT: people, the resources being scheduled. */
export function RmtIcon({ size = 22 }: IconProps): ReactNode {
  return (
    <svg {...s(size)}>
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <circle cx="17" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path d="M3 20c0-3 2.5-5.5 6-5.5s6 2.5 6 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M15 14.5c2 0 4 1.2 4.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Maintenance: a gear. */
export function MaintenanceIcon({ size = 22 }: IconProps): ReactNode {
  return (
    <svg {...s(size)}>
      <path d="M12 15.5A3.5 3.5 0 1012 8.5a3.5 3.5 0 000 7z" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Tasks: a list. */
export function TasksIcon({ size = 22 }: IconProps): ReactNode {
  return (
    <svg {...s(size)}>
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
