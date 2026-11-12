/* GLT.ui: DOM skeleton, screens, aria-live announcer, toasts. Area: ui. Contract: ARCHITECTURE.md §11.5.
 * BOOTSTRAP (architect): a minimal working mount so app/demos run on day one. Owner: ui builder replaces it,
 * keeping the API and the region class names (.glt-stage, .glt-panel, .glt-footer, #glt-live, #glt-alert). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  let refs = null;
  let screen = 'menu';

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function mount(root) {
    if (refs) return refs;
    root = root || document.getElementById('app') || document.body.appendChild(el('div', null, { id: 'app' }));
    root.classList.add('glt');
    root.textContent = '';
    const stage = el('div', 'glt-stage');
    const overlay = el('div', 'glt-overlay');
    stage.appendChild(overlay);
    const panel = el('aside', 'glt-panel');
    const grids = el('div', 'glt-grids');
    panel.appendChild(grids);
    const footer = el('footer', 'glt-footer');
    footer.textContent = GLT.T('app.disclaimer');
    const live = el('div', 'glt-sr', { id: 'glt-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const alert = el('div', 'glt-sr', { id: 'glt-alert', 'aria-live': 'assertive', 'aria-atomic': 'true' });
    root.append(stage, panel, footer, live, alert);
    refs = { root, stage, overlay, panel, footer, live, alert, grids };
    return refs;
  }

  function show(name) {
    const prev = screen;
    screen = name;
    if (refs) refs.root.setAttribute('data-screen', name);
    if (GLT.events) GLT.events.emit('screen:changed', { screen: name, prev });
  }

  function announce(text, mode) {
    if (!refs) return;
    const target = mode === 'assertive' ? refs.alert : refs.live;
    target.textContent = '';
    // next tick so screen readers notice repeated identical messages
    setTimeout(() => { target.textContent = String(text); }, 30);
  }

  function toast(key, vars, kind) {
    if (!refs) return;
    const t = el('div', 'glt-toast glt-toast--' + (kind || 'info'), { role: 'status' });
    t.textContent = GLT.T(key, vars);
    refs.overlay.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  }

  GLT.ui = {
    mount,
    refs() { return refs; },
    show,
    screen() { return screen; },
    announce,
    toast
  };
})();
