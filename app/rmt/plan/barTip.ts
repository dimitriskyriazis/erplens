'use client';

/**
 * One shared hover card for every bar in the plan timeline, instead of the browser's
 * native title tooltip. Imperative on purpose: hundreds of bars can be on screen, and a
 * React state change per hover would re-render cells for nothing. Text is written with
 * textContent, never HTML, because remarks come straight from Soft1.
 */
export type BarTip = { heading: string; rows: Array<[label: string, value: string]> };

let card: HTMLDivElement | null = null;

function ensureCard(): HTMLDivElement {
  if (card && document.body.contains(card)) return card;
  card = document.createElement('div');
  card.className = 'tl-tip';
  card.hidden = true;
  card.setAttribute('role', 'tooltip');
  document.body.appendChild(card);
  return card;
}

export function showBarTip(anchor: HTMLElement, tip: BarTip): void {
  const el = ensureCard();
  el.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'tl-tip-heading';
  heading.textContent = tip.heading;
  el.appendChild(heading);
  const dl = document.createElement('dl');
  tip.rows.forEach(([label, value]) => {
    if (!value) return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  });
  el.appendChild(dl);

  // Measure, then place below the bar, or above it when there is no room; keep it on screen.
  el.hidden = false;
  el.style.left = '0px';
  el.style.top = '0px';
  const rect = anchor.getBoundingClientRect();
  const { width, height } = el.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 6);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

export function hideBarTip(): void {
  if (card) card.hidden = true;
}
