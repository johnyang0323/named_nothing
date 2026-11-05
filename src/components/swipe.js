/**
 * Swipe a card left or right (Tinder-style), with buttons kept as the
 * accessible equivalent.
 *
 * - Horizontal drags move the card; vertical drags still scroll the page
 *   (touch-action: pan-y + axis lock after a few pixels).
 * - Touch and pen can start anywhere on the card; a mouse only on the
 *   photo, so text stays selectable on desktop.
 * - Buttons, links and form fields never start a swipe.
 * - Past ~28% of the card width, or a quick flick, the card flies out and
 *   onCommit('right' | 'left') runs; otherwise it springs back.
 * - The card exposes --swipe (-1…1) so CSS can fade in the hints.
 */
const AXIS_LOCK_PX = 8;
const COMMIT_RATIO = 0.28;
const FLICK_SPEED = 0.6; // px per ms

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function attachSwipe(card, { onCommit, mouseArea = null }) {
  let start = null;
  let axis = null;
  let dx = 0;
  let pointerId = null;
  let dragged = false;

  card.style.touchAction = 'pan-y';

  const setOffset = (x, animate) => {
    card.style.transition = animate ? 'transform 0.25s ease' : 'none';
    card.style.transform = x ? `translateX(${x}px) rotate(${x / 40}deg)` : '';
    const ratio = Math.max(-1, Math.min(1, x / (card.offsetWidth * COMMIT_RATIO || 1)));
    card.style.setProperty('--swipe', String(ratio));
  };

  const reset = () => {
    start = null;
    axis = null;
    pointerId = null;
    card.classList.remove('is-dragging');
  };

  card.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || start) return;
    if (event.target.closest('button, a, input, textarea, select, label')) return;
    if (event.pointerType === 'mouse' && mouseArea && !event.target.closest(mouseArea)) return;
    start = { x: event.clientX, y: event.clientY, t: performance.now() };
    axis = null;
    dx = 0;
    dragged = false;
    pointerId = event.pointerId;
  });

  card.addEventListener('pointermove', (event) => {
    if (!start || event.pointerId !== pointerId) return;
    const mx = event.clientX - start.x;
    const my = event.clientY - start.y;
    if (!axis) {
      if (Math.abs(mx) < AXIS_LOCK_PX && Math.abs(my) < AXIS_LOCK_PX) return;
      axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (axis === 'y') {
        reset();
        return;
      }
      try {
        card.setPointerCapture?.(pointerId);
      } catch {
        /* pointer already gone */
      }
      card.classList.add('is-dragging');
    }
    dragged = true;
    dx = mx;
    setOffset(dx, false);
    event.preventDefault();
  });

  const finish = (event) => {
    if (!start || event.pointerId !== pointerId) return;
    if (axis !== 'x') {
      reset();
      return;
    }
    const elapsed = Math.max(1, performance.now() - start.t);
    const speed = Math.abs(dx) / elapsed;
    const width = card.offsetWidth || 1;
    const commit = event.type !== 'pointercancel' && (Math.abs(dx) > width * COMMIT_RATIO || (speed > FLICK_SPEED && Math.abs(dx) > 40));
    reset();
    if (!commit) {
      setOffset(0, true);
      return;
    }
    const direction = dx > 0 ? 'right' : 'left';
    if (reducedMotion()) {
      setOffset(0, false);
      onCommit(direction);
      return;
    }
    setOffset(Math.sign(dx) * width * 1.3, true);
    setTimeout(() => onCommit(direction), 200);
  };
  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', finish);

  // a drag must not also count as a click on whatever is under the finger
  card.addEventListener(
    'click',
    (event) => {
      if (dragged) {
        event.stopPropagation();
        event.preventDefault();
        dragged = false;
      }
    },
    true,
  );
}

const LEARNED_KEY = 'plannish-swipe-learned';

export function hasLearnedSwipe() {
  try {
    return localStorage.getItem(LEARNED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSwipeLearned() {
  try {
    localStorage.setItem(LEARNED_KEY, '1');
  } catch {
    /* ignore */
  }
}
