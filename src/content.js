// Gumptube — montagem e roteamento. A extensão precisa aparecer em toda página do YouTube,
// de primeira, sem recarregar e sem depender do layout (normal, teatro, coluna escondida).
(() => {
  const GT = (window.GT = window.GT || {});
  const HOST_ID = 'gumptube-root';

  // Cada carga do script vira uma "geração". A anterior se aposenta sozinha — é o que permite
  // recarregar a extensão sem precisar recarregar a página.
  const GENERATION = (window.__gumptubeGeneration = (window.__gumptubeGeneration || 0) + 1);
  const isCurrent = () => window.__gumptubeGeneration === GENERATION;
  // Script órfão (extensão recarregada) perde o acesso a chrome.runtime.id.
  const isAlive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const SIDEBAR_GRACE = 1200;   // tempo que esperamos a coluna lateral antes de flutuar
  const MAX_WIPES = 2;          // se o YouTube apagar nosso nó além disso, fixamos o dock

  let panel = null;
  let host = null;
  let mode = null;              // 'sidebar' | 'floating'
  let mounting = false;
  let firstAttemptAt = Date.now();
  let lastReason = 'inicial';
  let wipes = 0;                // quantas vezes o YouTube removeu o painel nesta página
  let stickyFloating = false;   // quando o DOM briga com a gente, o dock vence

  const sidebarTarget = () =>
    document.querySelector('#secondary-inner') || document.querySelector('#secondary') || null;

  const isTheater = () =>
    !!document.querySelector('ytd-watch-flexy[theater], ytd-watch-flexy[fullscreen]') || !!document.fullscreenElement;

  // Estar no DOM não basta: o YouTube esconde a coluna em vários layouts.
  function isVisible(node) {
    if (!node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 24) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    return true;
  }

  let forced = false;   // ligado quando o usuário pede o painel pelo ícone da extensão

  function wantedMode(context) {
    // Na home e nos feeds o painel só aparece se for pedido: ali ele atrapalha a navegação.
    // As ações de copiar thumbnail na grade continuam valendo em todo o YouTube.
    if (context.type === 'other' && !forced) return 'none';
    if (context.type !== 'watch') return 'floating';
    if (isTheater() || stickyFloating) return 'floating';
    const target = sidebarTarget();
    if (target && isVisible(target)) return 'sidebar';
    // sem coluna utilizável: espera um pouco e, se não vier, flutua assim mesmo
    return Date.now() - firstAttemptAt > SIDEBAR_GRACE ? 'floating' : 'pending';
  }

  function unmount() {
    if (panel) { panel.destroy(); panel = null; }
    host?.remove();
    host = null;
    mode = null;
  }

  // Aposenta esta geração: solta o painel, os timers e o observador.
  let retired = false;
  function retire() {
    if (retired) return;
    retired = true;
    try { unmount(); } catch { /* o DOM pode já ter ido embora */ }
    try { observer.disconnect(); } catch {}
    clearInterval(heartbeat);
    document.getElementById(HOST_ID)?.remove();
  }

  function buildHost(nextMode) {
    const element = document.createElement('div');
    element.id = HOST_ID;
    element.dataset.mode = nextMode;
    if (nextMode === 'floating') {
      // fora do topo da página, para não cobrir os chips e a busca do YouTube
      Object.assign(element.style, {
        position: 'fixed', top: '46%', right: '0', transform: 'translateY(-50%)',
        width: 'min(392px, 94vw)', zIndex: '2147482000', pointerEvents: 'auto'
      });
    } else {
      element.style.marginBottom = '12px';
    }
    const shadow = element.attachShadow({ mode: 'open' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('content.css');
    shadow.append(style);
    return { element, shadow };
  }

  function mount(reason = 'checagem') {
    if (!isCurrent() || !isAlive()) { retire(); return; }
    if (mounting || !document.body) return;
    const context = GT.pageContext();
    const target = wantedMode(context);
    if (target === 'pending') return;
    if (target === 'none') { unmount(); return; }

    // no lugar certo e visível: só atualiza o contexto
    if (host && host.isConnected && mode === target) {
      if (mode === 'sidebar' && !isVisible(host) && !panel?.isBusy?.()) {
        remount('coluna lateral ficou invisível');
        return;
      }
      panel?.setContext(context);
      return;
    }

    // trocar de modo durante uma análise destruiria os frames já capturados
    if (host && host.isConnected && panel?.isBusy?.()) return;

    lastReason = reason;
    mounting = true;
    try {
      unmount();
      document.getElementById(HOST_ID)?.remove();
      const built = buildHost(target);
      host = built.element;
      mode = target;
      panel = GT.createPanel(context, {
        floating: target === 'floating',
        // recolhido e flutuante, o host encolhe para a largura da alça e some do caminho
        onCollapse: (collapsed) => {
          if (mode !== 'floating' || !host) return;
          host.style.width = collapsed ? '34px' : 'min(392px, 94vw)';
        }
      });
      built.shadow.append(panel.el);
      if (target === 'sidebar') sidebarTarget().prepend(host);
      else document.body.append(host);
    } finally {
      mounting = false;
    }
  }

  function remount(reason) {
    unmount();
    firstAttemptAt = Date.now();
    mount(reason);
  }

  /* ------------------------------------------------------- gatilhos */

  let scheduled = null;
  function schedule(reason, delay = 0) {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => mount(reason), delay);
  }

  // 1) eventos da SPA do YouTube
  // Pré-carrega o histórico público da thumbnail assim que um vídeo abre: a consulta ao
  // Internet Archive leva de 5 a 25 s, então ela começa a rodar antes de você pedir.
  const prefetched = new Set();
  function prefetchArquivo() {
    const context = GT.pageContext();
    if (context.type !== 'watch' || !context.videoId) return;
    if (prefetched.has(context.videoId)) return;
    prefetched.add(context.videoId);
    if (prefetched.size > 40) prefetched.delete(prefetched.values().next().value);
    GT.sw('gt:thumb-history', { videoId: context.videoId }).catch(() => {});
  }

  for (const event of ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated']) {
    document.addEventListener(event, () => { firstAttemptAt = Date.now(); schedule(event, 120); });
  }
  window.addEventListener('popstate', () => { firstAttemptAt = Date.now(); schedule('popstate', 120); });

  // 2) o DOM do YouTube é reconstruído o tempo todo: reagimos na hora em que a coluna aparece
  //    ou em que o nosso nó é removido, em vez de esperar o próximo tique.
  const observer = new MutationObserver(() => {
    if (host && !host.isConnected) {
      // o YouTube apagou nosso nó; se insistir, paramos de brigar e usamos o dock
      if (mode === 'sidebar' && ++wipes > MAX_WIPES) stickyFloating = true;
      schedule('nó removido', 60);
      return;
    }
    if (!host) schedule('DOM mudou', 60);
  });
  const startObserver = () => {
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  // 3) rede de segurança: URL trocada, layout mudou (teatro), nó sumiu
  let lastUrl = location.href;
  const heartbeat = setInterval(() => {
    if (!isCurrent() || !isAlive()) { retire(); return; }
    if (location.href !== lastUrl) {
      lastUrl = location.href; firstAttemptAt = Date.now(); wipes = 0; stickyFloating = false;
      mount('URL mudou'); setTimeout(prefetchArquivo, 800); return;
    }
    mount('tique');
  }, 800);

  window.addEventListener('resize', () => schedule('resize', 200));
  document.addEventListener('fullscreenchange', () => schedule('fullscreen', 200));

  // 4) clique no ícone da extensão abre/fecha o painel desta aba
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'gt:toggle-panel') {
      forced = true;                 // pelo ícone, o painel aparece mesmo na home
      mount('ícone');
      panel?.toggle();
    }
  });

  // 5) diagnóstico: se algo falhar, dá para inspecionar pelo console da página
  window.__gumptube = {
    get state() {
      return {
        versao: GT.VERSION,
        modo: mode,
        montado: !!host && host.isConnected,
        visivel: isVisible(host),
        contexto: GT.pageContext(),
        teatro: isTheater(),
        colunaLateral: !!sidebarTarget(),
        solucao: panel?.solutionId ?? null,
        geracao: GENERATION,
        viva: isAlive(),
        apagoes: wipes,
        dockFixo: stickyFloating,
        ultimoMotivo: lastReason
      };
    },
    remontar: () => remount('manual'),
    transcricao: () => GT.captions.diagnose()
  };

  // uma geração anterior pode ter deixado painel na tela: tiramos antes de montar o nosso
  document.getElementById(HOST_ID)?.remove();
  startObserver();
  mount('inicial');
  setTimeout(prefetchArquivo, 1500);
  // uma vez por instalação: empurra os bancos antigos (origem youtube.com) para o banco
  // central no service worker — sem isso a aba cheia não veria o acervo já salvo
  setTimeout(() => GT.db?.migrateLegacy?.().catch(() => {}), 3000);
  document.addEventListener('DOMContentLoaded', () => { startObserver(); mount('DOMContentLoaded'); });
  window.addEventListener('load', () => mount('load'));
})();
