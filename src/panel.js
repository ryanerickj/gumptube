// Gumptube — casca do painel: cabeçalho, troca de solução em 1 clique, status e modais.
(() => {
  const GT = (window.GT = window.GT || {});
  const { el } = GT;

  const HOME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V4.8A1.8 1.8 0 0 1 4.8 3H8"/><path d="M16 3h3.2A1.8 1.8 0 0 1 21 4.8V8"/><path d="M21 16v3.2a1.8 1.8 0 0 1-1.8 1.8H16"/><path d="M8 21H4.8A1.8 1.8 0 0 1 3 19.2V16"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none"/></svg>';

  GT.createPanel = function createPanel(context, options = {}) {
    const floating = !!options.floating;
    const isApp = !!options.app;   // aba cheia da extensão: sem alça, sem recolher, altura livre
    let solutionId = null;
    let current = null;
    let pageContext = context;
    let busy = false;            // uma análise em andamento não pode ser remontada por baixo

    const mark = el('span', { class: 'gt-mark', html: HOME_ICON });
    const kicker = el('span', { class: 'gt-kicker' });
    const heading = el('h2', {});
    const status = el('div', { class: 'gt-status' }, 'Pronto');
    const progress = el('i', {});
    const progressBar = el('div', { class: 'gt-progress' }, progress);
    const body = el('div', { class: 'gt-body' });
    const layer = el('div', { class: 'gt-layer' });

    // Troca de solução em 1 clique; o ⌂ volta para a tela de escolha quando você quiser.
    const nav = el('div', { class: 'gt-nav-solutions' },
      el('button', {
        class: 'gt-nav-btn gt-nav-home',
        'data-id': 'home',
        title: 'Escolher solução',
        onclick: () => show(null)
      }, '⌂'),
      GT.SOLUTIONS.map((solution) =>
        el('button', {
          class: 'gt-nav-btn',
          'data-id': solution.id,
          title: `${solution.name} — ${solution.tagline}`,
          style: { '--gt-accent': solution.accent },
          html: solution.icon,
          onclick: () => show(solution.id)
        })
      )
    );

    const handle = el('button', {
      class: 'gt-handle',
      'aria-label': 'Abrir ou fechar a Gumptube',
      onclick: () => toggle()
    }, '›');

    // Seta no cabeçalho: recolhe o painel para a barra de título, liberando a lateral.
    const collapseButton = el('button', {
      class: 'gt-collapse',
      title: 'Recolher o painel',
      'aria-label': 'Recolher ou expandir o painel',
      onclick: () => toggle()
    }, '⌃');

    // Continua a pesquisa em tela grande: abre a Gumptube em aba própria, já na mesma
    // solução e no mesmo vídeo. (Páginas da extensão só abrem pelo service worker.)
    const expandButton = isApp ? null : el('button', {
      class: 'gt-collapse gt-expand',
      title: 'Abrir em aba cheia',
      'aria-label': 'Abrir a Gumptube em aba cheia',
      onclick: async () => {
        const params = new URLSearchParams();
        if (solutionId) params.set('solucao', solutionId);
        if (pageContext.videoId) params.set('video', pageContext.videoId);
        const query = params.toString();
        try {
          await GT.sw('gt:open-app', { query });
        } catch (error) {
          // caminho reserva: app.html é web-accessible — abre direto, sem service worker
          try {
            window.open(chrome.runtime.getURL('app.html') + (query ? `?${query}` : ''), '_blank');
          } catch (openError) {
            console.error('[Gumptube] Não consegui abrir a aba cheia:', error, openError);
            alert(`Gumptube: não consegui abrir a aba cheia.\nRecarregue a extensão em chrome://extensions e atualize esta página.\nDetalhe: ${error?.message || error}`);
          }
        }
      }
    }, '⧉');

    // Alça de altura: arrasta para definir até onde o painel pode crescer; duplo clique reseta.
    const grip = el('div', { class: 'gt-grip', title: 'Arraste para ajustar a altura · duplo clique para o padrão' },
      el('span', {})
    );

    const card = el('section', { class: `gt-card${floating ? ' gt-floating' : ''}${isApp ? ' gt-app' : ''}`, 'data-solution': 'home' },
      handle,
      el('header', { class: 'gt-head' },
        el('div', { class: 'gt-brand' }, mark, el('div', {}, kicker, heading)),
        nav,
        expandButton,
        collapseButton
      ),
      status,
      progressBar,
      body,
      grip,
      layer
    );

    const collapseKey = floating ? 'gt:collapsed-float' : 'gt:collapsed';

    function toggle(force) {
      const collapsed = force ?? !card.classList.contains('gt-collapsed');
      card.classList.toggle('gt-collapsed', collapsed);
      handle.textContent = collapsed ? '‹' : '›';
      collapseButton.textContent = collapsed ? '⌄' : '⌃';
      collapseButton.title = collapsed ? 'Expandir o painel' : 'Recolher o painel';
      GT.store.set(collapseKey, collapsed);
      options.onCollapse?.(collapsed);
    }

    /* ------------------------------------------------------- altura */

    const DEFAULT_HEIGHT = 420;
    const MIN_HEIGHT = 180;

    function applyHeight(value) {
      // innerHeight pode ser 0 se o painel inicializa antes do layout da página — sem esta
      // proteção, o teto vira 0 e o painel nasce sem altura nenhuma.
      const janela = window.innerHeight || 900;
      const max = Math.max(MIN_HEIGHT, Math.round(janela * 0.8));
      const alvo = Number.isFinite(value) && value > 0 ? value : DEFAULT_HEIGHT;
      const height = Math.round(Math.min(Math.max(alvo, MIN_HEIGHT), max));
      card.style.setProperty('--gt-body-max', `${height}px`);
      return height;
    }

    function startResize(event) {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = body.getBoundingClientRect().height;
      card.classList.add('gt-resizing');

      const move = (moveEvent) => applyHeight(startHeight + (moveEvent.clientY - startY));
      const stop = (upEvent) => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', stop, true);
        card.classList.remove('gt-resizing');
        GT.store.set('gt:bodyHeight', applyHeight(startHeight + (upEvent.clientY - startY)));
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', stop, true);
    }

    grip.addEventListener('mousedown', startResize);
    grip.addEventListener('dblclick', () => {
      applyHeight(DEFAULT_HEIGHT);
      GT.store.set('gt:bodyHeight', DEFAULT_HEIGHT);
    });
    window.addEventListener('resize', () => {
      applyHeight(parseInt(card.style.getPropertyValue('--gt-body-max'), 10) || DEFAULT_HEIGHT);
    });

    const ctx = {
      get videoId() { return pageContext.videoId; },
      get page() { return pageContext; },
      layer,
      setStatus(text) { status.textContent = text; },
      setProgress(value) {
        busy = !(value === null || value === undefined);
        progressBar.style.display = busy ? 'block' : 'none';
        progress.style.width = `${Math.max(0, Math.min(100, value || 0))}%`;
      },
      go(id) { show(id); },
      preview(src, caption) {
        const modal = el('div', { class: 'gt-modal', onclick: (event) => { if (event.target === modal) close(); } },
          el('div', { class: 'gt-modal-body' },
            el('div', { class: 'gt-modal-stage' }, el('img', { src, alt: caption || '' })),
            el('p', {}, caption || ''),
            el('div', { class: 'gt-modal-actions' }, el('button', { class: 'ghost', onclick: () => close() }, 'Fechar'))
          )
        );
        function onKey(event) { if (event.key === 'Escape') { event.preventDefault(); close(); } }
        function close() { window.removeEventListener('keydown', onKey, true); modal.remove(); }
        window.addEventListener('keydown', onKey, true);
        layer.append(modal);
      }
    };

    function show(id) {
      if (current?.destroy) current.destroy();
      current = null;
      GT.clear(body);
      GT.clear(layer);
      ctx.setProgress(null);
      solutionId = id;

      const solution = id ? GT.solution(id) : null;
      card.dataset.solution = solution ? solution.id : 'home';
      card.style.setProperty('--gt-accent', solution ? solution.accent : '#e51937');
      mark.innerHTML = solution ? solution.icon : HOME_ICON;
      // com solução aberta, só o nome dela — "GUMPTUBE · X" não cabe na lateral sem truncar
      kicker.textContent = solution ? solution.kicker : `GUMPTUBE · v${GT.VERSION}`;
      heading.textContent = solution ? solution.heading : `${GT.SOLUTIONS.length} soluções`;
      nav.style.display = solution ? '' : 'none';
      for (const button of nav.querySelectorAll('.gt-nav-btn')) {
        button.classList.toggle('active', button.dataset.id === id);
      }
      ctx.setStatus(solution ? solution.tagline : 'Escolha uma solução — depois ela abre sozinha');

      const view = solution ? GT.views[solution.id] : GT.views.launcher;
      if (!view) {
        body.append(el('div', { class: 'gt-empty' }, 'Solução indisponível nesta versão.'));
        return;
      }
      current = view.create(ctx);
      body.append(current.el);
      if (solution) GT.store.set('gt:solution', solution.id);
    }

    async function start() {
      const [saved, always, collapsed, height] = await Promise.all([
        GT.store.get('gt:solution', null),
        GT.store.get('gt:always', false),
        GT.store.get(collapseKey, floating),  // flutuante começa recolhido; na lateral do vídeo, aberto
        GT.store.get('gt:bodyHeight', DEFAULT_HEIGHT)
      ]);
      applyHeight(isApp ? (window.innerHeight || 900) : height);   // na aba cheia, usa a altura da janela
      if (collapsed && !isApp) toggle(true);
      // A aba cheia pode chegar com a solução na URL; senão, vale a preferência salva.
      if (options.initialSolution !== undefined) return show(options.initialSolution);
      // Por padrão você escolhe a solução ao abrir. Marcando "abrir sempre nesta", ela entra direto.
      show(always && saved && GT.solution(saved) ? saved : null);
    }

    start();

    return {
      el: card,
      get solutionId() { return solutionId; },
      get context() { return pageContext; },
      go: show,
      isBusy() { return busy; },
      setContext(next) {
        if (GT.sameContext(pageContext, next)) return;
        pageContext = next;
        if (solutionId) show(solutionId);
      },
      toggle,
      destroy() {
        if (current?.destroy) current.destroy();
        card.remove();
      }
    };
  };
})();
