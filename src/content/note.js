// The one-line note Scout leaves where it folded something away: a quiet
// capsule that reads on light and dark pages alike, and says what was hidden
// and why. Clicking it brings the thing back.
export const NOTE_CSS = `
  .scout-note { all: initial; box-sizing: border-box; display: flex; align-items: center; gap: 6px;
    width: fit-content; max-width: 100%; margin: 6px 0 12px; padding: 4px 11px 4px 9px; cursor: pointer;
    border-radius: 999px; border: .5px solid rgba(134, 134, 139, .32); background: rgba(134, 134, 139, .08);
    font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', system-ui, sans-serif;
    letter-spacing: -.003em; color: #86868b; -webkit-font-smoothing: antialiased;
    transition: background .15s ease, transform .12s ease; }
  .scout-note:hover { background: rgba(134, 134, 139, .14); }
  .scout-note:active { transform: scale(.98); }
  .scout-note:focus-visible { outline: 3px solid rgba(10, 132, 255, .45); outline-offset: 1px; }
  .scout-note svg { all: initial; flex: none; width: 13px; height: 13px; color: inherit; }
  .scout-note svg path { fill: none; opacity: 1; stroke: currentColor; stroke-width: 1.7;
    stroke-linecap: round; stroke-linejoin: round; }
  .scout-note-why { all: initial; font: inherit; color: inherit; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .scout-note-show { all: initial; font: inherit; font-weight: 600; color: #0a84ff; flex: none; }`;

const SVG = 'http://www.w3.org/2000/svg';
const EYE_OFF = 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.4 8 2.8 10.2 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.6 4.8-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2';

// Returns a note for `block`; the caller inserts it and marks the block hidden.
export function makeNote(className, why, onShow) {
  const note = document.createElement('button');
  note.type = 'button';
  note.className = `scout-note ${className}`;
  note.setAttribute('aria-label', `${why}. Show it.`);
  // Built node by node: some pages enforce Trusted Types on innerHTML.
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', EYE_OFF);
  svg.append(path);
  note.append(svg);
  const text = document.createElement('span');
  text.className = 'scout-note-why';
  text.textContent = why;
  const show = document.createElement('span');
  show.className = 'scout-note-show';
  show.textContent = 'Show';
  note.append(text, show);
  note.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onShow();
    note.remove();
  });
  return note;
}
