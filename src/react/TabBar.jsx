/**
 * The bottom menu: glisse's iOS 26 tab bar (liquid glass that springs and
 * lenses between tabs). 발견 · 경로 · [logo = 오늘] · 나의 하루 · 함께.
 */
import { TabBar } from 'glisse';
import { renderReact } from './root.jsx';

const svg = (d) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
);

const ICONS = {
  route: svg('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'),
  day: svg('<path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16z"/><path d="M5 16a3.5 3.5 0 0 1 3.5-3.5H19M9 8h6"/>'),
  together: svg('<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="8" r="2.6"/><path d="M15.5 13.6A4.6 4.6 0 0 1 21 18"/>'),
};

/** My photo (or initial) as the 계정 tab's icon. */
function AccountIcon({ account }) {
  return (
    <span className="avatar avatar-tab" data-account-button aria-hidden="true">
      <span className="avatar-initial">{account?.initial || '나'}</span>
      {account?.src ? <img className="avatar-img" src={account.src} alt="" referrerPolicy="no-referrer" /> : null}
    </span>
  );
}

/**
 * 경로 · 나의 하루 · [logo] · 함께 · 계정. The logo is "today": it opens the
 * current recommendation once the day has started (발견), otherwise the
 * place / time / mood step (오늘).
 */
function AppTabBar({ current, routeCount, started, account, inbox }) {
  const items = [
    {
      value: 'route',
      href: '#route',
      icon: ICONS.route,
      label: (
        <span className="tab-label">
          경로{routeCount ? <span className="tab-count" data-route-count>{routeCount}</span> : null}
        </span>
      ),
    },
    { value: 'day', href: '#day', icon: ICONS.day, label: '나의 하루' },
    {
      value: 'today',
      href: started ? '#discover' : '#home',
      icon: <img className="tab-logo" src="./favicon.svg" alt="" width="30" height="30" />,
      label: '오늘',
    },
    {
      value: 'together',
      href: '#together',
      icon: ICONS.together,
      label: (
        <span className="tab-label">
          함께{inbox ? <span className="tab-count tab-alert" data-inbox-count aria-label={`새 알림 ${inbox}개`}>{inbox > 9 ? '9+' : inbox}</span> : null}
        </span>
      ),
    },
    { value: 'account', href: '#account', icon: <AccountIcon account={account} />, label: account?.label || '계정' },
  ];
  const selected = current === 'home' || current === 'discover' ? 'today' : current;
  const known = items.some((i) => i.value === selected);
  return <TabBar className="app-tabbar" aria-label="주요 메뉴" items={items} value={known ? selected : null} />;
}

export function renderTabBar(container, props) {
  renderReact(container, AppTabBar, props);
}
