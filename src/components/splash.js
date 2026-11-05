import { html } from '../utils/dom.js';

/** Brief state while the saved session is restored. */
export function render() {
  return html`
    <section class="screen splash" aria-busy="true">
      <h1 class="title" tabindex="-1">계획 있는 것처럼 사는 하루</h1>
      <p class="lede">잠시만요…</p>
    </section>`;
}
