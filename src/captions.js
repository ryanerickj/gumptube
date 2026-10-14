// Gumptube — leitura da legenda em camadas. O endpoint timedtext responde vazio fora do
// contexto da página, então tentamos: faixa oficial (mesma origem) → outros formatos →
// painel de transcrição da própria página. Se tudo falhar, dizemos que falhou.
(() => {
  const GT = (window.GT = window.GT || {});

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function wordsFromText(text, start, duration) {
    const parts = clean(text).split(' ').filter(Boolean);
    if (!parts.length) return [];
    const step = parts.length > 1 && duration > 0 ? duration / parts.length : 0;
    return parts.map((word, index) => ({ t: start + step * index, text: word }));
  }

  /* --------------------------------------------- faixas oficiais */

  function parseJson3(payload) {
    const data = JSON.parse(payload);
    const lines = [];
    for (const event of data.events || []) {
      if (!event.segs) continue;
      const start = (event.tStartMs || 0) / 1000;
      const words = [];
      for (const seg of event.segs) {
        const text = clean(seg.utf8);
        if (!text) continue;
        words.push({ t: start + (seg.tOffsetMs || 0) / 1000, text });
      }
      if (words.length) lines.push({ start: words[0].t, words });
    }
    return lines;
  }

  function parseXml(payload) {
    const doc = new DOMParser().parseFromString(payload, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML inválido');
    const lines = [];

    // srv3: <p t="ms" d="ms"><s t="offset">palavra</s>…</p>
    for (const node of doc.querySelectorAll('p')) {
      const start = Number(node.getAttribute('t') || 0) / 1000;
      const duration = Number(node.getAttribute('d') || 0) / 1000;
      const segments = [...node.querySelectorAll('s')];
      if (segments.length) {
        const words = segments
          .map((seg) => ({ t: start + Number(seg.getAttribute('t') || 0) / 1000, text: clean(seg.textContent) }))
          .filter((word) => word.text);
        if (words.length) lines.push({ start: words[0].t, words });
      } else {
        const words = wordsFromText(node.textContent, start, duration);
        if (words.length) lines.push({ start, words });
      }
    }
    if (lines.length) return lines;

    // formato simples: <text start="s" dur="s">frase</text>
    for (const node of doc.querySelectorAll('text')) {
      const start = Number(node.getAttribute('start') || 0);
      const duration = Number(node.getAttribute('dur') || 0);
      const decoded = new DOMParser().parseFromString(`<x>${node.textContent}</x>`, 'text/html').body.textContent;
      const words = wordsFromText(decoded, start, duration);
      if (words.length) lines.push({ start, words });
    }
    return lines;
  }

  // Sem new URL(): a base varia conforme o contexto e o baseUrl da legenda já vem absoluto.
  function withFormat(baseUrl, format) {
    let url = String(baseUrl || '').replace(/([?&])fmt=[^&]*/g, '$1').replace(/[?&]+$/, '');
    if (format) url += `${url.includes('?') ? '&' : '?'}fmt=${format}`;
    return url;
  }

  async function fetchTrack(track, format) {
    const response = await fetch(withFormat(track.baseUrl, format), { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.text();
    if (!payload.trim()) throw new Error('resposta vazia');
    const lines = format === 'json3' ? parseJson3(payload) : parseXml(payload);
    if (!lines.length) throw new Error('sem linhas');
    return lines;
  }

  /* -------------------------------- painel de transcrição da página */

  const parseStamp = (label) => {
    const parts = clean(label).split(':').map(Number);
    if (!parts.length || parts.some((part) => Number.isNaN(part))) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  };

  // O YouTube já mudou esse painel várias vezes ("Transcrição", "Neste vídeo"), com nomes de
  // componente diferentes. Em vez de depender do nome, procuramos linhas que COMEÇAM com um
  // timestamp — isso vale para qualquer layout.
  // O horário e o texto vivem em elementos separados, então o texto concatenado vem colado:
  // "3:13a galera parece que..." — por isso o espaço depois do horário é opcional.
  const ROW_PATTERN = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*(\S.*)$/;
  const ONLY_STAMP = /^\d{1,2}:\d{2}(?::\d{2})?$/;

  function transcriptContainer() {
    const direct = document.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"], ytd-transcript-renderer, #segments-container'
    );
    if (direct) return direct;
    // layout novo: acha pelo campo de busca do painel
    const field = [...document.querySelectorAll('input, textarea')]
      .find((node) => /transcri/i.test(node.getAttribute('placeholder') || node.getAttribute('aria-label') || ''));
    if (field) return field.closest('ytd-engagement-panel-section-list-renderer, tp-yt-paper-dialog, div[role="dialog"]') || field.parentElement?.parentElement || null;
    return null;
  }

  // Percorre o documento e os shadow roots abertos em busca de nós de texto "3:13".
  function stampTextNodes(root) {
    const out = [];
    const visit = (node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let current;
      while ((current = walker.nextNode())) {
        const value = clean(current.nodeValue);
        if (value && ONLY_STAMP.test(value)) out.push(current);
      }
      const scope = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const element of scope) if (element.shadowRoot) visit(element.shadowRoot);
    };
    visit(root);
    return out;
  }

  function rowsFrom(container) {
    const scope = container || document;
    const found = [];

    // 1) componentes conhecidos (layout antigo): horário e texto em campos próprios
    for (const node of scope.querySelectorAll('ytd-transcript-segment-renderer, yt-transcript-segment-view-model, [class*="transcript-segment"]')) {
      const stampNode = node.querySelector('.segment-timestamp, [class*="timestamp"]');
      const textNode = node.querySelector('.segment-text, [class*="segment-text"]');
      const time = parseStamp(stampNode?.textContent);
      const value = clean(textNode?.textContent);
      if (time !== null && value) found.push({ node, time, text: value });
    }

    // 2) varredura por NÓ DE TEXTO: acha todo texto que é só um horário e sobe até a linha.
    //    Funciona mesmo quando o horário não está num elemento próprio ("3:13" solto na div)
    //    e atravessa shadow roots abertos, que o querySelectorAll não enxerga.
    if (!found.length) {
      for (const stamp of stampTextNodes(scope)) {
        const time = parseStamp(stamp.nodeValue);
        if (time === null) continue;
        const label = clean(stamp.nodeValue);
        let row = stamp.parentElement;
        for (let up = 0; up < 4 && row; up++) {
          const text = clean(row.textContent).replace(label, '').trim();
          if (text.length >= 6 && text.length < 400) { found.push({ node: row, time, text }); break; }
          row = row.parentElement;
        }
      }
    }

    // 3) texto corrido começando com horário (com ou sem espaço depois dele)
    if (!found.length) {
      for (const node of scope.querySelectorAll('div, li, button, span, p')) {
        const text = clean(node.textContent);
        if (!text || text.length > 400) continue;
        const match = text.match(ROW_PATTERN);
        if (!match) continue;
        const time = parseStamp(match[1]);
        if (time === null) continue;
        found.push({ node, time, text: clean(match[2]) });
      }
    }

    // descarta os contêineres que só embrulham outras linhas encontradas
    const inner = found.filter((item) => !found.some((other) => other !== item && item.node.contains(other.node)));
    const unique = new Map();
    for (const item of inner) {
      const key = `${item.time}|${item.text}`;
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()].sort((a, b) => a.time - b.time);
  }

  function scrollerOf(node) {
    let current = node;
    while (current && current !== document.body) {
      if (current.scrollHeight > current.clientHeight + 40) return current;
      current = current.parentElement;
    }
    return null;
  }

  function findTranscriptButton() {
    const nodes = [...document.querySelectorAll('button, tp-yt-paper-button, yt-formatted-string, a')];
    return nodes.find((node) => {
      const label = `${node.getAttribute?.('aria-label') || ''} ${node.textContent || ''}`;
      return /transcri(ç|c)/i.test(label) && !/fechar|close|pesquisar|search/i.test(label);
    }) || null;
  }

  function closeTranscriptPanel() {
    const panel = transcriptContainer();
    const close = panel?.querySelector('#visibility-button button, button[aria-label*="Fechar"], button[aria-label*="Close"]');
    close?.click();
  }

  async function fromTranscriptPanel() {
    let container = transcriptContainer();
    let rows = rowsFrom(container);
    let opened = false;

    if (!rows.length) {
      const button = findTranscriptButton();
      if (!button) throw new Error('não achei o painel de transcrição nesta página');
      button.click();
      opened = true;
      for (let attempt = 0; attempt < 24 && !rows.length; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        container = transcriptContainer();
        rows = rowsFrom(container);
      }
    }
    if (!rows.length) throw new Error('a transcrição abriu mas nenhuma linha foi reconhecida');

    // a lista costuma renderizar só o que está à vista: rolamos até parar de crescer
    const scroller = scrollerOf(rows[0].node) || scrollerOf(container);
    if (scroller) {
      let previous = 0;
      for (let step = 0; step < 40 && rows.length > previous; step++) {
        previous = rows.length;
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 140));
        rows = rowsFrom(container);
      }
      scroller.scrollTop = 0;
    }

    const lines = rows.map((row, index) => {
      const next = rows[index + 1];
      const duration = next ? Math.max(0.6, next.time - row.time) : 2.5;
      return { start: row.time, words: wordsFromText(row.text, row.time, duration) };
    }).filter((line) => line.words.length);

    if (!lines.length) throw new Error('as linhas da transcrição vieram vazias');
    if (opened) setTimeout(closeTranscriptPanel, 400);   // devolve a página como estava
    return lines;
  }

  /* ------------------------------------------------------ fachada */

  // Relatório para diagnosticar quando a transcrição não é reconhecida.
  function diagnose() {
    const container = transcriptContainer();
    const stamps = stampTextNodes(container || document);
    const amostra = stamps.slice(0, 3).map((node) => {
      const chain = [];
      let current = node.parentElement;
      for (let up = 0; up < 4 && current; up++) {
        chain.push(`${current.tagName.toLowerCase()}${current.id ? '#' + current.id : ''}${current.className && typeof current.className === 'string' ? '.' + current.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`);
        current = current.parentElement;
      }
      return { horario: clean(node.nodeValue), cadeia: chain, textoDoPai: clean(node.parentElement?.parentElement?.textContent).slice(0, 90) };
    });
    return {
      containerEncontrado: !!container,
      containerTag: container?.tagName?.toLowerCase() || null,
      horariosEncontrados: stamps.length,
      linhasReconhecidas: rowsFrom(container).length,
      componentesConhecidos: document.querySelectorAll('ytd-transcript-segment-renderer, yt-transcript-segment-view-model, [class*="transcript-segment"]').length,
      shadowRootsAbertos: [...document.querySelectorAll('*')].filter((node) => node.shadowRoot).length,
      amostra
    };
  }

  GT.captions = {
    diagnose,
    async load(videoId) {
      const problems = [];

      try {
        const data = await GT.sw('gt:caption-tracks', { videoId });
        for (const track of (data.tracks || []).slice(0, 3)) {
          for (const format of ['json3', 'srv3', '']) {
            try {
              const lines = await fetchTrack(track, format);
              return {
                lines,
                track,
                source: `legenda ${track.auto ? 'automática' : 'do autor'}${track.lang ? ` · ${track.lang}` : ''}`
              };
            } catch (error) {
              problems.push(`${track.lang || '?'}/${format || 'xml'}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        problems.push(`faixas: ${error.message}`);
      }

      try {
        const lines = await fromTranscriptPanel();
        return { lines, track: { auto: null, lang: '' }, source: 'painel de transcrição da página' };
      } catch (error) {
        problems.push(`transcrição: ${error.message}`);
      }

      throw new Error(problems.join(' · ') || 'Sem legenda disponível.');
    }
  };
})();
