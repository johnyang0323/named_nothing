/**
 * Shown instead of the app when accounts are configured and nobody is
 * signed in: every day is saved to the account, so sign in first.
 */
import { html } from '../utils/dom.js';
import { renderAuthPanel, authActions, authInputs, authForms } from './authPanel.js';
import { horizonVisual } from './placeVisual.js';

export function render(_state, { ui }) {
  return html`
    <section class="screen welcome" aria-labelledby="welcome-title">
      <div class="welcome-visual">${horizonVisual(7)}</div>
      <p class="eyebrow">Not every day needs a plan. Every day can have a story.</p>
      <h1 id="welcome-title" class="display" tabindex="-1">계획 있는 것처럼<br>사는 하루</h1>
      <p class="lede">계획 없는 날, 문을 나설 작은 이유를 건네드려요. 오늘 다녀온 곳과 한 줄 기록은 계정에 저장돼서 어느 기기에서나 이어볼 수 있어요.</p>
      <section class="block" aria-label="로그인">
        ${renderAuthPanel(ui)}
      </section>
    </section>`;
}

export const actions = { ...authActions };
export const inputs = { ...authInputs };
export const forms = { ...authForms };
