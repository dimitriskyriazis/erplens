import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: ReactNode;
  /** Controls on the left of the title (FastQuote puts the quick search here). */
  leftActions?: ReactNode;
  /** Controls on the right of the title (buttons, selectors, counts). */
  rightActions?: ReactNode;
  children?: ReactNode;
};

/** FastQuote's header row: actions left, title centred, actions right, content below. */
export default function PageHeader({ title, leftActions, rightActions, children }: PageHeaderProps) {
  return (
    <>
      <div className="page-header-row">
        <div className="page-header-side page-header-side--left">{leftActions}</div>
        <h1 className="page-heading">{title}</h1>
        <div className="page-header-side page-header-side--right">{rightActions}</div>
      </div>
      {children}
    </>
  );
}
