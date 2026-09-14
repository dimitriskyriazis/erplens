import Image from 'next/image';
import Link from 'next/link';
import styles from './page.module.css';
import { TasksIcon } from './components/NavIcons';

const quickLinks = [
  { label: 'RMT Tasks', href: '/rmt/tasks', icon: <TasksIcon size={28} />, ready: true },
];

export default function Page() {
  return (
    <main className={styles.homePage}>
      <header className={styles.topBar}>
        <div className={styles.brandRow}>
          <h1 className={styles.brandTitle}>
            <span className={styles.brandAccent}>Tel</span>ERP
          </h1>
          <div className={styles.poweredBy}>
            <Image src="/telmaco.jpg" alt="Telmaco logo" width={480} height={160} className={styles.logoImage} loading="eager" />
          </div>
        </div>
        <hr className={styles.divider} />
        <nav className={styles.quickLinks}>
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.quickLink}${link.ready ? '' : ` ${styles.quickLinkMuted}`}`}
            >
              <span className={styles.quickLinkIcon}>{link.icon}</span>
              <span className={styles.quickLinkLabel}>{link.label}</span>
              {!link.ready && <span className={styles.quickLinkHint}>coming next</span>}
            </Link>
          ))}
        </nav>
      </header>
    </main>
  );
}
