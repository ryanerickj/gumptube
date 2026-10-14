// Gumptube — solução Frases: ganchos para a thumbnail, garimpados do que foi dito no vídeo.
(() => {
  const GT = (window.GT = window.GT || {});
  GT.views = GT.views || {};
  const { el } = GT;

  const FILTERS = [
    { id: 'todas', label: 'Todas' },
    { id: 'curtas', label: '≤ 3 palavras' },
    { id: 'numero', label: 'Com número' },
    { id: 'novas', label: 'Não repete o título' }
  ];

  GT.views.frases = {
    create(ctx) {
      let alive = true;
      let phrases = [];
      let filter = 'todas';
      let title = '';
      let track = null;
      let sourceLabel = '';

      const chips = el('div', { class: 'gt-chips' });
      const head = el('div', { class: 'gt-phrase-head' });
      const list = el('div', { class: 'gt-phrase-list' }, el('div', { class: 'gt-loading' }, 'Lendo a legenda pública do vídeo'));
      const extra = el('div', { class: 'gt-block' });
      const root = el('div', { class: 'gt-frases' }, head, el('div', { class: 'gt-toolbar gt-toolbar-thin' }, chips), list, extra);

      function renderChips() {
        GT.clear(chips);
        for (const item of FILTERS) {
          chips.append(el('button', {
            class: `gt-chip${item.id === filter ? ' active' : ''}`,
            onclick: () => { filter = item.id; renderChips(); renderList(); }
          }, item.label));
        }
      }

      async function load() {
        ctx.setStatus('Buscando a legenda do vídeo…');
        let data = null;
        let failure = null;
        try {
          const video = await GT.data.getVideo(ctx.videoId).catch(() => null);
          title = video?.title || GT.pageTitle();
          data = await GT.captions.load(ctx.videoId);
        } catch (error) {
          failure = error.message || String(error);
        }
        if (!alive) return;

        if (!data) {
          GT.clear(list).append(el('div', { class: 'gt-empty' },
            'Não foi possível ler frases deste vídeo.',
            el('br'), el('small', {}, 'Tentativas: ', failure || 'sem legenda pública.'),
            el('br'), el('small', {}, 'Sem legenda não há como saber o que foi dito — a Gumptube não inventa frase.'),
            el('br'),
            el('button', { class: 'gt-chip', style: { marginTop: '8px' }, onclick: () => { GT.clear(list).append(el('div', { class: 'gt-loading' }, 'Tentando de novo')); load(); } }, 'Tentar de novo')
          ));
          ctx.setStatus('Sem legenda pública');
          renderExtra();
          return;
        }

        track = data.track;
        sourceLabel = data.source;
        phrases = GT.phrases.extractFromLines(data.lines, title);
        renderHead();
        renderList();
        renderExtra();
        ctx.setStatus(`${phrases.length} frases garimpadas da legenda`);
      }

      function renderHead() {
        GT.clear(head);
        const titleWords = GT.phrases.significantWords(title).slice(0, 10);
        head.append(
          el('strong', {}, title || 'Vídeo'),
          el('p', { class: 'gt-note' },
            'Palavras que o título já ocupa — evite repetir na thumbnail:'),
          el('div', { class: 'gt-word-tags' }, titleWords.map((word) => el('span', {}, word))),
          el('b', { class: 'gt-src' }, sourceLabel || '')
        );
      }

      function visible() {
        if (filter === 'curtas') return phrases.filter((item) => item.words <= 3);
        if (filter === 'numero') return phrases.filter((item) => item.hasNumber);
        if (filter === 'novas') return phrases.filter((item) => item.overlap === 0);
        return phrases;
      }

      async function copyText(text, label) {
        try {
          await navigator.clipboard.writeText(text);
          ctx.setStatus(`Copiado: ${label}`);
        } catch (error) {
          ctx.setStatus(`Não foi possível copiar: ${error.message || error}`);
        }
      }

      function goTo(time) {
        const player = GT.videoEl();
        if (!player) return ctx.setStatus('Player indisponível nesta página.');
        player.currentTime = Math.max(0, time - 0.4);
        ctx.setStatus(`Player em ${GT.timeLabel(time)}`);
      }

      function renderList() {
        if (!alive) return;
        GT.clear(list);
        const items = visible();
        if (!items.length) {
          list.append(el('div', { class: 'gt-empty' }, 'Nenhuma frase com esse filtro.'));
          return;
        }
        for (const item of items) {
          const shown = item.text.toUpperCase();
          list.append(el('article', { class: 'gt-phrase' },
            el('p', { class: 'gt-phrase-text' }, shown),
            el('div', { class: 'gt-phrase-meta' },
              el('button', { class: 'gt-time', title: 'Ir para este ponto do vídeo', onclick: () => goTo(item.time) }, GT.timeLabel(item.time)),
              el('span', {}, `${item.words} palavras`),
              item.reasons.map((reason) => el('em', { class: `gt-tag${reason === 'repete o título' ? ' warn' : ''}` }, reason))
            ),
            el('div', { class: 'gt-item-actions' },
              el('button', { class: 'primary', onclick: () => copyText(shown, shown) }, '⧉ Copiar frase'),
              el('button', { onclick: () => copyText(`${shown} — ${GT.timeLabel(item.time)}`, 'frase + minutagem') }, 'Copiar com minuto'),
              el('button', { onclick: () => goTo(item.time) }, 'Ver trecho')
            )
          ));
        }
      }

      function renderExtra() {
        GT.clear(extra);
        const moldes = GT.phrases.templates(title);
        extra.append(
          el('p', { class: 'gt-note' }, el('b', {}, 'Moldes'), ' — padrões com lacuna, para você preencher. Não são falas do vídeo:'),
          el('div', { class: 'gt-word-tags moldes' },
            moldes.slice(0, 8).map((molde) => el('span', {
              class: 'clickable',
              title: 'Copiar molde',
              onclick: () => copyText(molde, molde)
            }, molde))
          ),
          el('p', { class: 'gt-note gt-caveat' },
            'As frases vêm da legenda pública do vídeo — quando ela é automática, o YouTube erra palavras e pontuação. Confira no trecho antes de usar.')
        );
      }

      renderChips();

      if (ctx.page.type !== 'watch') {
        GT.clear(list).append(el('div', { class: 'gt-empty' }, 'Abra um vídeo para garimpar frases do que foi dito nele.'));
        ctx.setStatus('Aguardando um vídeo');
        return { el: root, destroy() { alive = false; } };
      }

      load();
      return { el: root, destroy() { alive = false; } };
    }
  };
})();
