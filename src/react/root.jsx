/**
 * Bridge between the app's screen router (main.js) and React screens.
 * A screen module that exports `Component` is drawn with React into the
 * view; the others keep returning HTML. Rendering is synchronous, so focus
 * handling, titles and tests see the new screen right away.
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

const roots = new WeakMap();

export function renderReact(container, Component, props) {
  let root = roots.get(container);
  if (!root) {
    container.innerHTML = '';
    root = createRoot(container);
    roots.set(container, root);
  }
  flushSync(() => root.render(<Component {...props} />));
}

export function unmountReact(container) {
  const root = roots.get(container);
  if (!root) return;
  root.unmount();
  roots.delete(container);
}
