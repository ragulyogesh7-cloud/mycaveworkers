(() => {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const stage = document.createElement('div');
  stage.className = 'ambient-stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.innerHTML = `
    <div class="ambient-grid"></div>
    <div class="ambient-orb ambient-orb-cyan"></div>
    <div class="ambient-orb ambient-orb-violet"></div>
    <div class="ambient-orb ambient-orb-lime"></div>
    <div class="ambient-beam"></div>
    <div class="ambient-cursor"></div>
    <div class="ambient-noise"></div>
    <div class="ambient-vignette"></div>
  `;
  document.body.prepend(stage);
  document.body.classList.add('motion-ready');

  const progress = document.createElement('div');
  progress.className = 'motion-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.append(progress);

  const autoRevealSelectors = [
    '.hero', '.section-intro', '.how-card', '.glass', '.composer', '.panel-block', '.results-block',
    '.analyst-hero', '.analyst-status-card', '.analyst-panel', '.settings-card', '.settings-panel',
    '.employee-panel', '.login-card', '.legal-card', '.route-card', '.control-panel', '.connector',
    '.room-message', '.room-directory-card'
  ].join(',');
  document.querySelectorAll(autoRevealSelectors).forEach((element) => {
    if (!element.classList.contains('motion-reveal')) element.classList.add('motion-reveal');
  });
  document.querySelectorAll('.glass, .composer, .panel-block, .results-block, .analyst-panel, .settings-card, .employee-panel, .route-card, .control-panel, .connector')
    .forEach((element) => element.classList.add('motion-tilt'));
  document.querySelectorAll('.route-card, .composer, .control-panel, .login-card').forEach((element) => element.classList.add('motion-shimmer'));

  const revealTargets = document.querySelectorAll('.motion-reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach((element) => element.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    revealTargets.forEach((element) => revealObserver.observe(element));
  }

  if (!reduceMotion && window.matchMedia?.('(pointer: fine)').matches) {
    const cursor = stage.querySelector('.ambient-cursor');
    let pointerFrame = 0;
    let lastPointer = null;
    window.addEventListener('pointermove', (event) => {
      lastPointer = event;
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        if (!lastPointer) return;
        document.documentElement.style.setProperty('--cursor-x', `${lastPointer.clientX - 90}px`);
        document.documentElement.style.setProperty('--cursor-y', `${lastPointer.clientY - 90}px`);
      });
    }, { passive: true });

    document.querySelectorAll('.motion-tilt').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - .5;
        const y = (event.clientY - rect.top) / rect.height - .5;
        card.style.setProperty('--tilt-y', `${x * 3.4}deg`);
        card.style.setProperty('--tilt-x', `${y * -3.4}deg`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.removeProperty('--tilt-x');
        card.style.removeProperty('--tilt-y');
      });
    });

    if (cursor) {
      cursor.style.transform = 'translate3d(var(--cursor-x, 50vw), var(--cursor-y, 40vh), 0)';
    }
  }

  let scrollFrame = 0;
  const updateProgress = () => {
    scrollFrame = 0;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const amount = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    progress.style.transform = `scaleX(${amount})`;
  };
  window.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(updateProgress);
  }, { passive: true });
  updateProgress();
})();
