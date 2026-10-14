// Gumptube — ponte de qualidade. Roda no MUNDO DA PÁGINA (world: MAIN), porque a API
// real do player (#movie_player.setPlaybackQualityRange) não existe no mundo isolado
// do content script. Conversa apenas por postMessage com mensagens gt-quality.
(() => {
  if (window.__gtQualityBridge) return;
  window.__gtQualityBridge = true;

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.type !== 'gt-quality') return;
    const reply = { type: 'gt-quality-result', id: data.id, ok: false };
    const player = document.getElementById('movie_player');
    try {
      if (data.action === 'get' && player && typeof player.getAvailableQualityLevels === 'function') {
        reply.current = typeof player.getPlaybackQuality === 'function' ? player.getPlaybackQuality() : null;
        reply.available = player.getAvailableQualityLevels().filter((level) => level && level !== 'auto');
        reply.ok = true;
      } else if (data.action === 'set' && data.quality && player && typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(data.quality, data.quality);
        if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(data.quality);
        reply.ok = true;
      } else if (data.action === 'restore' && player && typeof player.setPlaybackQualityRange === 'function') {
        try {
          player.setPlaybackQualityRange('auto');            // devolve o controle ao automático
        } catch {
          if (data.quality) player.setPlaybackQualityRange(data.quality, data.quality);
        }
        reply.ok = true;
      }
    } catch { /* player em transição: responde ok=false e o content script segue sem boost */ }
    window.postMessage(reply, window.location.origin);
  });
})();
