(() => {
  const main = document.getElementById('main');
  if (!main) return;
  let route;
  let queued = false;
  function enter() {
    queued = false;
    const nextRoute = main.dataset.page || 'home';
    if (!main.children.length || route === nextRoute) return;
    route = nextRoute;
    // Only page sections enter; answer updates and chess moves stay stationary.
    const sections = Array.from(main.children).filter(node =>
      !node.matches('script, style, .quiz-battle-card, .chess-board'));
    sections.slice(0, 6).forEach((node, index) => {
      node.style.setProperty('--arrival-delay', `${Math.min(index * 45, 180)}ms`);
      node.classList.add('arrival-enter');
      node.addEventListener('animationend', () => {
        node.classList.remove('arrival-enter');
        node.style.removeProperty('--arrival-delay');
      }, { once: true });
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enter);
  }
  new MutationObserver(schedule).observe(main, { childList: true });
  window.addEventListener('hashchange', schedule);
  schedule();
})();
