/* ═════════════════════════════════════════════════════════════════
   JJMMC Landing — smooth scroll, scroll-reveal, nav effects,
   image fallbacks, and hero parallax.
   ═════════════════════════════════════════════════════════════════ */

(() => {
  const scroller  = document.getElementById('scroller');
  const nav       = document.getElementById('nav');
  const hamburger = document.getElementById('hamburger');
  const heroBg    = document.querySelector('.hero-bg');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Smooth scroll for in-page anchors inside the snap container ───
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      // Close mobile menu if open
      nav.classList.remove('open');
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });

  // ─── Nav glass/shadow on scroll ───
  const onScroll = () => {
    const y = scroller.scrollTop;
    nav.classList.toggle('scrolled', y > 20);

    // Subtle hero parallax — background moves a touch slower than foreground
    if (heroBg && y < window.innerHeight && !reduceMotion) {
      heroBg.style.transform = `scale(1.06) translateY(${y * 0.25}px)`;
    }
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ─── Scroll-reveal with IntersectionObserver ───
  const revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, {
      root: scroller,
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.12,
    });
    revealEls.forEach(el => io.observe(el));
  } else {
    // Fallback — show everything
    revealEls.forEach(el => el.classList.add('is-visible'));
  }

  // ─── Image fallback system ───
  // Elements with data-bg="/images/foo.jpg" get the image set as a CSS
  // background only if the file actually loads. If not, the soft gradient
  // defined in the CSS remains, keeping the page beautiful even when no
  // photos have been dropped in yet.
  document.querySelectorAll('[data-bg]').forEach(el => {
    const src = el.getAttribute('data-bg');
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      el.style.setProperty('--bg-url', `url('${src}')`);
      el.classList.add('has-img');
    };
    img.src = src;
  });

  // Same fallback for hero / cta inline background-image styles.
  [{ el: document.querySelector('.hero-bg'),  src: '/images/hero.jpg'  },
   { el: document.querySelector('.cta-bg'),   src: '/images/cta-bg.jpg' }
  ].forEach(({ el, src }) => {
    if (!el) return;
    const img = new Image();
    img.onload  = () => { el.style.backgroundImage = `url('${src}'), ${getComputedStyle(el).background}`;
                          el.classList.add('has-img'); };
    img.onerror = () => { el.style.backgroundImage = ''; }; // keep gradient only
    img.src = src;
  });

  // ─── Hamburger (mobile) ───
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      nav.classList.toggle('open');
    });
  }

  // ─── Forward to portal if a session already exists ───
  // If the user lands on "/" but is already logged in, the server redirects.
  // This is a safety net for client-side browsed back nav.
  try {
    fetch('/api/me', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.user) {
          const suffix = (data.user.program || 'UG') === 'PG' ? '-pg' : '';
          // Only forward if they explicitly click login; don't yank them away.
          const loginBtns = document.querySelectorAll('a[href="/login.html"]');
          loginBtns.forEach(a => {
            a.textContent = a.textContent.replace(/Login[^↑]*/i, `Continue as ${data.user.full_name.split(' ')[0]} `);
            a.setAttribute('href', `/${data.user.role}${suffix}/`);
          });
        }
      }).catch(() => {});
  } catch (_) { /* silent */ }

  // ═════════════════════════════════════════════════════════════════
  //  PWA — Service worker + install prompt
  // ═════════════════════════════════════════════════════════════════

  // Register the service worker (enables launch-from-home-screen & offline).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* silent */ });
    });
  }

  // ── Install button wiring ──
  // Chrome/Edge/Samsung browsers fire beforeinstallprompt — we capture the
  // event, reveal our buttons, and replay it on click. Safari on iOS has no
  // such API, so we detect iOS and show step-by-step instructions instead.
  const navInstall   = document.getElementById('installBtn');
  const heroInstall  = document.getElementById('heroInstallBtn');
  const iosModal     = document.getElementById('iosInstallModal');
  const iosClose     = document.getElementById('iosInstallClose');
  const iosOk        = document.getElementById('iosInstallOk');
  let deferredPrompt = null;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;        // iOS Safari flag

  const ua        = navigator.userAgent || '';
  const isIOS     = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  const isSafari  = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const isIOSSafari = isIOS && isSafari;

  function showInstallBtns() {
    navInstall && navInstall.classList.remove('hidden');
    heroInstall && heroInstall.classList.remove('hidden');
  }
  function hideInstallBtns() {
    navInstall && navInstall.classList.add('hidden');
    heroInstall && heroInstall.classList.add('hidden');
  }

  // Android/Desktop install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone) showInstallBtns();
  });

  // If iOS Safari & not already installed, show our custom install button
  // that opens an instructions modal (Apple blocks programmatic install).
  if (isIOSSafari && !isStandalone) showInstallBtns();

  async function handleInstallClick() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') hideInstallBtns();
      return;
    }
    if (isIOSSafari && iosModal) {
      iosModal.hidden = false;
      document.body.classList.add('modal-open');
    }
  }

  navInstall  && navInstall.addEventListener('click', handleInstallClick);
  heroInstall && heroInstall.addEventListener('click', handleInstallClick);

  function closeIosModal() {
    if (!iosModal) return;
    iosModal.hidden = true;
    document.body.classList.remove('modal-open');
  }
  iosClose && iosClose.addEventListener('click', closeIosModal);
  iosOk    && iosOk.addEventListener('click', closeIosModal);
  iosModal && iosModal.addEventListener('click', (e) => {
    if (e.target === iosModal) closeIosModal();
  });

  // Hide buttons once installed (the `appinstalled` event fires once).
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBtns();
  });
})();
