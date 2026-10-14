// Gumptube — ações na grade: passar o mouse sobre qualquer thumbnail do YouTube
// (home, busca, canal, relacionados) e copiar/salvar/baixar a imagem em alta, sem abrir o vídeo.
(() => {
  const GT = (window.GT = window.GT || {});
  const HOST_ID = 'gumptube-grid';

  let host = null;
  let shadow = null;
  let bar = null;
  let toast = null;
  let anchor = null;          // âncora da thumbnail sob o mouse
  let videoId = '';
  let hideTimer = null;
  let busy = false;

  const MY_GENERATION = window.__gumptubeGridGeneration = (window.__gumptubeGridGeneration || 0) + 1;
  const isCurrent = () => window.__gumptubeGridGeneration === MY_GENERATION && (() => { try { return !!chrome.runtime?.id; } catch { return false; } })();

  const CARD_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model, ytd-reel-item-renderer, ytm-shorts-lockup-view-model';

  // Sem depender de new URL(): o href da grade é relativo e a base varia conforme o contexto.
  function idFromHref(href) {
    if (!href) return '';
    const watch = href.match(/[?&]v=([\w-]{6,})/);
    if (watch) return watch[1];
    const shorts = href.match(/\/shorts\/([\w-]{6,})/);
    return shorts ? shorts[1] : '';
  }

  // Uma âncora de thumbnail contém imagem; o link do título, não.
  function thumbAnchorFrom(node) {
    if (!node || !node.closest) return null;
    const link = node.closest('a[href]');
    if (!link) return null;
    if (!idFromHref(link.getAttribute('href'))) return null;
    if (!link.querySelector('img, yt-image, .ytCoreImageHost')) return null;
    const rect = link.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 60) return null;
    return link;
  }

  function cardInfo(link) {
    const card = link.closest(CARD_SELECTOR) || link.parentElement;
    const text = (selector) => card?.querySelector(selector)?.textContent?.trim() || '';
    const title = text('#video-title')
      || text('h3 a')
      || text('.yt-lockup-metadata-view-model__title')
      || link.getAttribute('title')
      || link.querySelector('img')?.getAttribute('alt')
      || '';
    const channel = text('ytd-channel-name a')
      || text('#channel-name a')
      || text('.yt-content-metadata-view-model__metadata-text')
      || '';
    const metaText = [...(card?.querySelectorAll('#metadata-line span, .yt-content-metadata-view-model__metadata-text') || [])]
      .map((node) => node.textContent || '')
      .find((value) => /visualiza|views|mi|mil|k\b/i.test(value)) || '';
    return { title, channel, views: GT.parseCount(metaText) };
  }

  /* -------------------------------------------------------------- UI */

  function ensureHost() {
    document.querySelectorAll(`#${HOST_ID}`).forEach((node) => { if (node !== host) node.remove(); });
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147482500' });
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('content.css');

    toast = document.createElement('span');
    toast.className = 'gt-hover-toast';

    bar = document.createElement('div');
    bar.className = 'gt-hover-bar';
    bar.append(
      button('⧉', 'Copiar imagem em alta', copyThumb, 'primary'),
      button('★', 'Salvar no Arsenal', saveThumb),
      button('⤓', 'Baixar PNG em alta', downloadThumb),
      toast
    );
    bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    bar.addEventListener('mouseleave', () => scheduleHide());

    shadow.append(style, bar);
    document.body.append(host);
  }

  function button(label, title, action, variant) {
    const element = document.createElement('button');
    element.className = `gt-hover-btn${variant ? ` ${variant}` : ''}`;
    element.textContent = label;
    element.title = title;
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    return element;
  }

  function place() {
    if (!anchor || !anchor.isConnected) return hide();
    const rect = anchor.getBoundingClientRect();
    // some quando a miniatura sai da tela; caso contrário, gruda na parte visível dela
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, innerHeight);
    if (rect.width < 120 || visibleBottom - visibleTop < 46) return hide();
    bar.style.top = `${Math.min(Math.max(rect.top + 8, visibleTop + 6), visibleBottom - 38)}px`;
    bar.style.left = `${Math.max(46, rect.right - 8)}px`;
    bar.classList.add('visible');
  }

  function show(link) {
    ensureHost();
    clearTimeout(hideTimer);
    anchor = link;
    videoId = idFromHref(link.getAttribute('href'));
    setToast('');
    place();
    startTracking();
  }

  function hide() {
    anchor = null;
    videoId = '';
    bar?.classList.remove('visible');
  }

  // O YouTube rola em contêineres internos, então não dá para confiar só no evento de scroll:
  // enquanto a barra está visível, reconferimos a posição a cada quadro.
  let tracking = false;
  function startTracking() {
    if (tracking) return;
    tracking = true;
    const step = () => {
      if (!anchor) { tracking = false; return; }
      place();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 260);
  }

  function setToast(text, tone = '') {
    if (!toast) return;
    toast.textContent = text;
    toast.className = `gt-hover-toast${text ? ' visible' : ''}${tone ? ` ${tone}` : ''}`;
  }

  /* ---------------------------------------------------------- ações */

  async function fetchThumb() {
    if (!videoId) throw new Error('Vídeo não identificado nesta miniatura.');
    return GT.sw('gt:thumb', { videoId });
  }

  async function withBusy(label, work) {
    if (busy) return;
    busy = true;
    setToast(label);
    try {
      await work();
    } catch (error) {
      setToast(error.message || 'Falhou', 'error');
      setTimeout(() => setToast(''), 2600);
    } finally {
      busy = false;
    }
  }

  function copyThumb() {
    const id = videoId;
    const held = anchor;
    return withBusy('copiando…', async () => {
      const size = await GT.copyImage(fetchThumb().then((thumb) => thumb.dataUrl));
      anchor = held; videoId = id;
      setToast(size ? `copiada ${size.width}×${size.height}` : 'copiada', 'ok');
      setTimeout(() => setToast(''), 2400);
    });
  }

  function downloadThumb() {
    const info = anchor ? cardInfo(anchor) : { title: '' };
    return withBusy('baixando…', async () => {
      const thumb = await fetchThumb();
      const { blob, width, height } = await GT.toPngBlob(thumb.dataUrl);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${GT.safeName(info.title || videoId)}-thumb.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setToast(`baixada ${width}×${height}`, 'ok');
      setTimeout(() => setToast(''), 2200);
    });
  }

  function saveThumb() {
    const id = videoId;
    const info = anchor ? cardInfo(anchor) : { title: '', channel: '', views: null };
    return withBusy('salvando…', async () => {
      const thumb = await fetchThumb();
      const image = await GT.loadImage(thumb.dataUrl);
      await GT.db.put({
        id: `thumb-${id}`,
        kind: 'thumb',
        origin: 'externo',
        createdAt: Date.now(),
        videoId: id,
        videoTitle: info.title || `Vídeo ${id}`,
        videoUrl: GT.videoUrl(id),
        channel: info.channel || '',
        channelId: null,
        time: null,
        dataUrl: thumb.dataUrl,
        width: image.naturalWidth,
        height: image.naturalHeight,
        hash: '',
        sig: GT.signature(image),
        score: null,
        tags: [],
        note: '',
        views: info.views ?? null,
        viewsSource: info.views ? 'grade do YouTube' : null,
        viewsPrecision: info.views ? 'aproximado' : null,
        publishedAt: null,
        quality: thumb.quality
      });
      GT.thumbs.sample(id, thumb.dataUrl, 'grade do YouTube').catch(() => {});   // alimenta o histórico
      setToast(`no Arsenal · ${image.naturalWidth}×${image.naturalHeight}`, 'ok');
      setTimeout(() => setToast(''), 2400);
    });
  }

  /* ------------------------------------------------------- eventos */

  document.addEventListener('mouseover', (event) => {
    if (!isCurrent()) { host?.remove(); return; }
    const link = thumbAnchorFrom(event.target);
    if (!link) return;
    if (link === anchor) { clearTimeout(hideTimer); return; }
    show(link);
  }, true);

  document.addEventListener('mouseout', (event) => {
    if (!anchor) return;
    const next = event.relatedTarget;
    if (next && (anchor.contains(next) || host?.contains(next) || next === host)) return;
    scheduleHide();
  }, true);

  // Scroll em fase de captura pega também os contêineres internos do YouTube;
  // o laço de quadros acima cobre o resto (o rAF pode ser suspenso em abas em segundo plano).
  window.addEventListener('scroll', () => place(), true);
  window.addEventListener('resize', () => place());
})();
