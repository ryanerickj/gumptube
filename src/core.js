// Gumptube — núcleo compartilhado (namespace, helpers, identidade das 3 soluções).
(() => {
  const GT = (window.GT = window.GT || {});
  GT.VERSION = '0.4.1';

  /* ---------------------------------------------------------------- DOM */

  GT.el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'style' && typeof value === 'object') {
        for (const [prop, raw] of Object.entries(value)) {
          if (prop.startsWith('--')) node.style.setProperty(prop, raw);   // custom properties exigem setProperty
          else node.style[prop] = raw;
        }
      }
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(3)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  GT.clear = (node) => { while (node.firstChild) node.firstChild.remove(); return node; };

  /* ------------------------------------------------------------ formato */

  GT.clamp01 = (value) => Math.min(1, Math.max(0, value));

  GT.timeLabel = (seconds) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };

  GT.safeName = (value) => String(value || '').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'gumptube';

  const nf = new Intl.NumberFormat('pt-BR');
  GT.int = (value) => (Number.isFinite(value) ? nf.format(Math.round(value)) : '—');

  GT.compact = (value) => {
    if (!Number.isFinite(value)) return '—';
    const unit = value >= 1e9 ? ['bi', 1e9] : value >= 1e6 ? ['mi', 1e6] : value >= 1e3 ? ['mil', 1e3] : null;
    if (!unit) return nf.format(Math.round(value));
    const scaled = value / unit[1];
    const digits = scaled >= 100 ? 0 : 1;
    return `${scaled.toFixed(digits).replace('.', ',')} ${unit[0]}`;
  };

  GT.decimal = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '—');

  // "2026-08-21" é interpretado como meia-noite UTC: sem forçar o fuso, a data volta um dia.
  GT.dateLabel = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric',
      ...(dateOnly ? { timeZone: 'UTC' } : {})
    });
  };

  GT.daysSince = (iso) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return Math.max(0, (Date.now() - date.getTime()) / 86400e3);
  };

  GT.ageLabel = (iso) => {
    const days = GT.daysSince(iso);
    if (days === null) return '—';
    if (days < 1) return 'hoje';
    if (days < 30) return `há ${Math.round(days)} dia${Math.round(days) === 1 ? '' : 's'}`;
    if (days < 365) return `há ${Math.round(days / 30)} ${Math.round(days / 30) === 1 ? 'mês' : 'meses'}`;
    const years = days / 365;
    return `há ${GT.decimal(years, 1)} ano${years < 2 ? '' : 's'}`;
  };

  // Lê "1.234.567", "1,2 mi", "12 mil" do DOM do YouTube em pt-BR ou en.
  GT.parseCount = (text) => {
    if (!text) return null;
    const clean = String(text).toLowerCase().replace(/ /g, ' ').trim();
    const match = clean.match(/([\d.,]+)\s*(bi|mi|mil|b|m|k)?/);
    if (!match) return null;
    let numeric = match[1];
    const unit = match[2];
    if (unit) numeric = numeric.replace(/\./g, '').replace(',', '.');
    else numeric = numeric.replace(/[.\s]/g, '').replace(',', '.');
    const value = Number(numeric);
    if (!Number.isFinite(value)) return null;
    const scale = { bi: 1e9, b: 1e9, mi: 1e6, m: 1e6, mil: 1e3, k: 1e3 }[unit] ?? 1;
    return Math.round(value * scale);
  };

  /* -------------------------------------------------- soluções (temas) */

  const ICON = {
    arsenal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/></svg>',
    screenshot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V4.8A1.8 1.8 0 0 1 4.8 3H8"/><path d="M16 3h3.2A1.8 1.8 0 0 1 21 4.8V8"/><path d="M21 16v3.2a1.8 1.8 0 0 1-1.8 1.8H16"/><path d="M8 21H4.8A1.8 1.8 0 0 1 3 19.2V16"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none"/></svg>',
    dados: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V13"/><path d="M10 20V8"/><path d="M16 20v-5"/><path d="M22 20V4"/></svg>',
    frases: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M10 11c0-2.5-1.6-4-3.6-4C4.5 7 3 8.5 3 10.6c0 2 1.4 3.4 3.2 3.4.5 0 .9-.1 1.2-.2-.4 1.6-1.7 2.8-3.4 3.2"/><path d="M21 11c0-2.5-1.6-4-3.6-4-1.9 0-3.4 1.5-3.4 3.6 0 2 1.4 3.4 3.2 3.4.5 0 .9-.1 1.2-.2-.4 1.6-1.7 2.8-3.4 3.2"/></svg>'
  };

  GT.SOLUTIONS = [
    {
      id: 'arsenal',
      name: 'Arsenal',
      kicker: 'ARSENAL',
      heading: 'Biblioteca visual',
      tagline: 'Thumbnails, referências e similares',
      description: 'Salve thumbnails e frames, marque tags e encontre o que se parece com a sua referência.',
      accent: '#f5a524',
      icon: ICON.arsenal
    },
    {
      id: 'screenshot',
      name: 'Screenshot',
      kicker: 'SCREENSHOT',
      heading: 'O melhor frame',
      tagline: 'Análise de frames e exportação em alta',
      description: 'Varre o vídeo, pontua nitidez, rosto e cena, e exporta o frame na resolução do player.',
      accent: '#e51937',
      icon: ICON.screenshot
    },
    {
      id: 'frases',
      name: 'Frases',
      kicker: 'FRASES',
      heading: 'Ganchos da thumbnail',
      tagline: 'Frases ditas no vídeo, com minutagem',
      description: 'Garimpa na legenda as falas curtas e fortes que complementam o título — sem repetir o que ele já diz.',
      accent: '#b07cf5',
      icon: ICON.frases
    },
    {
      id: 'dados',
      name: 'Dados',
      kicker: 'DADOS',
      heading: 'Contexto do vídeo',
      tagline: 'Métricas reais, outlier e histórico',
      description: 'Views exatas, views/dia, engajamento e o quanto este vídeo escapa da média do canal.',
      accent: '#2bd97c',
      icon: ICON.dados
    }
  ];

  GT.solution = (id) => GT.SOLUTIONS.find((item) => item.id === id) || null;

  /* ---------------------------------------------------------- storage */

  GT.store = {
    async get(key, fallback = null) {
      try {
        const bag = await chrome.storage.local.get(key);
        return bag[key] ?? fallback;
      } catch {
        return fallback;
      }
    },
    async set(key, value) {
      try {
        await chrome.storage.local.set({ [key]: value });
      } catch {
        /* silencioso: preferência é conveniência, não dado crítico */
      }
    }
  };

  /* -------------------------------------------- ponte service worker */

  // timeoutMs: consultas lentas (Internet Archive, sondagem A/B) precisam de mais que 20 s —
  // o padrão curto derrubava a resposta ANTES de ela chegar e a falha parecia "não funciona".
  GT.sw = (type, payload = {}, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('O serviço da extensão não respondeu a tempo.'));
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) return reject(new Error(runtimeError.message));
          if (!response) return reject(new Error('Sem resposta do serviço da extensão.'));
          if (!response.ok) return reject(new Error(response.error || 'Falha na requisição.'));
          resolve(response.data);
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  /* -------------------------------------------------- contexto da página */

  GT.currentVideoId = () => new URLSearchParams(location.search).get('v') || '';
  GT.isWatchPage = () => location.pathname === '/watch' && !!GT.currentVideoId();

  // A Gumptube fica ativa em todo o YouTube: cada tipo de página dá um contexto diferente.
  GT.pageContext = () => {
    const path = location.pathname;
    if (GT.isWatchPage()) return { type: 'watch', videoId: GT.currentVideoId(), path };
    if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/.test(path)) {
      const handle = path.split('/').slice(0, path.startsWith('/@') ? 2 : 3).join('/');
      return { type: 'channel', videoId: '', channelPath: handle, path };
    }
    if (path === '/results') return { type: 'search', videoId: '', query: new URLSearchParams(location.search).get('search_query') || '', path };
    return { type: 'other', videoId: '', path };
  };

  GT.sameContext = (a, b) =>
    !!a && !!b && a.type === b.type && a.videoId === b.videoId && a.channelPath === b.channelPath && a.query === b.query;
  GT.videoEl = () => document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');

  GT.pageTitle = () =>
    (document.querySelector('#title h1 yt-formatted-string')?.textContent
      || document.querySelector('h1.ytd-watch-metadata')?.textContent
      || document.querySelector('h1 yt-formatted-string')?.textContent
      || document.title.replace(/ - YouTube$/, '')).trim();

  GT.pageChannel = () =>
    (document.querySelector('ytd-video-owner-renderer #channel-name a')?.textContent
      || document.querySelector('#owner #channel-name a')?.textContent
      || document.querySelector('#upload-info #channel-name a')?.textContent
      || '').trim();

  GT.videoUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

  GT.loadImage = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      image.src = src;
    });


  // Copiar imagem é o caminho preferido — baixar fica como alternativa.
  GT.toPngBlob = async (source) => {
    const image = source instanceof HTMLCanvasElement ? source : await GT.loadImage(source);
    const canvas = source instanceof HTMLCanvasElement ? source : (() => {
      const node = document.createElement('canvas');
      node.width = image.naturalWidth || image.width;
      node.height = image.naturalHeight || image.height;
      node.getContext('2d').drawImage(image, 0, 0);
      return node;
    })();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Falha ao converter a imagem.'))), 'image/png');
    });
    return { blob, width: canvas.width, height: canvas.height };
  };

  // ClipboardItem aceita Promise<Blob>: o gesto do usuário continua válido enquanto a imagem é preparada.
  GT.copyImage = async (pending) => {
    let size = null;
    const promise = Promise.resolve(pending).then(async (source) => {
      const result = await GT.toPngBlob(source);
      size = result;
      return result.blob;
    });
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': promise })]);
    } catch {
      const blob = await promise;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
    return size;
  };

  /* ---------------------------------------------- qualidade do player */

  // O canvas só captura na resolução em que o vídeo está TOCANDO. Se o player estiver
  // em 480p pelo modo automático, qualquer captura "em alta" sairia em 480p — igual ao
  // preview. A ponte src/page-quality.js roda no mundo da página e nos dá acesso à API
  // real do player para elevar a qualidade antes da varredura e restaurar depois.
  const QUALITY_WIDTHS = {
    highres: 7680, hd4320: 7680, hd2880: 5120, hd2160: 3840,
    hd1440: 2560, hd1080: 1920, hd720: 1280,
    large: 854, medium: 640, small: 426, tiny: 256
  };
  let qualitySeq = 0;

  function qualityBridge(action, value) {
    return new Promise((resolve) => {
      const id = `gt-q${Date.now()}-${++qualitySeq}`;
      const timer = setTimeout(() => { window.removeEventListener('message', onMessage); resolve(null); }, 2000);
      function onMessage(event) {
        const data = event.data;
        if (event.source !== window || !data || data.type !== 'gt-quality-result' || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(data.ok ? data : null);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ type: 'gt-quality', id, action, quality: value }, window.location.origin);
    });
  }

  // Eleva a qualidade do player até cobrir desiredWidth (0 = a melhor disponível).
  // Devolve o necessário para restaurar depois, ou null se nada precisou mudar.
  GT.raisePlayerQuality = async (video, desiredWidth) => {
    const state = await qualityBridge('get');
    const levels = (state?.available || []).filter((level) => QUALITY_WIDTHS[level]);
    if (!levels.length) return null;

    let target = levels[0];                                   // melhor disponível
    if (desiredWidth) {
      for (let i = levels.length - 1; i >= 0; i--) {          // menor nível que cobre o pedido
        if (QUALITY_WIDTHS[levels[i]] >= desiredWidth) { target = levels[i]; break; }
      }
    }
    if ((video.videoWidth || 0) >= QUALITY_WIDTHS[target]) return null;  // já toca nessa resolução

    const applied = await qualityBridge('set', target);
    if (!applied) return null;

    // Espera o player trocar de formato — com teto, porque a troca depende da rede.
    const before = video.videoWidth || 0;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if ((video.videoWidth || 0) > before) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { previous: state.current || null };
  };

  GT.restorePlayerQuality = async (boost) => {
    if (!boost) return;
    await qualityBridge('restore', boost.previous);
  };

  GT.toast = (node, text) => {
    if (node) node.textContent = text;
  };
})();
