// Gumptube — bootstrap da aba cheia (app.html).
// Reusa o painel e as views do YouTube; o que depende do player da página é avisado com
// honestidade (Screenshot precisa do <video> real — aqui vira um atalho de volta).
(() => {
  const GT = window.GT;
  const { el } = GT;

  const params = new URLSearchParams(location.search);
  const videoId = (params.get('video') || '').trim();
  const solucaoParam = params.get('solucao');
  const solucao = solucaoParam && GT.solution(solucaoParam) ? solucaoParam : undefined;

  // Contexto: com ?video=… as views funcionam como numa página de vídeo (os dados vêm do
  // service worker; o que só existe no DOM do YouTube — comentários, inscritos — degrada
  // com aviso, sem inventar número).
  const context = videoId
    ? { type: 'watch', videoId, path: '/watch', app: true }
    : { type: 'other', videoId: '', path: '/app', app: true };

  // Na aba cheia, a solução Screenshot mostra a GALERIA das capturas feitas na página do
  // vídeo (a própria view detecta o modo pelo contexto app:true) — os prints ficam no banco
  // central, então continuam aqui mesmo depois de fechar a aba do YouTube.
  const screenshotSolution = GT.solution('screenshot');
  if (screenshotSolution) {
    screenshotSolution.tagline = 'Suas capturas, em tela grande';
    screenshotSolution.description = 'Os frames capturados na página do vídeo aparecem aqui automaticamente — selecione, compare, baixe, copie ou salve no Arsenal.';
  }

  const panel = GT.createPanel(context, {
    app: true,
    initialSolution: solucao !== undefined ? solucao : (videoId ? 'dados' : undefined)
  });
  document.getElementById('gt-app-root').append(panel.el);
  document.title = videoId ? `Gumptube · ${videoId}` : 'Gumptube';

  // a janela pode mudar de tamanho: o corpo acompanha
  window.addEventListener('resize', () => {
    panel.el.style.setProperty('--gt-body-max', `${Math.round((window.innerHeight || 900) * 0.8)}px`);
  });
})();
