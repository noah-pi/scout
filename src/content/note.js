// The one-line note Scout leaves where it folded something away: a quiet
// capsule that reads on light and dark pages alike, and says what was hidden
// and why. Clicking it brings the thing back.
export const NOTE_CSS = `
  .scout-note { all: initial; box-sizing: border-box; display: flex; align-items: center; gap: 7px;
    width: fit-content; max-width: 100%; margin: 6px 0 12px; padding: 5px 11px 5px 8px; cursor: pointer;
    border-radius: 999px; border: 1px solid rgba(120, 120, 125, .28); background: rgba(120, 120, 125, .07);
    font: 600 11.5px/1.35 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    letter-spacing: .2px; color: #78787d; -webkit-font-smoothing: antialiased;
    transition: border-color .2s cubic-bezier(.22, .8, .3, 1), color .2s cubic-bezier(.22, .8, .3, 1); }
  .scout-note:hover { border-color: rgba(46, 158, 102, .55); }
  .scout-note:active { opacity: .75; }
  .scout-note:focus-visible { outline: 2px solid #2e9e66; outline-offset: 3px; }
  .scout-note svg { all: initial; flex: none; width: 13px; height: 13px; }
  .scout-note svg path { fill: none; stroke: #2e9e66; stroke-width: 1.8; stroke-linecap: round; }
  .scout-note svg circle { fill: #2e9e66; }
  .scout-note-why { all: initial; font: inherit; letter-spacing: inherit; color: inherit; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .scout-note-show { all: initial; font: inherit; font-weight: 700; letter-spacing: inherit; color: #2e9e66; flex: none; }`;

const SVG = 'http://www.w3.org/2000/svg';
// Scout's mark: an open ring around a dot, in Source Kit's green.
const MARK = 'M15.9 4.1A8.4 8.4 0 1 0 18.4 10';

// Returns a note for `block`; the caller inserts it and marks the block hidden.
export function makeNote(className, why, onShow) {
  const note = document.createElement('button');
  note.type = 'button';
  note.className = `scout-note ${className}`;
  note.setAttribute('aria-label', `${why}. Show it.`);
  // Built node by node: some pages enforce Trusted Types on innerHTML.
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', MARK);
  const dot = document.createElementNS(SVG, 'circle');
  for (const [k, v] of [['cx', 10], ['cy', 10], ['r', 3.2]]) dot.setAttribute(k, v);
  svg.append(path, dot);
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
