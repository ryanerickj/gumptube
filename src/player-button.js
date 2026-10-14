// Gumptube — botões de frame dentro dos controles do player, à direita.
// Capturam o frame que está na tela AGORA: sem seek, sem espera, e funcionam em tela cheia,
// onde o painel lateral não existe. "Copiar frame" vai para o clipboard; "Baixar frame" salva
// um PNG direto na pasta de downloads, nomeado com o título do vídeo + minutagem.
(() => {
  const GT = (window.GT = window.GT || {});
  const COPY_ID = 'gumptube-shot';
  const DOWNLOAD_ID = 'gumptube-shot-dl';
  const STYLE_ID = 'gumptube-shot-style';

  const MY_GENERATION = window.__gumptubeShotGeneration = (window.__gumptubeShotGeneration || 0) + 1;
  const isCurrent = () => {
    if (window.__gumptubeShotGeneration !== MY_GENERATION) return false;
    try { return !!chrome.runtime?.id; } catch { return false; }
  };

  const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M4 8.6V6.2A1.8 1.8 0 0 1 5.8 4.4H8.2"/>'
    + '<path d="M15.8 4.4h2.4A1.8 1.8 0 0 1 20 6.2v2.4"/>'
    + '<path d="M20 15.4v2.4a1.8 1.8 0 0 1-1.8 1.8h-2.4"/>'
    + '<path d="M8.2 19.6H5.8A1.8 1.8 0 0 1 4 17.8v-2.4"/>'
    + '<path d="M10.3 9.5v5l4.4-2.5z" fill="currentColor" stroke="none"/></svg>';

  const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M12 4.5v9.4"/>'
    + '<path d="M8.2 10.6 12 14.4l3.8-3.8"/>'
    + '<path d="M4.5 15.6v2.2A1.7 1.7 0 0 0 6.2 19.5h11.6a1.7 1.7 0 0 0 1.7-1.7v-2.2"/></svg>';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* dimensões próprias: não dependemos só do .ytp-button do YouTube */
      #${COPY_ID}, #${DOWNLOAD_ID} {
        position: relative; display: inline-flex; align-items: center; justify-content: center;
        gap: 6px; width: auto; height: 100%; min-height: 36px; padding: 0 10px; border: 0;
        background: none; color: #fff; opacity: .92; cursor: pointer; vertical-align: top;
      }
      #${COPY_ID} svg, #${DOWNLOAD_ID} svg { width: 22px; height: 22px; display: block; flex: none; transition: transform .12s; }
      #${COPY_ID} .gt-shot-label, #${DOWNLOAD_ID} .gt-shot-label {
        font-family: 'YouTube Sans', Roboto, Arial, sans-serif; font-size: 12.5px; font-weight: 500;
        letter-spacing: .2px; white-space: nowrap; line-height: 1;
      }
      #${COPY_ID}:hover, #${DOWNLOAD_ID}:hover { opacity: 1; }
      #${COPY_ID}:hover svg, #${DOWNLOAD_ID}:hover svg { transform: scale(1.1); }
      #${COPY_ID}[data-busy="1"], #${DOWNLOAD_ID}[data-busy="1"] { opacity: .45; cursor: wait; }
      /* player estreito (miniplayer/janelas pequenas): rótulos somem, ícones ficam */
      .html5-video-player.ytp-small-mode #${COPY_ID} .gt-shot-label,
      .html5-video-player.ytp-small-mode #${DOWNLOAD_ID} .gt-shot-label { display: none; }
      .gt-shot-toast {
        position: absolute; right: 12px; bottom: 58px; z-index: 62;
        background: #000000d9; border: 1px solid #ffffff2b; border-radius: 8px;
        color: #fff; font-family: 'YouTube Sans', Roboto, Arial, sans-serif; font-size: 12px;
        padding: 7px 11px; pointer-events: none; opacity: 0; transition: opacity .18s;
      }
      .gt-shot-toast.show { opacity: 1; }
      .gt-shot-toast.error { color: #ff9aa5; }
    `;
    (document.head || document.documentElement).append(style);
  }

  function player() {
    return document.querySelector('.html5-video-player');
  }

  let toastTimer = null;
  function toast(text, tone = '') {
    const host = player();
    if (!host) return;
    let node = host.querySelector('.gt-shot-toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'gt-shot-toast';
      host.append(node);
    }
    node.textContent = text;
    node.className = `gt-shot-toast show ${tone}`.trim();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = 'gt-shot-toast'; }, 2600);
  }

  // O frame atual, na resolução do player, sem tocar na reprodução.
  function currentCanvas() {
    const video = GT.videoEl();
    if (!video || !video.videoWidth) throw new Error('Player sem vídeo carregado.');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas;
  }

  async function withBusy(button, work) {
    if (button.dataset.busy === '1') return;
    button.dataset.busy = '1';
    try {
      await work();
    } catch (error) {
      toast(error.message || 'Não foi possível capturar', 'error');
    } finally {
      button.dataset.busy = '0';
    }
  }

  async function downloadFrame(event) {
    event.preventDefault();
    event.stopPropagation();
    await withBusy(event.currentTarget, async () => {
      const canvas = currentCanvas();
      const time = GT.videoEl()?.currentTime || 0;
      const { blob, width, height } = await GT.toPngBlob(canvas);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // vai direto para a pasta de downloads: título do vídeo + minutagem
      link.download = `${GT.safeName(GT.pageTitle())}-${GT.timeLabel(time).replace(/:/g, '-')}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(`Baixado ${width}×${height} em PNG`);
    });
  }

  async function copyFrame(event) {
    event.preventDefault();
    event.stopPropagation();
    const paraArsenal = event.altKey;
    await withBusy(event.currentTarget, async () => {
      const canvas = currentCanvas();
      const time = GT.videoEl()?.currentTime || 0;

      if (paraArsenal) {
        const videoId = GT.currentVideoId();
        const video = await GT.data.getVideo(videoId).catch(() => null);
        await GT.db.put({
          id: `${videoId}-${Math.round(time * 1000)}`,
          kind: 'frame',
          origin: 'meu-frame',
          createdAt: Date.now(),
          videoId,
          videoTitle: video?.title || GT.pageTitle(),
          videoUrl: GT.videoUrl(videoId),
          channel: video?.author || GT.pageChannel() || '',
          channelId: video?.channelId || null,
          time,
          dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          width: canvas.width,
          height: canvas.height,
          hash: GT.analysis.aHash(canvas),
          sig: GT.signature(canvas),
          score: null,
          tags: [],
          note: '',
          views: Number.isFinite(video?.views) ? video.views : null,
          publishedAt: video?.publishDate || null
        });
        toast(`No Arsenal · ${canvas.width}×${canvas.height}`);
      } else {
        const size = await GT.copyImage(canvas);
        toast(size ? `Copiado ${size.width}×${size.height}` : 'Copiado');
      }
    });
  }

  function makeButton(id, icon, label, title, ariaLabel, handler) {
    const button = document.createElement('button');
    button.id = id;
    button.className = 'ytp-button';
    button.title = title;
    button.setAttribute('aria-label', ariaLabel);
    button.innerHTML = `${icon}<span class="gt-shot-label">${label}</span>`;
    button.addEventListener('click', handler, true);
    return button;
  }

  function ensureButton() {
    if (!isCurrent()) {
      document.getElementById(COPY_ID)?.remove();
      document.getElementById(DOWNLOAD_ID)?.remove();
      return;
    }
    const controls = document.querySelector('.ytp-right-controls');
    if (!controls) return;
    if (controls.querySelector(`#${COPY_ID}`) && controls.querySelector(`#${DOWNLOAD_ID}`)) return;

    ensureStyle();
    document.getElementById(COPY_ID)?.remove();        // resto de geração anterior
    document.getElementById(DOWNLOAD_ID)?.remove();

    const copy = makeButton(COPY_ID, ICON_COPY, 'Copiar frame',
      'Gumptube · copiar o frame atual  (Alt: salvar no Arsenal)',
      'Copiar frame atual com a Gumptube', copyFrame);
    const download = makeButton(DOWNLOAD_ID, ICON_DOWNLOAD, 'Baixar frame',
      'Gumptube · baixar o frame atual em PNG (título do vídeo + minutagem)',
      'Baixar frame atual em PNG com a Gumptube', downloadFrame);

    controls.prepend(download);                        // primeiro dos controles da direita
    controls.prepend(copy);                            // copiar fica à esquerda de baixar
  }

  const observer = new MutationObserver(() => ensureButton());
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    if (!isCurrent()) {
      observer.disconnect();
      document.getElementById(COPY_ID)?.remove();
      document.getElementById(DOWNLOAD_ID)?.remove();
      return;
    }
    ensureButton();
  }, 1500);
  ensureButton();
  document.addEventListener('yt-navigate-finish', () => setTimeout(ensureButton, 300));
})();
