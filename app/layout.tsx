import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './styles/base.css';
import './styles/layout.css';
import './styles/page.css';
import './styles/auth.css';
import SideNav, { SIDENAV_COLLAPSED_COOKIE_NAME } from './components/SideNav';
import { AuthProvider } from './components/AuthProvider';

export const metadata: Metadata = {
  title: 'TelERP',
  description: 'Operational views and stats over Soft1 for RMT',
  icons: { icon: '/favicon.ico' },
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get(SIDENAV_COLLAPSED_COOKIE_NAME)?.value === 'true';

  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <div className="app-shell">
            <SideNav initialCollapsed={initialCollapsed} />
            <div className="app-content">{children}</div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
