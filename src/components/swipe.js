/**
 * Swipe a card (Tinder-style), with buttons kept as the accessible equivalent.
 *
 * - Left / right drags move the card sideways; with `allowDown`, a drag
 *   downward pulls it down (to keep it). Otherwise vertical drags scroll.
 * - Touch and pen can start anywhere on the card; a mouse only on the
 *   photo, so text stays selectable on desktop.
 * - Buttons, links and form fields never start a swipe.
 * - Past ~28% of the card width (or ~22% of its height going down), or a
 *   quick flick, the swipe commits: onCommit('left' | 'right' | 'down').
 *   `canCommit(direction)` can refuse (the card springs back and
 *   onRefused(direction) runs). Sideways commits fly the card out first;
 *   a downward commit hands the card to onCommit to animate itself.
 * - The card exposes --swipe (-1…1, sideways) and --swipe-down (0…1).
 */
const AXIS_LOCK_PX = 8;
const COMMIT_RATIO = 0.28;
const DOWN_RATIO = 0.22;
const FLICK_SPEED = 0.6; // px per ms

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function attachSwipe(card, { onCommit, mouseArea = null, allowDown = false, canCommit = () => true, onRefused = () => {} }) {
  let start = null;
  let axis = null;
  let dx = 0;
  let dy = 0;
  let pointerId = null;
  let dragged = false;

  card.style.touchAction = allowDown ? 'none' : 'pan-y';

  const setOffset = (x, y, animate) => {
    card.style.transition = animate ? 'transform 0.25s ease' : 'none';
    card.style.transform = x || y ? `translate(${x}px, ${y}px) rotate(${x / 40}deg)` : '';
    const ratio = Math.max(-1, Math.min(1, x / (card.offsetWidth * COMMIT_RATIO || 1)));
    const down = Math.max(0, Math.min(1, y / (card.offsetHeight * DOWN_RATIO || 1)));
    card.style.setProperty('--swipe', String(ratio));
    card.style.setProperty('--swipe-down', String(down));
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
    dy = 0;
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
      if (axis === 'y' && !(allowDown && my > 0)) {
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
    if (axis === 'x') {
      dx = mx;
      setOffset(dx, 0, false);
    } else {
      dy = Math.max(0, my);
      setOffset(0, dy, false);
    }
    event.preventDefault();
  });

  const finish = (event) => {
    if (!start || event.pointerId !== pointerId) return;
    if (!axis) {
      reset();
      return;
    }
    const elapsed = Math.max(1, performance.now() - start.t);
    const sideways = axis === 'x';
    const distance = sideways ? Math.abs(dx) : dy;
    const size = sideways ? card.offsetWidth || 1 : card.offsetHeight || 1;
    const speed = distance / elapsed;
    const commit =
      event.type !== 'pointercancel' && (distance > size * (sideways ? COMMIT_RATIO : DOWN_RATIO) || (speed > FLICK_SPEED && distance > 40));
    reset();
    const direction = sideways ? (dx > 0 ? 'right' : 'left') : 'down';
    if (!commit) {
      setOffset(0, 0, true);
      return;
    }
    if (!canCommit(direction)) {
      setOffset(0, 0, true);
      onRefused(direction);
      return;
    }
    if (direction === 'down' || reducedMotion()) {
      if (direction !== 'down') setOffset(0, 0, false);
      onCommit(direction, card);
      return;
    }
    setOffset(Math.sign(dx) * card.offsetWidth * 1.3, 0, true);
    setTimeout(() => onCommit(direction, card), 200);
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
