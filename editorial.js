(() => {
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    majors: '<path d="M12 5v16M3 3c4 0 6 1 9 3 3-2 5-3 9-3v15c-4 0-6 1-9 3-3-2-5-3-9-3Z"/>',
    quiz: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 12h16M12 4v16"/>',
    review: '<path d="M20 7v5h-5M4 17v-5h5M5 8a7 7 0 0 1 12-3l3 3M4 16l3 3a7 7 0 0 0 12-3"/>',
    settings: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  };
  const labels = { home: '홈', majors: '단어장', quiz: '체스', review: '복습', settings: '내 기록' };
  function refine() {
    const connection = document.getElementById('connection');
    const offlineMessage = '오프라인 · 저장된 단어로 학습 중';
    if (connection && !navigator.onLine && !connection.querySelector('button')
        && connection.textContent !== offlineMessage) {
      connection.textContent = offlineMessage;
    }
    document.querySelectorAll('.nav-tab').forEach(button => {
      const name = button.dataset.action?.replace('nav-', '');
      const icon = button.querySelector('.nav-icon');
      const label = button.querySelector('.nav-label');
      if (icon && icons[name] && !icon.querySelector('svg')) {
        icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
      }
      if (label && labels[name] && label.textContent !== labels[name]) label.textContent = labels[name];
    });
    const main = document.querySelector('main');
    const today = main?.querySelector('.today-card');
    const hero = main?.querySelector('.garden-hero');
    if (today && hero && hero.previousElementSibling !== today) main.insertBefore(today, hero);
    document.querySelectorAll('.garden-hero h1').forEach(heading => {
      if (heading.textContent !== '오늘도, 한 단어씩.') heading.textContent = '오늘도, 한 단어씩.';
    });
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; refine(); });
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('online', refine);
  window.addEventListener('offline', refine);
  refine();
})();
