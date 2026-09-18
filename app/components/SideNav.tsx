'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { HomeIcon, RmtIcon } from './NavIcons';
import UserBadge from './UserBadge';

type SubItem = { label: string; href: string };
type NavItem = { label: string; href: string; icon: ReactNode; subItems?: SubItem[] };

const navItems: NavItem[] = [
  { label: 'Home', href: '/', icon: <HomeIcon /> },
  {
    label: 'RMT',
    href: '/rmt/tasks',
    icon: <RmtIcon />,
    subItems: [
      { label: 'Tasks', href: '/rmt/tasks' },
      { label: 'Availability', href: '/rmt/availability' },
      { label: 'Deployment', href: '/rmt/deployment' },
      // A project's plan lives under this one, at /rmt/projects/[prjc], so it needs no entry.
      { label: 'Projects', href: '/rmt/projects' },
    ],
  },
];

export const SIDENAV_COLLAPSED_COOKIE_NAME = 'erplens_sidenav_collapsed';

type SideNavProps = { initialCollapsed?: boolean };

/** Same shell as FastQuote: dark collapsible rail, red active item, state kept in a cookie. */
export default function SideNav({ initialCollapsed = false }: SideNavProps) {
  const pathname = usePathname() ?? '';
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    document.cookie = `${SIDENAV_COLLAPSED_COOKIE_NAME}=${collapsed ? 'true' : 'false'}; path=/; SameSite=Lax`;
  }, [collapsed]);

  return (
    <aside className="side-nav" data-collapsed={collapsed}>
      <div className="side-nav__header">
        <button
          type="button"
          className="side-nav__toggle"
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          <span aria-hidden="true" className="side-nav__toggle-icon">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <Image
          src="/telmaco_logo_transparent_negative.png"
          alt="Telmaco"
          width={110}
          height={28}
          className="side-nav__brand"
          priority
        />
      </div>
      <div className="side-nav__divider" aria-hidden="true" />
      <nav className="side-nav__items" aria-label="Primary">
        {navItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href.split('/').slice(0, 2).join('/'));
          const subItems = item.subItems ?? [];
          const subActive = subItems.some((sub) => pathname.startsWith(sub.href));
          const expanded = active || subActive;
          return (
            <div key={item.href} className="side-nav__group">
              <Link href={item.href} className="side-nav__link" data-active={active && !subActive} title={item.label}>
                <span className="side-nav__icon">{item.icon}</span>
                <span className="side-nav__label">{item.label}</span>
              </Link>
              {subItems.length > 0 && expanded && (
                <div className="side-nav__sub-items">
                  {subItems.map((sub) => (
                    <Link
                      key={sub.href}
                      href={sub.href}
                      className="side-nav__sub-link"
                      data-active={pathname.startsWith(sub.href)}
                      title={sub.label}
                    >
                      <span className="side-nav__sub-icon" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 4v12h12" />
                        </svg>
                      </span>
                      <span className="side-nav__sub-label">{sub.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="side-nav__divider" aria-hidden="true" />
      <UserBadge collapsed={collapsed} />
    </aside>
  );
}
