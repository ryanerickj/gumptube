// Gumptube — leitura de dados públicos do vídeo/canal.
// Regra: todo valor sai daqui com { value, source, precision }. Nada é inventado.
(() => {
  const GT = (window.GT = window.GT || {});
  const memo = new Map();

  const metric = (value, source, precision = 'exato') =>
    (value === null || value === undefined || Number.isNaN(value) ? null : { value, source, precision });

  /* ---------------------------------------- JSON embutido na página */

  function extractJson(text, marker) {
    const at = text.indexOf(marker);
    if (at < 0) return null;
    const start = text.indexOf('{', at);
    if (start < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }

  // O content script roda em mundo isolado: lemos o JSON do texto dos <script>.
  // Em navegação SPA esse JSON fica velho, então validamos o videoId antes de usar.
  function readInlinePlayerResponse(videoId) {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent;
      if (!text || !text.includes('ytInitialPlayerResponse')) continue;
      const json = extractJson(text, 'ytInitialPlayerResponse');
      if (json?.videoDetails?.videoId === videoId) return json;
    }
    return null;
  }

  function fromPlayerResponse(json, videoId) {
    const details = json.videoDetails || {};
    const micro = json.microformat?.playerMicroformatRenderer || {};
    return {
      videoId,
      views: Number(details.viewCount) || null,
      lengthSeconds: Number(details.lengthSeconds) || null,
      title: details.title || null,
      author: details.author || null,
      channelId: details.channelId || null,
      publishDate: micro.publishDate || null,
      category: micro.category || null,
      isLive: !!details.isLiveContent,
      source: 'pagina'
    };
  }

  /* ------------------------------------------------------ DOM da página */

  function likesFromDom() {
    const candidates = [
      ...document.querySelectorAll('like-button-view-model button, ytd-toggle-button-renderer button, #top-level-buttons-computed button')
    ];
    for (const button of candidates) {
      const label = button.getAttribute('aria-label') || '';
      if (!/gostei|like/i.test(label)) continue;
      const digits = label.match(/([\d.,]{2,})/);
      const parsed = digits ? GT.parseCount(digits[1]) : null;
      if (parsed) return metric(parsed, 'botão da página', 'exato');
    }
    const visible = document.querySelector('like-button-view-model .yt-spec-button-shape-next__button-text-content')?.textContent
      || document.querySelector('#segmented-like-button button .yt-core-attributed-string')?.textContent;
    const approx = GT.parseCount(visible);
    return approx ? metric(approx, 'botão da página', 'aproximado') : null;
  }

  function subsFromDom() {
    const text = document.querySelector('#owner #subscriber-count')?.textContent
      || document.querySelector('yt-formatted-string#owner-sub-count')?.textContent;
    const parsed = GT.parseCount(text);
    return parsed ? metric(parsed, 'página do canal', 'aproximado') : null;
  }

  function commentsFromDom() {
    const text = document.querySelector('ytd-comments-header-renderer #count')?.textContent
      || document.querySelector('#comments #count')?.textContent;
    const parsed = GT.parseCount(text);
    return parsed ? metric(parsed, 'seção de comentários', 'aproximado') : null;
  }

  /* --------------------------------------------------------- fachada */

  async function getVideo(videoId) {
    if (memo.has(videoId)) return memo.get(videoId);
    const promise = (async () => {
      const inline = readInlinePlayerResponse(videoId);
      if (inline) return fromPlayerResponse(inline, videoId);
      // SPA: o JSON da página é de outro vídeo — buscamos a página certa pelo service worker.
      return GT.sw('gt:video-page', { videoId });
    })();
    memo.set(videoId, promise);
    promise.catch(() => memo.delete(videoId));
    return promise;
  }

  const getChannelFeed = (channelId) => GT.sw('gt:channel-feed', { channelId });

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function outlier(views, feed, videoId) {
    if (!feed?.videos?.length || !Number.isFinite(views)) return null;
    const others = feed.videos.filter((item) => item.videoId !== videoId && Number.isFinite(item.views));
    const sample = others.length;
    if (sample < 3) return { unavailable: 'Amostra pequena demais no feed do canal.', sample };
    const base = median(others.map((item) => item.views));
    if (!base) return { unavailable: 'O feed do canal não trouxe views.', sample };
    const ranked = [...feed.videos].filter((item) => Number.isFinite(item.views)).sort((a, b) => b.views - a.views);
    const position = ranked.findIndex((item) => item.videoId === videoId);
    return {
      ratio: views / base,
      median: base,
      sample,
      position: position >= 0 ? position + 1 : null,
      total: ranked.length,
      videos: feed.videos,
      channelName: feed.channelName,
      source: 'rss'
    };
  }

  /* ------------------------------------------- sondagem de teste A/B (impressões) */
  // A chamada ao innertube precisa sair DAQUI (content script): é same-origin com a página do
  // YouTube, então o Origin é https://www.youtube.com e o endpoint aceita. Do service worker
  // o Chrome anexa Origin chrome-extension://… e o YouTube devolve 403 — era o bug.
  // Durante um Teste e Comparar, cada impressão serve a arte como *_custom_N.jpg (o N identifica
  // a variante) e o título sorteado — então várias chamadas deslogadas = várias impressões reais.
  const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';   // chave pública do cliente web

  function colherAparicoes(node, videoId, saida) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) colherAparicoes(item, videoId, saida); return; }
    if (node.videoId === videoId) {
      const runs = node.title?.runs;
      const titulo = Array.isArray(runs) ? runs.map((r) => r?.text || '').join('') : (node.title?.simpleText || null);
      if (titulo) saida.titulos.add(titulo);
      const thumbs = node.thumbnail?.thumbnails;
      if (Array.isArray(thumbs)) {
        for (const t of thumbs) {
          if (typeof t?.url === 'string' && (t.url.includes(`/vi/${videoId}/`) || t.url.includes(`/vi_webp/${videoId}/`))) {
            saida.urls.add(t.url.startsWith('//') ? `https:${t.url}` : t.url);
          }
        }
      }
    }
    for (const value of Object.values(node)) colherAparicoes(value, videoId, saida);
  }

  async function amostraDeImpressao(videoId) {
    const response = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'pt', gl: 'BR' } },
        query: videoId
      })
    });
    if (!response.ok) throw new Error(`Busca interna respondeu ${response.status}.`);
    const saida = { titulos: new Set(), urls: new Set() };
    colherAparicoes(await response.json(), videoId, saida);

    const porNome = new Map();
    for (const url of saida.urls) {
      const nome = url.match(/\/vi(?:_webp)?\/[^/]+\/([a-zA-Z0-9_]+)\.(?:jpg|webp)/)?.[1];
      if (nome && !porNome.has(nome)) porNome.set(nome, url);
    }
    const nomes = [...porNome.keys()];
    // arquivos de teste têm prioridade ABSOLUTA: a arte canônica aparece junto em renderers
    // paralelos e, se ganhasse por "peso", esconderia o teste
    let escolhidos = nomes.filter((n) => /_custom_\d+/.test(n));
    if (!escolhidos.length && nomes.length) {
      const peso = (n) => (n.startsWith('maxres') ? 3 : n.startsWith('hq720') ? 2 : 1);
      escolhidos = [[...nomes].sort((a, b) => peso(b) - peso(a))[0]];
    }
    return {
      artes: escolhidos.map((arquivo) => ({ arquivo, url: porNome.get(arquivo) })),
      titulos: [...saida.titulos]
    };
  }

  async function amostrarImpressoes(videoId, AMOSTRAS = 8) {
    const porArquivo = new Map();   // nome do arquivo = identidade da variante (custom_N)
    const titulos = new Map();
    let colhidas = 0;
    let falhas = 0;
    let primeiroErro = null;

    for (let i = 0; i < AMOSTRAS; i++) {
      if (i) await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const { artes, titulos: vistos } = await amostraDeImpressao(videoId);
        if (artes.length) colhidas++;
        for (const arte of artes) {
          const atual = porArquivo.get(arte.arquivo);
          if (atual) atual.vezes++;
          else porArquivo.set(arte.arquivo, { arquivo: arte.arquivo, url: arte.url, vezes: 1 });
        }
        for (const t of vistos) titulos.set(t, (titulos.get(t) || 0) + 1);
      } catch (error) {
        falhas++;
        if (!primeiroErro) primeiroErro = error.message || String(error);
      }
    }
    if (!colhidas) {
      throw new Error(falhas
        ? `Nenhuma impressão colhida — ${falhas} falha${falhas === 1 ? '' : 's'} (${primeiroErro}).`
        : 'A busca interna não devolveu este vídeo (muito novo ou não listado).');
    }

    const variantes = [...porArquivo.values()].map((item) => {
      const indice = item.arquivo.match(/_custom_(\d+)/)?.[1] ?? null;
      return { ...item, indice, teste: indice !== null };
    }).sort((a, b) => b.vezes - a.vezes);

    return {
      videoId,
      amostras: AMOSTRAS,
      colhidas,
      falhas,
      emTeste: variantes.some((v) => v.teste),
      variantes,
      titulos: [...titulos.entries()].map(([texto, vezes]) => ({ texto, vezes }))
    };
  }

  GT.data = {
    metric,
    getVideo,
    getChannelFeed,
    likesFromDom,
    subsFromDom,
    commentsFromDom,
    outlier,
    median,
    amostrarImpressoes,
    forget: (videoId) => memo.delete(videoId)
  };
})();
