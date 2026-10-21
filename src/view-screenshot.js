// Gumptube — solução Screenshot: varredura densa em duas passadas e exportação por cópia.
(() => {
  const GT = (window.GT = window.GT || {});
  GT.views = GT.views || {};
  const { el } = GT;
  const A = () => GT.analysis;

  const TABS = [
    { id: 'manual', label: 'Manuais' },
    { id: 'best', label: 'Melhores' },
    { id: 'camera', label: 'Câmera' },
    { id: 'face', label: 'Rosto' },
    { id: 'broll', label: 'B-roll' },
    { id: 'similar', label: 'Similares' }
  ];

  // Intervalo entre frames, em segundos — é o que decide a densidade da varredura.
  const INTERVALS = [
    { id: 2, label: '2 s' },
    { id: 3, label: '3 s' },
    { id: 5, label: '5 s' },
    { id: 10, label: '10 s' }
  ];
  // Em vídeo longo, varrer tudo a cada 2 s é inviável: dá para varrer só o trecho ao redor do player.
  const RANGES = [
    { id: 0, label: 'Vídeo todo' },
    { id: 300, label: '5 min do ponto atual' },
    { id: 900, label: '15 min do ponto atual' }
  ];
  // Resolução em que cada frame é capturado e guardado. É a mesma imagem que você copia e baixa,
  // então "alta" aqui significa alta de verdade — nada é reduzido depois.
  const QUALITIES = [
    { id: 'max', label: 'Máxima', width: 0 },      // resolução do player
    { id: 'alta', label: 'Alta', width: 1600 },
    { id: 'media', label: 'Média', width: 1024 },
    { id: 'leve', label: 'Leve', width: 640 }
  ];
  // Como varrer: seek a seek (preciso) ou reproduzindo acelerado e pegando os frames que passam
  // (turbo) — sem nenhum seek, o que muda a conta em varredura densa.
  const MODES = [
    { id: 'preciso', label: 'Preciso' },
    { id: 'turbo', label: 'Turbo' }
  ];
  const TURBO_RATE = 16;            // teto do Chrome para playbackRate
  const MAX_FRAMES = 1600;          // teto de segurança de memória

  GT.views.screenshot = {
    create(ctx) {
      // Aba cheia (⧉): não há player para capturar — mostramos a GALERIA do que foi
      // capturado na página do vídeo e guardado no banco central. Nada é recapturado.
      if (ctx.page?.app) return criarGaleria(ctx);
      let alive = true;
      let frames = [];
      let tab = 'best';
      let sort = 'melhor';
      let interval = 5;
      let range = 0;
      let columns = 2;
      let quality = 'max';        // cópia e download saem na resolução do player por padrão
      let mode = 'turbo';       // padrão: entrega os prints na maior velocidade possível
      let running = false;
      let cancelled = false;
      const selected = new Set();
      let blobUrls = [];

      function releaseBlobs() {
        for (const url of blobUrls) URL.revokeObjectURL(url);
        blobUrls = [];
      }

      const runButton = el('button', { class: 'gt-primary', onclick: () => (running ? stop() : run()) }, 'Analisar vídeo');
      const manualButton = el('button', {
        class: 'gt-chip gt-manual',
        title: 'Captura o frame que está na tela agora (atalho: tecla S)',
        onclick: () => captureManual()
      }, '⎘ Capturar agora');

      // Fluxo manual: navegue com as setas e aperte S. O frame entra na galeria já analisado,
      // com as mesmas ações de copiar, baixar e salvar no Arsenal.
      async function captureManual() {
        const player = GT.videoEl();
        if (!player || !player.videoWidth) return ctx.setStatus('Player sem vídeo carregado.');
        try {
          const width = captureWidth(player);
          const canvas = A().drawFrame(player, width);
          const time = player.currentTime || 0;

          const fullBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
          if (!fullBlob) throw new Error('Não foi possível gerar a imagem.');
          const fullUrl = URL.createObjectURL(fullBlob);
          const light = document.createElement('canvas');
          const scale = Math.min(1, 640 / canvas.width);
          light.width = Math.round(canvas.width * scale);
          light.height = Math.round(canvas.height * scale);
          light.getContext('2d').drawImage(canvas, 0, 0, light.width, light.height);
          const previewUrl = await new Promise((resolve) => light.toBlob((b) => resolve(b ? URL.createObjectURL(b) : fullUrl), 'image/jpeg', 0.86));
          blobUrls.push(fullUrl, previewUrl);

          const quality = A().measureQuality(light);
          const frame = {
            id: `m${Date.now()}`,
            time,
            dataUrl: previewUrl,
            previewUrl,
            fullUrl,
            fullBlob,
            width: canvas.width,
            height: canvas.height,
            sourceWidth: player.videoWidth,
            sourceHeight: player.videoHeight,
            hash: A().aHash(canvas),
            sig: GT.signature(canvas),
            clusterId: -1,
            representative: true,
            similar: false,
            repeated: false,
            manual: true,
            quality,
            face: A().EMPTY_FACE,
            faceDone: false,
            score: quality.score
          };
          frames = [frame, ...frames];
          tab = 'manual';
          render();
          ctx.setStatus(`Frame manual em ${GT.timeLabel(time)} · ${canvas.width}×${canvas.height}`);
          salvarNaTelaCheia(frame);   // a tela cheia (⧉) recebe só o print novo

          // análise facial em segundo plano, sem travar a captura seguinte
          A().initAnalyzer()
            .then(() => GT.loadImage(frame.previewUrl))
            .then((image) => A().analyzeFaceOf(image))
            .then((face) => {
              frame.face = face;
              frame.faceDone = true;
              frame.score = A().combinedScore(frame.quality, face);
              if (alive) render();
            })
            .catch(() => { frame.faceDone = true; });
        } catch (error) {
          ctx.setStatus(`Não foi possível capturar: ${error.message || error}`);
        }
      }

      function onKey(event) {
        if (!alive || running) return;
        if (event.key !== 's' && event.key !== 'S') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
        event.preventDefault();
        captureManual();
      }
      window.addEventListener('keydown', onKey, true);
      const densityChips = el('div', { class: 'gt-chips' });
      const rangeChips = el('div', { class: 'gt-chips' });
      const qualityChips = el('div', { class: 'gt-chips' });
      const modeChips = el('div', { class: 'gt-chips' });
      const sortChips = el('div', { class: 'gt-chips' });
      const sizeChips = el('div', { class: 'gt-chips' });
      const estimate = el('span', { class: 'gt-note' });
      const tabsBar = el('nav', { class: 'gt-tabs' });
      const grid = el('div', { class: 'gt-grid' });
      const footer = el('footer', { class: 'gt-footer' });
      // Ajustes ficam guardados: por padrão o painel mostra só as duas ações.
      const settings = el('div', { class: 'gt-settings' },
        el('div', { class: 'gt-setting' }, el('span', { class: 'gt-note' }, 'A cada'), densityChips),
        el('div', { class: 'gt-setting' }, el('span', { class: 'gt-note' }, 'Trecho'), rangeChips),
        el('div', { class: 'gt-setting' }, el('span', { class: 'gt-note' }, 'Qualidade'), qualityChips),
        el('div', { class: 'gt-setting' }, el('span', { class: 'gt-note' }, 'Modo'), modeChips),
        el('div', { class: 'gt-setting' }, el('span', { class: 'gt-note' }, 'Preview'), sizeChips),
        el('div', { class: 'gt-setting' }, el('span', { class: 'gt-note' }, 'Ordenar'), sortChips),
        el('div', { class: 'gt-setting gt-setting-wide' }, estimate)
      );
      settings.style.display = 'none';

      const settingsButton = el('button', {
        class: 'gt-chip gt-gear',
        title: 'Ajustes da varredura',
        onclick: () => {
          const aberto = settings.style.display !== 'none';
          settings.style.display = aberto ? 'none' : '';
          settingsButton.classList.toggle('active', !aberto);
        }
      }, '⚙ Ajustes');

      const root = el('div', { class: 'gt-screenshot' },
        el('div', { class: 'gt-toolbar' }, runButton, manualButton, settingsButton),
        settings,
        tabsBar, grid, footer
      );

      function renderChips() {
        GT.clear(densityChips);
        for (const item of INTERVALS) {
          densityChips.append(el('button', {
            class: `gt-chip${item.id === interval ? ' active' : ''}`,
            onclick: () => { if (running) return; interval = item.id; renderChips(); }
          }, item.label));
        }
        GT.clear(rangeChips);
        for (const item of RANGES) {
          rangeChips.append(el('button', {
            class: `gt-chip${item.id === range ? ' active' : ''}`,
            onclick: () => { if (running) return; range = item.id; renderChips(); }
          }, item.label));
        }
        GT.clear(modeChips);
        for (const item of MODES) {
          modeChips.append(el('button', {
            class: `gt-chip${item.id === mode ? ' active' : ''}`,
            title: item.id === 'turbo'
              ? 'Reproduz o vídeo acelerado e captura os frames que passam — bem mais rápido em varredura densa, mas o vídeo roda na sua frente'
              : 'Pula de ponto em ponto no vídeo; mais lento, porém não mexe na reprodução',
            onclick: () => { if (running) return; mode = item.id; renderChips(); }
          }, item.label));
        }
        GT.clear(qualityChips);
        for (const item of QUALITIES) {
          qualityChips.append(el('button', {
            class: `gt-chip${item.id === quality ? ' active' : ''}`,
            title: item.width ? `copia e baixa em até ${item.width} px de largura` : 'copia e baixa na resolução do próprio player',
            onclick: () => { if (running) return; quality = item.id; renderChips(); }
          }, item.label));
        }
        renderEstimate();
        GT.clear(sortChips);
        for (const item of [{ id: 'melhor', label: 'Melhor' }, { id: 'tempo', label: 'Tempo' }]) {
          sortChips.append(el('button', {
            class: `gt-chip${item.id === sort ? ' active' : ''}`,
            onclick: () => { sort = item.id; renderChips(); render(); }
          }, item.label));
        }
        GT.clear(sizeChips);
        for (const item of [{ id: 3, label: 'P' }, { id: 2, label: 'M' }, { id: 1, label: 'G' }]) {
          sizeChips.append(el('button', {
            class: `gt-chip${item.id === columns ? ' active' : ''}`,
            title: `${item.id} coluna${item.id === 1 ? '' : 's'} na galeria`,
            onclick: () => { columns = item.id; renderChips(); render(); }
          }, item.label));
        }
      }

      /* --------------------------------------------------------- listas */

      function counts() {
        return {
          manual: frames.filter((f) => f.manual).length,
          best: frames.filter((f) => f.representative && !f.manual).length,
          camera: frames.filter((f) => f.face.lookingAtCamera).length,
          face: frames.filter((f) => f.face.present).length,
          broll: frames.filter((f) => f.faceDone && !f.face.present).length,
          similar: frames.filter((f) => f.similar).length
        };
      }

      function visible() {
        const byTime = (a, b) => a.time - b.time;
        const byScore = (a, b) => b.score - a.score;
        if (tab === 'manual') return frames.filter((f) => f.manual).sort(sort === 'tempo' ? byTime : byScore);
        if (tab === 'camera') {
          const list = frames.filter((f) => f.face.lookingAtCamera);
          return sort === 'tempo' ? list.sort(byTime) : list.sort((a, b) => b.face.cameraScore - a.face.cameraScore);
        }
        if (tab === 'face') return frames.filter((f) => f.face.present).sort(sort === 'tempo' ? byTime : byScore);
        if (tab === 'broll') return frames.filter((f) => f.faceDone && !f.face.present).sort(sort === 'tempo' ? byTime : byScore);
        if (tab === 'similar') return frames.filter((f) => f.similar).sort(sort === 'tempo' ? byTime : byScore);
        const best = frames.filter((f) => f.representative);
        return sort === 'tempo' ? [...best].sort(byTime) : A().diverseRank(best);
      }

      function badge(frame) {
        if (tab === 'camera' || frame.face.lookingAtCamera) return `Câmera ${frame.face.cameraScore}`;
        if (frame.face.present) return frame.face.pose === 'three-quarter' ? 'Perfil 3/4' : frame.face.pose === 'profile' ? 'Perfil' : 'Rosto';
        return null;
      }

      /* ------------------------------------------------------ varredura */

      function plan(duration, currentTime = 0) {
        let from = 0;
        let to = duration;
        if (range) {
          from = Math.max(0, currentTime - range / 2);
          to = Math.min(duration, from + range);
        }
        let step = interval;
        let count = Math.floor((to - from) / step);
        let clamped = false;
        if (count > MAX_FRAMES) {                 // protege a memória em vídeo longo
          step = (to - from) / MAX_FRAMES;
          count = MAX_FRAMES;
          clamped = true;
        }
        const times = [];
        for (let t = Math.max(0.5, from); t < to - 0.3; t += step) times.push(Number(t.toFixed(2)));
        return { times, interval: step, clamped, from, to };
      }

      function captureWidth(player) {
        const chosen = QUALITIES.find((item) => item.id === quality);
        if (!chosen.width) return null;                       // null = resolução do player
        return Math.min(chosen.width, player?.videoWidth || chosen.width);
      }

      function renderEstimate() {
        const player = GT.videoEl();
        const duration = player && Number.isFinite(player.duration) ? player.duration : 0;
        if (!duration) { estimate.textContent = ''; return; }
        const { times, clamped } = plan(duration, player.currentTime || 0);
        const { from, to } = plan(duration, player.currentTime || 0);
        const seconds = mode === 'turbo'
          ? Math.round((to - from) / TURBO_RATE) + 3
          : Math.round(times.length * 0.4);

        // usa a largura ESCOLHIDA, não a atual do player — a varredura eleva a qualidade antes
        const chosen = QUALITIES.find((item) => item.id === quality);
        const width = chosen.width || Math.max(player.videoWidth || 0, 1280);
        const height = Math.round(width * ((player.videoHeight || 720) / (player.videoWidth || 1280)));
        // versão cheia + versão leve da galeria
        const megabytes = Math.round((times.length * (width * height * 0.2 + 640 * 360 * 0.2)) / 1e6);

        estimate.textContent = `≈ ${GT.int(times.length)} frames de ${width}×${height}`
          + ` · cerca de ${seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`}`
          + ` · memória ≈ ${GT.int(megabytes)} MB`
          + (clamped ? ` · intervalo ajustado ao teto de ${GT.int(MAX_FRAMES)} frames` : '');
        estimate.className = megabytes > 700 ? 'gt-note gt-warn' : 'gt-note';
      }

      async function run() {
        const player = GT.videoEl();
        if (!player || !Number.isFinite(player.duration)) {
          ctx.setStatus('Não foi possível localizar um vídeo reproduzível nesta página.');
          return;
        }
        running = true; cancelled = false;
        releaseBlobs();                      // devolve a memória da varredura anterior
        frames = []; selected.clear();
        // A varredura fica presa ao vídeo em que começou: se o YouTube trocar de vídeo (autoplay),
        // ela para ali e o que já foi capturado continua guardado para ESTE vídeo.
        const scanVideoId = ctx.videoId;
        const trocouVideo = () => !!scanVideoId && GT.currentVideoId() !== scanVideoId;
        iniciarPersistencia(scanVideoId);
        runButton.textContent = 'Cancelar';
        ctx.setProgress(0);
        renderChips(); render();

        const { paused, currentTime: original, playbackRate: rateOriginal, muted: mutedOriginal } = player;
        const { times, interval: step } = plan(player.duration, player.currentTime || 0);

        // O canvas captura na resolução em que o vídeo está TOCANDO — se o player estiver em
        // 480p automático, a "alta" sairia em 480p e ficaria igual ao preview. Antes da varredura
        // elevamos a qualidade do player para cobrir o que você escolheu; no final restauramos.
        const wantedWidth = QUALITIES.find((item) => item.id === quality).width;
        let boost = null;
        if (!wantedWidth || (player.videoWidth || 0) < wantedWidth) {
          ctx.setStatus('Elevando a qualidade do player para capturar em alta…');
          boost = await GT.raisePlayerQuality(player, wantedWidth || 0).catch(() => null);
        }

        // UMA única imagem por frame, na qualidade que você escolheu. É a mesma imagem na galeria,
        // no visualizador, na cópia e no download — nada é recapturado depois, porque um novo seek
        // no mesmo timestamp não devolve exatamente o mesmo frame.
        const previewWidth = captureWidth(player);
        const found = [];
        let previousHash = null;
        let skipped = 0;

        try {
          // Passada 1 — captura e qualidade (rápida, sem modelo facial)
          // Um frame capturado vira duas versões: cheia (cópia/download) e leve (galeria).
          const guardarFrame = async (canvas, time, hash, repetido, index) => {
            const fullBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
            if (!fullBlob) { skipped++; return; }
            const fullUrl = URL.createObjectURL(fullBlob);

            const light = document.createElement('canvas');
            const lightScale = Math.min(1, 640 / canvas.width);
            light.width = Math.round(canvas.width * lightScale);
            light.height = Math.round(canvas.height * lightScale);
            light.getContext('2d').drawImage(canvas, 0, 0, light.width, light.height);
            const previewUrl = await new Promise((resolve) => light.toBlob((b) => resolve(b ? URL.createObjectURL(b) : fullUrl), 'image/jpeg', 0.86));
            blobUrls.push(fullUrl, previewUrl);

            const quality = A().measureQuality(light);
            found.push({
              id: `f${index}`,
              time,
              dataUrl: previewUrl,
              previewUrl,
              fullUrl,
              fullBlob,
              width: canvas.width,
              height: canvas.height,
              sourceWidth: player.videoWidth,
              sourceHeight: player.videoHeight,
              hash,
              sig: GT.signature(canvas),
              clusterId: 0,
              representative: true,
              similar: false,
              repeated: repetido,
              manual: false,
              quality,
              face: A().EMPTY_FACE,
              faceDone: false,
              score: quality.score
            });
            salvarNaTelaCheia(found[found.length - 1], scanVideoId);
            frames = A().clusterFrames(found, step);
          };

          if (mode === 'turbo') {
            // TURBO: nenhum seek. O vídeo roda acelerado e pegamos os frames conforme passam.
            ctx.setStatus(`Turbo: reproduzindo a ${TURBO_RATE}× para pegar ${times.length} frames…`);
            player.muted = true;
            await A().seek(player, times[0]);
            player.playbackRate = TURBO_RATE;
            try { await player.play(); } catch { /* autoplay bloqueado: seguimos assim mesmo */ }
            const efetiva = player.playbackRate;
            if (efetiva < TURBO_RATE) ctx.setStatus(`Turbo: o player aceitou ${efetiva}× (o máximo dele)`);

            const fila = [...times];
            const fim = plan(player.duration, player.currentTime || 0).to;
            let capturados = 0;

            await new Promise((resolve) => {
              const encerrar = () => resolve();
              const passo = () => {
                if (cancelled || !alive || trocouVideo() || !fila.length) return encerrar();
                const agora = player.currentTime;
                if (agora >= fim + 0.5 || player.ended) return encerrar();

                if (agora >= fila[0]) {
                  const alvo = fila.shift();
                  while (fila.length && fila[0] <= agora) fila.shift();   // pontos já ultrapassados
                  let canvas = null;
                  try { canvas = A().drawFrame(player, previewWidth); } catch { /* frame ainda não pronto */ }
                  if (canvas) {
                    const hash = A().aHash(canvas);
                    guardarFrame(canvas, alvo, hash, false, capturados++).then(() => {
                      if (capturados % 4 === 0) {
                        ctx.setStatus(`Turbo: ${capturados} frames · ${GT.timeLabel(agora)} de ${GT.timeLabel(fim)}`);
                        ctx.setProgress(Math.round(((agora - times[0]) / Math.max(1, fim - times[0])) * 60));
                        render();
                      }
                    });
                  }
                }
                if (typeof player.requestVideoFrameCallback === 'function') player.requestVideoFrameCallback(passo);
                else setTimeout(passo, 60);
              };
              if (typeof player.requestVideoFrameCallback === 'function') player.requestVideoFrameCallback(passo);
              else setTimeout(passo, 60);
            });

            player.playbackRate = 1;
            await new Promise((resolve) => setTimeout(resolve, 120));   // deixa as últimas gravações terminarem
            render();
          } else {
            ctx.setStatus(`Capturando ${times.length} frames (1 a cada ${GT.decimal(step, 1)} s)…`);
            for (let i = 0; i < times.length; i++) {
              if (cancelled || !alive || trocouVideo()) break;
              let capture;
              try {
                capture = await A().captureAt(player, times[i], previewWidth, previousHash);
              } catch (error) {
                if (i === 0) throw error;
                skipped++;
                continue;                       // trecho sem dados: pula sem derrubar a varredura
              }
              if (trocouVideo()) break;   // o player já está em outro vídeo: este frame não é deste
              const repetido = capture.stale;   // player não entregou frame novo neste ponto
              if (repetido) skipped++;
              previousHash = capture.hash;
              await guardarFrame(capture.canvas, times[i], capture.hash, repetido, i);
              ctx.setProgress(Math.round(((i + 1) / times.length) * 60));
              if (i % 4 === 0 || i === times.length - 1) {
                ctx.setStatus(`Capturando ${i + 1}/${times.length} frames`);
                render();
              }
            }
          }

          if (cancelled || !alive || trocouVideo()) throw new Error('cancelado');

          // Passada 2 — rosto e olhar apenas nos candidatos
          ctx.setStatus('Carregando o modelo facial local…');
          await A().initAnalyzer();

          const candidates = pickFaceCandidates();
          for (let i = 0; i < candidates.length; i++) {
            if (cancelled || !alive) break;
            const frame = candidates[i];
            try {
              const image = await GT.loadImage(frame.dataUrl);
              frame.face = await A().analyzeFaceOf(image);
              frame.score = A().combinedScore(frame.quality, frame.face);
            } catch {
              /* frame sem rosto detectável segue com a pontuação de qualidade */
            }
            frame.faceDone = true;
            atualizarNaTelaCheia(frame, scanVideoId);
            ctx.setProgress(60 + Math.round(((i + 1) / candidates.length) * 40));
            if (i % 5 === 0 || i === candidates.length - 1) {
              ctx.setStatus(`Analisando rosto e olhar ${i + 1}/${candidates.length}`);
              render();                      // clusterFrames devolve cópias: só reagrupa no fim,
            }                                // senão as mutações desta passada se perderiam
          }
          frames = A().clusterFrames(frames, step);

          const scenes = new Set(frames.map((f) => f.clusterId)).size;
          const camera = frames.filter((f) => f.face.lookingAtCamera).length;
          ctx.setStatus(`${frames.length} frames · ${scenes} cena${scenes === 1 ? '' : 's'} · ${camera} com olhar para a câmera`
            + (skipped ? ` · ${skipped} repetido${skipped === 1 ? '' : 's'} (o player não avançou)` : ''));
        } catch (error) {
          if (error.message === 'cancelado' && trocouVideo()) ctx.setStatus(`O vídeo mudou: a varredura parou em ${frames.length} frames e os prints deste vídeo já estão guardados.`);
          else if (error.message === 'cancelado') ctx.setStatus(`Análise cancelada com ${frames.length} frames`);
          else ctx.setStatus(`Captura indisponível: ${error.message || error}`);
        } finally {
          if (boost) GT.restorePlayerQuality(boost).catch(() => {});   // devolve o automático
          try {
            player.playbackRate = rateOriginal || 1;
            player.muted = mutedOriginal;
            if (!trocouVideo()) {   // só devolve o ponto original se ainda for o mesmo vídeo
              await A().seek(player, original);
              if (paused) player.pause(); else await player.play();
            }
          } catch { /* o vídeo pode ter mudado no meio */ }
          running = false;
          runButton.textContent = 'Analisar vídeo';
          ctx.setProgress(null);
          renderChips(); render();
          // No finally de propósito: varredura concluída, CANCELADA ou com erro parcial —
          // o que estiver capturado vai para a tela cheia (⧉) do mesmo jeito.
          concluirPersistencia();
        }
      }

      // Todos os frames passam pelo modelo facial — senão os filtros Rosto/Câmera/B-roll ficam
      // incompletos. A ordem prioriza representantes de cena, para a tela encher pelo que importa.
      function pickFaceCandidates() {
        const pendentes = frames.filter((f) => !f.faceDone);
        const representantes = pendentes.filter((f) => f.representative);
        const resto = pendentes.filter((f) => !f.representative).sort((a, b) => b.quality.score - a.quality.score);
        return [...representantes, ...resto];
      }

      function stop() {
        cancelled = true;
        ctx.setStatus('Cancelando…');
      }

      /* ------------------------------------------- captura em alta */

      // Não existe recaptura: o que você vê na galeria é exatamente o que copia e baixa.
      function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
          reader.readAsDataURL(blob);
        });
      }

      // Gravação no banco central: cada print vai para a tela cheia (⧉) assim que é capturado,
      // em fila (uma gravação por vez). A fila NÃO depende da view: quem encerra a varredura
      // (troca de vídeo, cancelamento) não derruba o que já foi capturado.
      const LIMITE_TELA_CHEIA = 500;
      let gravados = 0;
      let filaGravacao = Promise.resolve();
      let falhaGravacao = null;
      let metaGravacao = null;
      const chaveTelaCheia = (videoId, time) => `${videoId}|${Math.round(time * 1000)}`;

      function iniciarPersistencia(videoId) {
        gravados = 0; falhaGravacao = null;
        metaGravacao = videoId ? { videoId, titulo: GT.pageTitle(), canal: GT.pageChannel() || '' } : null;
        if (!videoId) { filaGravacao = Promise.resolve(); return; }
        // a varredura nova substitui a anterior DESTE vídeo (o acervo permanente é o Arsenal)
        filaGravacao = GT.db.captures.clear(videoId).catch((error) => { falhaGravacao = error; });
      }

      function enfileirar(task) {
        filaGravacao = filaGravacao
          .then(task)
          .catch((error) => { falhaGravacao = falhaGravacao || error; });
        return filaGravacao;
      }

      function salvarNaTelaCheia(frame, videoId = ctx.videoId) {
        if (!videoId || !frame?.fullBlob || gravados >= LIMITE_TELA_CHEIA) return;
        gravados++;
        const meta = metaGravacao && metaGravacao.videoId === videoId
          ? metaGravacao
          : { titulo: GT.pageTitle(), canal: GT.pageChannel() || '' };
        enfileirar(async () => {
          const dataUrl = await blobToDataUrl(frame.fullBlob);
          // miniatura leve (640 px) para a lista de vídeos — não precisa carregar a imagem cheia
          const thumb = frame.previewUrl ? await blobToDataUrl(await (await fetch(frame.previewUrl)).blob()) : null;
          await GT.db.captures.put({
            key: chaveTelaCheia(videoId, frame.time),
            videoId,
            time: frame.time,
            takenAt: Date.now(),
            videoTitle: meta.titulo,
            channel: meta.canal,
            dataUrl,
            thumb,
            width: frame.width,
            height: frame.height,
            hash: frame.hash || '',
            score: frame.score ?? null,
            manual: !!frame.manual,
            lookingAtCamera: !!frame.face?.lookingAtCamera
          });
        });
      }

      // score e rosto mudam depois da análise facial: só os metadados são reenviados
      function atualizarNaTelaCheia(frame, videoId) {
        if (!videoId || !frame) return;
        const key = chaveTelaCheia(videoId, frame.time);
        enfileirar(() => GT.db.captures.update(key, { score: frame.score ?? null, lookingAtCamera: !!frame.face?.lookingAtCamera }));
      }

      function concluirPersistencia() {
        filaGravacao.then(() => {
          if (!alive) return;
          if (falhaGravacao) ctx.setStatus(`Capturas feitas, mas não guardei tudo para a tela cheia: ${falhaGravacao.message || falhaGravacao}`);
          else if (gravados) {
            const corte = frames.length > LIMITE_TELA_CHEIA ? ` (limite de ${LIMITE_TELA_CHEIA}; a grade aqui segue completa)` : '';
            ctx.setStatus(`${gravados} prints disponíveis na tela cheia ⧉${corte}`);
          }
        });
      }

      async function copyFrame(frame) {
        try {
          ctx.setStatus(`Copiando ${GT.timeLabel(frame.time)}…`);
          const size = await GT.copyImage(frame.fullUrl || frame.dataUrl);
          ctx.setStatus(size ? `Copiado ${size.width}×${size.height} — cole no seu editor` : 'Imagem copiada');
        } catch (error) {
          ctx.setStatus(`Não foi possível copiar: ${error.message || error}`);
        }
      }

      async function downloadFrame(frame) {
        try {
          ctx.setStatus(`Exportando ${GT.timeLabel(frame.time)}…`);
          const { blob, width, height } = await GT.toPngBlob(frame.fullUrl || frame.dataUrl);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${GT.safeName(GT.pageTitle())}-${GT.timeLabel(frame.time).replace(/:/g, '-')}.png`;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          ctx.setStatus(`Frame exportado em ${width}×${height}`);
        } catch (error) {
          ctx.setStatus(`Não foi possível exportar: ${error.message || error}`);
        }
      }

      async function saveToArsenal(frame) {
        try {
          const videoId = ctx.videoId;
          ctx.setStatus(`Salvando ${GT.timeLabel(frame.time)} no Arsenal…`);
          // o Arsenal guarda exatamente a imagem que você viu (blob vira dataURL para o IndexedDB)
          const fullDataUrl = frame.fullBlob ? await blobToDataUrl(frame.fullBlob) : (frame.fullUrl || frame.dataUrl);
          const fullWidth = frame.width;
          const fullHeight = frame.height;
          const video = await GT.data.getVideo(videoId).catch(() => null);
          await GT.db.put({
            id: `${videoId}-${Math.round(frame.time * 1000)}`,
            kind: 'frame',
            origin: 'meu-frame',
            createdAt: Date.now(),
            videoId,
            videoTitle: video?.title || GT.pageTitle(),
            videoUrl: GT.videoUrl(videoId),
            channel: video?.author || GT.pageChannel() || '',
            channelId: video?.channelId || null,
            time: frame.time,
            dataUrl: fullDataUrl,
            width: fullWidth,
            height: fullHeight,
            hash: frame.hash,
            sig: frame.sig,
            score: frame.score,
            tags: [],
            note: '',
            views: Number.isFinite(video?.views) ? video.views : null,
            publishedAt: video?.publishDate || null
          });
          ctx.setStatus(`Frame ${GT.timeLabel(frame.time)} salvo no Arsenal em ${fullWidth}×${fullHeight}`);
        } catch {
          ctx.setStatus('Não foi possível salvar no Arsenal.');
        }
      }

      // Download em massa: um único .zip, porque N downloads seguidos o Chrome bloqueia.
      let zipando = false;
      async function downloadLote() {
        if (zipando) return;
        const lista = selected.size
          ? visible().filter((item) => selected.has(item.id))
          : visible();
        if (!lista.length) return ctx.setStatus('Nada para baixar nesta aba.');

        zipando = true;
        ctx.setProgress(0);
        try {
          const ordenados = [...lista].sort((a, b) => a.time - b.time);
          const entradas = [];
          for (let i = 0; i < ordenados.length; i++) {
            const frame = ordenados[i];
            const blob = frame.fullBlob || (frame.fullUrl ? await fetch(frame.fullUrl).then((r) => r.blob()) : null);
            if (!blob) continue;
            const posicao = String(i + 1).padStart(3, '0');
            entradas.push({ nome: `${posicao}-${GT.timeLabel(frame.time).replace(/:/g, 'm')}s.jpg`, blob });
          }

          ctx.setStatus(`Empacotando ${entradas.length} frames…`);
          const zip = await GT.makeZip(entradas, (feitos, total) => {
            ctx.setProgress(Math.round((feitos / total) * 100));
            if (feitos % 10 === 0) ctx.setStatus(`Empacotando ${feitos}/${total} frames…`);
          });

          const url = URL.createObjectURL(zip);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${GT.safeName(GT.pageTitle())}-frames.zip`;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);

          const mb = (zip.size / 1e6).toFixed(1).replace('.', ',');
          ctx.setStatus(`${entradas.length} frames baixados em um .zip de ${mb} MB`);
        } catch (error) {
          ctx.setStatus(`Não foi possível empacotar: ${error.message || error}`);
        } finally {
          zipando = false;
          ctx.setProgress(null);
        }
      }

      /* ---------------------------------------------------------- modal */

      function openModal(startFrame) {
        const list = visible();
        let index = list.findIndex((frame) => frame.id === startFrame.id);
        const image = el('img', { src: startFrame.dataUrl, alt: '' });
        const caption = el('p', {});
        const prev = el('button', { class: 'gt-nav', html: '&lsaquo;', onclick: () => step(-1) });
        const next = el('button', { class: 'gt-nav', html: '&rsaquo;', onclick: () => step(1) });

        const modal = el('div', { class: 'gt-modal', onclick: (event) => { if (event.target === modal) close(); } },
          el('div', { class: 'gt-modal-body' },
            el('div', { class: 'gt-modal-stage' }, prev, image, next),
            caption,
            el('div', { class: 'gt-modal-actions' },
              el('button', { onclick: () => copyFrame(list[index]) }, '⧉ Copiar imagem'),
              el('button', { class: 'ghost', onclick: () => saveToArsenal(list[index]) }, 'Salvar no Arsenal'),
              el('button', { class: 'ghost', onclick: () => downloadFrame(list[index]) }, 'Baixar'),
              el('button', { class: 'ghost', onclick: () => close() }, 'Fechar')
            )
          )
        );

        function paint() {
          const frame = list[index];
          image.src = frame.fullUrl || frame.dataUrl;   // mesma captura da galeria, em tamanho cheio
          const face = frame.face.present
            ? ` · rosto ${frame.face.score}${frame.face.lookingAtCamera ? ` · câmera ${frame.face.cameraScore}` : ''}`
            : frame.faceDone ? ' · sem rosto' : ' · rosto pendente';
          const origem = frame.sourceWidth && frame.sourceWidth !== frame.width ? ` (player ${frame.sourceWidth}×${frame.sourceHeight})` : '';
          caption.textContent = `${GT.timeLabel(frame.time)} · copia em ${frame.width}×${frame.height}${origem}`
            + ` · score ${frame.score}${face} · ${index + 1}/${list.length}`;
          prev.disabled = index <= 0;
          next.disabled = index >= list.length - 1;
        }
        function step(delta) {
          const target = index + delta;
          if (target < 0 || target >= list.length) return;
          index = target;
          paint();
        }
        function onKey(event) {
          if (event.key === 'Escape') { event.preventDefault(); close(); }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
          else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
        }
        function close() { window.removeEventListener('keydown', onKey, true); modal.remove(); }

        window.addEventListener('keydown', onKey, true);
        paint();
        ctx.layer.append(modal);
      }

      /* --------------------------------------------------------- render */

      function render() {
        if (!alive) return;
        const stats = counts();
        GT.clear(tabsBar);
        for (const item of TABS) {
          tabsBar.append(el('button', {
            class: item.id === tab ? 'active' : '',
            onclick: () => { tab = item.id; render(); }
          }, item.label, el('em', {}, String(stats[item.id] || 0))));
        }

        grid.className = `gt-grid gt-cols-${columns}`;
        GT.clear(grid);
        const list = visible();
        if (!frames.length) {
          grid.append(el('div', { class: 'gt-empty' },
            running ? 'Capturando frames…' : 'Clique em Analisar vídeo para varrer o vídeo e pontuar nitidez, rosto e olhar para a câmera.'
          ));
        } else if (!list.length) {
          grid.append(el('div', { class: 'gt-empty' },
            tab === 'camera'
              ? 'Nenhum frame com olhar assertivo para a câmera nesta varredura. Tente a densidade Denso, ou veja a aba Rosto.'
              : 'Nenhum frame nesta aba.'
          ));
        } else {
          for (const frame of list) {
            const label = badge(frame);
            grid.append(el('article', { class: `gt-item gt-frame${selected.has(frame.id) ? ' selected' : ''}` },
              el('img', { src: frame.dataUrl, alt: `Frame em ${GT.timeLabel(frame.time)}`, loading: 'lazy', onclick: () => openModal(frame) }),
              label && el('b', { class: 'gt-sim' }, label),
              el('div', { class: 'gt-frame-bar' },
                el('input', {
                  type: 'checkbox',
                  checked: selected.has(frame.id),
                  title: 'Selecionar para baixar em lote',
                  onchange: (event) => {
                    if (event.target.checked) selected.add(frame.id); else selected.delete(frame.id);
                    renderFooter();
                  }
                }),
                el('button', { class: 'gt-time', title: 'Ir para este ponto do vídeo', onclick: () => { const player = GT.videoEl(); if (player) player.currentTime = frame.time; } }, GT.timeLabel(frame.time)),
                el('button', { class: 'gt-star gt-copy', title: 'Copiar esta imagem', onclick: () => copyFrame(frame) }, '⧉'),
                el('button', { class: 'gt-star', title: 'Salvar no Arsenal', onclick: () => saveToArsenal(frame) }, '★'),
                el('span', {}, frame.score)
              )
            ));
          }
        }
        renderFooter();
      }

      function renderFooter() {
        GT.clear(footer);
        const scenes = new Set(frames.map((f) => f.clusterId)).size;
        const pending = frames.filter((f) => !f.faceDone).length;
        footer.append(el('span', {}, frames.length
          ? `${frames.length} frames · ${scenes} cena${scenes === 1 ? '' : 's'}${pending ? ` · ${pending} sem análise facial` : ''}`
          : 'Nenhum frame analisado'));
        const naAba = visible().length;
        if (naAba) {
          footer.append(el('button', {
            onclick: downloadLote,
            title: selected.size
              ? 'Baixa os frames marcados num único arquivo .zip'
              : 'Baixa todos os frames desta aba num único arquivo .zip'
          }, selected.size ? `⤓ Baixar ${selected.size} selecionados` : `⤓ Baixar todos (${naAba})`));
        }
      }

      renderChips();

      if (ctx.page.type !== 'watch') {
        runButton.disabled = true;
        GT.clear(grid).append(el('div', { class: 'gt-empty' },
          'Abra um vídeo para varrer os frames.',
          el('br'), el('small', {}, 'Na grade, passe o mouse sobre uma thumbnail para copiar a imagem oficial em alta.')
        ));
        ctx.setStatus('Aguardando um vídeo');
        return {
          el: root,
          destroy() { alive = false; cancelled = true; window.removeEventListener('keydown', onKey, true); releaseBlobs(); }
        };
      }

      render();
      return {
        el: root,
        destroy() {
          alive = false; cancelled = true;
          window.removeEventListener('keydown', onKey, true);
          releaseBlobs();
        }
      };
    }
  };

  // Reduz a imagem para o envio (largura máxima em px), em JPEG. Mantém a proporção.
  async function reduzirParaEnvio(dataUrl, maxWidth) {
    const image = await GT.loadImage(dataUrl);
    const w0 = image.naturalWidth || image.width, h0 = image.naturalHeight || image.height;
    const scale = Math.min(1, maxWidth / w0);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w0 * scale); canvas.height = Math.round(h0 * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  // Página HTML autocontida: CSS, imagens e script embutidos. Filtros, ordem, download por print
  // e lightbox funcionam offline. Cada imagem entra UMA vez (o link de download usa a mesma imagem).
  function montarHtmlGaleria({ titulo, canal, videoId, itens, gerado }) {
    const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (s) => { const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; const p = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`; };
    // "melhores" = 25% com maior score (mesma regra da galeria da tela cheia)
    const comScore = itens.map((item, i) => ({ i, score: item.score })).filter((x) => Number.isFinite(x.score)).sort((a, b) => b.score - a.score);
    const melhores = new Set(comScore.slice(0, Math.max(1, Math.ceil(comScore.length * 0.25))).map((x) => x.i));
    const cards = itens.map((item, i) => {
      const legenda = [`${item.width}×${item.height}`, item.score != null ? `score ${item.score}` : null, item.manual ? 'manual' : null, item.camera ? 'olhar para a câmera' : null].filter(Boolean).join(' · ');
      return `<figure class="card" data-time="${item.time}" data-score="${item.score ?? ''}" data-manual="${item.manual ? 1 : 0}" data-camera="${item.camera ? 1 : 0}" data-best="${melhores.has(i) ? 1 : 0}" data-nome="${esc(item.nome)}">`
        + `<a class="open" href="#" title="Ampliar"><img src="${item.img}" alt="Print em ${fmt(item.time)}" loading="lazy"></a>`
        + `<figcaption><a class="yt" href="https://www.youtube.com/watch?v=${esc(item.videoId)}&amp;t=${Math.floor(item.time)}s" target="_blank" rel="noopener">▶ ${fmt(item.time)}</a>`
        + `<span>${esc(legenda)}</span><a class="dl" href="#" title="Baixar este print">⇩</a></figcaption></figure>`;
    }).join('\n');
    const n = itens.length;
    const totais = { todos: n, melhores: melhores.size, manual: itens.filter((x) => x.manual).length, camera: itens.filter((x) => x.camera).length };
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · galeria de prints</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0f0f0f;color:#f1f1f1;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{padding:22px 28px 4px}h1{margin:0 0 4px;font-size:22px}header p{margin:0;color:#aaa;font-size:13px}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 28px;background:#0f0f0f;border-bottom:1px solid #222}
.bar button,.bar select{font:inherit;color:#f1f1f1;background:#1d1d1d;border:1px solid #333;border-radius:999px;padding:6px 12px;cursor:pointer}
.bar button.on,.bar button:hover{border-color:#ff4d5e;color:#ff4d5e}
.bar em{font-style:normal;color:#888;margin-left:4px}.bar label{color:#aaa;font-size:13px}
#contagem{margin-left:auto;color:#888;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding:16px 28px 40px}
.card{margin:0;background:#1b1b1b;border:1px solid #2a2a2a;border-radius:10px;overflow:hidden}
.card img{display:block;width:100%;height:auto;cursor:zoom-in}
figcaption{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 10px;font-size:12px;color:#aaa}
figcaption a{color:#ff4d5e;font-weight:700;text-decoration:none}
figcaption .dl{font-size:16px;padding:0 4px}
figcaption span{flex:1;text-align:right;margin-right:4px}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;z-index:9}
.lightbox.on{display:flex}.lightbox img{max-width:100%;max-height:100%;border-radius:6px}
</style></head><body>
<header><h1>${esc(titulo)}</h1><p>${canal ? esc(canal) + ' · ' : ''}${n} prints · gerado em ${esc(gerado.toLocaleString('pt-BR'))}</p></header>
<nav class="bar">
  <button class="on" data-f="todos">Todos<em>${totais.todos}</em></button>
  <button data-f="melhores">Melhores<em>${totais.melhores}</em></button>
  <button data-f="manual">Manuais<em>${totais.manual}</em></button>
  <button data-f="camera">Olhar para a câmera<em>${totais.camera}</em></button>
  <label>Ordem <select id="ordem"><option value="tempo">Por tempo</option><option value="score">Melhores primeiro</option></select></label>
  <button id="baixar">⇩ Baixar visíveis</button>
  <span id="contagem"></span>
</nav>
<main class="grid" id="grid">
${cards}
</main>
<div class="lightbox" id="lb"><img alt=""></div>
<script>
(function(){
  var grid=document.getElementById('grid');
  var cards=Array.prototype.slice.call(grid.querySelectorAll('.card'));
  var filtro='todos', ordem='tempo';
  var contagem=document.getElementById('contagem'), lb=document.getElementById('lb');
  function passa(c){ if(filtro==='todos') return true; var k=filtro==='melhores'?'best':filtro; return c.getAttribute('data-'+k)==='1'; }
  function pontos(c){ var s=parseFloat(c.getAttribute('data-score')); return isNaN(s)?-1:s; }
  function render(){
    cards.slice().sort(function(a,b){ return ordem==='score' ? pontos(b)-pontos(a) : parseFloat(a.getAttribute('data-time'))-parseFloat(b.getAttribute('data-time')); })
      .forEach(function(c){ grid.appendChild(c); c.style.display = passa(c)?'':'none'; });
    contagem.textContent = cards.filter(passa).length + ' de ' + cards.length + ' prints';
  }
  document.querySelectorAll('[data-f]').forEach(function(b){ b.addEventListener('click', function(){
    filtro=b.getAttribute('data-f');
    document.querySelectorAll('[data-f]').forEach(function(x){ x.classList.toggle('on', x===b); });
    render();
  }); });
  document.getElementById('ordem').addEventListener('change', function(e){ ordem=e.target.value; render(); });
  function baixar(c){ var a=document.createElement('a'); a.href=c.querySelector('img').src; a.download=c.getAttribute('data-nome')||'print.jpg'; document.body.appendChild(a); a.click(); a.remove(); }
  grid.addEventListener('click', function(e){
    var dl=e.target.closest('.dl');
    if(dl){ e.preventDefault(); baixar(dl.closest('.card')); return; }
    var open=e.target.closest('.open');
    if(open){ e.preventDefault(); lb.querySelector('img').src=open.querySelector('img').src; lb.classList.add('on'); }
  });
  lb.addEventListener('click', function(){ lb.classList.remove('on'); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') lb.classList.remove('on'); });
  document.getElementById('baixar').addEventListener('click', function(){
    var visiveis=cards.filter(function(c){ return c.style.display!=='none'; });
    visiveis.forEach(function(c,i){ setTimeout(function(){ baixar(c); }, i*400); });
  });
  render();
})();
</script></body></html>`;
  }

  /* ====================== GALERIA DA TELA CHEIA (aba da extensão) ====================== */
  // Mostra as capturas guardadas pela página do vídeo, com as mesmas saídas: baixar em
  // resolução nativa, copiar, Arsenal e zip. As imagens viajam do banco uma a uma — a grade
  // aparece na hora e os prints vão preenchendo em sequência.
  function criarGaleria(ctx) {
    let alive = true;
    let videoId = ctx.videoId || '';
    let metas = [];
    const imagens = new Map();
    const imgEls = new Map();
    const selecionados = new Set();
    let ordem = 'tempo';
    let filtro = 'todos';
    let tamanhoPreview = 'amplo';

    const cabecalho = el('p', { class: 'gt-note', style: { padding: '2px 12px 0' } });
    const status = el('p', { class: 'gt-note', style: { padding: '0 12px' } }, 'Carregando capturas…');
    const filtros = el('div', { class: 'gt-tabs gt-gallery-filters' });
    const tamanhosPreview = el('div', { class: 'gt-chips gt-preview-size' });
    const barra = el('div', { class: 'gt-toolbar', style: { display: 'none' } },
      el('select', { class: 'gt-input gt-input-mini', onchange: (event) => { ordem = event.target.value; render(); } },
        el('option', { value: 'tempo' }, 'Por tempo'),
        el('option', { value: 'score' }, 'Melhores primeiro')
      ),
      el('span', { class: 'gt-note' }, 'Preview'), tamanhosPreview,
      el('button', { class: 'gt-chip', onclick: selecionarTudo }, 'Selecionar tudo'),
      el('button', { class: 'gt-chip', onclick: baixarZip }, '⇩ Seleção em .zip'),
      el('button', { class: 'gt-chip', onclick: salvarSelecao }, '★ Seleção no Arsenal'),
      el('button', { class: 'gt-chip', title: 'Galeria única em HTML, imagens reduzidas (960 px). Filtros, ordem e download por print.', onclick: () => exportarGaleria(960) }, '⤴ Galeria (leve)'),
      el('button', { class: 'gt-chip', title: 'Galeria única em HTML com as capturas em resolução original (arquivo bem maior).', onclick: () => exportarGaleria(0) }, '⤴ Galeria (original)')
    );
    const grid = el('div', { class: 'gt-grid gt-gallery-grid' });
    const root = el('div', { class: 'gt-gallery' }, cabecalho, status, filtros, barra, grid);
    const rotuloTempo = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    function contagens() {
      const melhores = melhoresKeys();
      return {
        todos: metas.length,
        melhores: melhores.size,
        manual: metas.filter((m) => m.manual).length,
        camera: metas.filter((m) => m.lookingAtCamera).length
      };
    }
    function melhoresKeys() {
      const comScore = metas.filter((m) => Number.isFinite(m.score)).sort((a, b) => b.score - a.score);
      return new Set(comScore.slice(0, Math.max(1, Math.ceil(comScore.length * .25))).map((m) => m.key));
    }
    function listaOrdenada() {
      const melhores = melhoresKeys();
      const filtrada = metas.filter((m) => filtro === 'todos' || (filtro === 'melhores' && melhores.has(m.key)) || (filtro === 'manual' && m.manual) || (filtro === 'camera' && m.lookingAtCamera));
      return filtrada.sort((a, b) => (ordem === 'score' ? (b.score ?? -1) - (a.score ?? -1) : a.time - b.time));
    }
    function renderTamanhosPreview() {
      const tamanhos = [
        { id: 'compacto', label: 'P', title: 'Thumbs compactas' },
        { id: 'medio', label: 'M', title: 'Thumbs médias' },
        { id: 'amplo', label: 'G', title: 'Thumbs grandes' }
      ];
      GT.clear(tamanhosPreview);
      tamanhos.forEach((item) => tamanhosPreview.append(el('button', {
        class: `gt-chip${item.id === tamanhoPreview ? ' active' : ''}`,
        title: item.title,
        onclick: () => { tamanhoPreview = item.id; render(); }
      }, item.label)));
    }
    function renderFiltros() {
      const labels = { todos: 'Todos', melhores: 'Melhores', manual: 'Manuais', camera: 'Câmera' };
      const totals = contagens();
      GT.clear(filtros);
      Object.keys(labels).forEach((id) => filtros.append(el('button', {
        class: id === filtro ? 'active' : '', onclick: () => { filtro = id; render(); }
      }, labels[id], el('em', {}, String(totals[id])))));
    }

    async function carregar() {
      try {
        if (videoId) {
          metas = await GT.db.captures.list(videoId);
          if (!alive) return;
          if (metas.length) {
            const info = metas[metas.length - 1];
            cabecalho.textContent = `${info.videoTitle || videoId} · ${metas.length} prints · capturados em ${rotuloTempo(info.takenAt)}`;
            barra.style.display = 'flex'; status.textContent = 'Preparando previews…'; render();
            await carregarImagens(); return;
          }
        }
        await mostrarIndice();
      } catch (error) { status.textContent = `Não consegui ler as capturas do banco: ${error.message || error}`; }
    }
    async function mostrarIndice() {
      let indice;
      try { indice = await GT.db.captures.index(); } catch (error) { status.textContent = `Não consegui consultar o banco de capturas: ${error.message || error}`; return; }
      if (!alive) return;
      GT.clear(grid); GT.clear(filtros); barra.style.display = 'none';
      grid.className = 'gt-cover-grid';
      if (!indice.length) { status.textContent = 'Nenhum print guardado ainda. Capture na página do vídeo e a varredura aparecerá aqui automaticamente.'; return; }
      status.textContent = videoId ? 'Este vídeo ainda não tem prints. Varreduras recentes:' : 'Escolha uma varredura guardada:';
      for (const item of indice) {
        const img = el('img', { alt: '', src: item.thumb || GT.PIXEL || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' });
        grid.append(el('button', { class: 'gt-cover', title: 'Abrir as capturas deste vídeo', onclick: () => {
          videoId = item.videoId; filtro = 'todos'; selecionados.clear(); imagens.clear(); imgEls.clear(); carregar();
        } },
          el('span', { class: 'gt-cover-thumb' }, img),
          el('b', {}, item.videoTitle || item.videoId),
          el('span', { class: 'gt-note' }, `${item.total} prints · ${rotuloTempo(item.takenAt)}`)
        ));
        if (!item.thumb && item.coverKey) gerarCapa(item.coverKey, img);   // legado: gera a capa uma vez
      }
    }
    // Registros guardados antes da miniatura: gera a capa a partir da imagem e grava de volta,
    // para acontecer só uma vez por vídeo.
    async function gerarCapa(key, img) {
      try {
        const row = await GT.db.captures.get(key);
        if (!row?.dataUrl || !alive) return;
        const thumb = await reduzirParaEnvio(row.dataUrl, 640);
        img.src = thumb;
        await GT.db.captures.update(key, { thumb });
      } catch { /* sem capa: fica o marcador */ }
    }
    async function carregarImagens() {
      let prontas = 0;
      for (const meta of metas) {
        if (!alive) return;
        if (!imagens.has(meta.key)) try { const row = await GT.db.captures.get(meta.key); if (row?.dataUrl) imagens.set(meta.key, row.dataUrl); } catch { /* item indisponível */ }
        const img = imgEls.get(meta.key), dataUrl = imagens.get(meta.key);
        if (img && dataUrl) img.src = dataUrl;
        prontas++;
        if (prontas % 12 === 0) status.textContent = `Preparando previews ${prontas}/${metas.length}…`;
      }
      status.textContent = `${metas.length} prints prontos. Clique em um print para abrir o preview; use a caixa para selecionar em lote.`;
    }
    function render() {
      renderFiltros(); renderTamanhosPreview(); GT.clear(grid); imgEls.clear();
      grid.className = `gt-grid gt-gallery-grid gt-preview-${tamanhoPreview}`;
      const lista = listaOrdenada();
      if (!lista.length) { grid.append(el('div', { class: 'gt-empty' }, 'Nenhum print neste filtro.')); return; }
      for (const meta of lista) {
        const dataUrl = imagens.get(meta.key);
        const img = el('img', { src: dataUrl || GT.PIXEL || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', alt: `Print em ${GT.timeLabel(meta.time)}`, loading: 'lazy', onclick: () => abrirPreview(meta) });
        imgEls.set(meta.key, img);
        grid.append(el('article', { class: `gt-item gt-frame${selecionados.has(meta.key) ? ' selected' : ''}` }, img,
          el('div', { class: 'gt-frame-bar' },
            el('input', { type: 'checkbox', checked: selecionados.has(meta.key), title: 'Selecionar para exportação em lote', onchange: (event) => { if (event.target.checked) selecionados.add(meta.key); else selecionados.delete(meta.key); render(); } }),
            el('button', { class: 'gt-time', title: 'Abrir o vídeo no instante deste frame', onclick: () => abrirNoYoutube(meta) }, `▶ ${GT.timeLabel(meta.time)}`),
            el('span', { class: 'gt-note' }, meta.score != null ? `${meta.score}` : (meta.manual ? 'manual' : ''))
          )
        ));
      }
    }
    const exigirImagem = (meta) => { const dataUrl = imagens.get(meta.key); if (!dataUrl) throw new Error(`o print ${GT.timeLabel(meta.time)} ainda está carregando.`); return dataUrl; };
    function abrirNoYoutube(meta) { window.open(`${GT.videoUrl(meta.videoId)}&t=${Math.floor(meta.time)}s`, '_blank', 'noopener'); }
    function selecionarTudo() { const lista = listaOrdenada(); if (lista.every((m) => selecionados.has(m.key))) lista.forEach((m) => selecionados.delete(m.key)); else lista.forEach((m) => selecionados.add(m.key)); render(); }
    function baixar(meta) { try { const link = el('a', { href: exigirImagem(meta), download: `${GT.safeName(meta.videoTitle || meta.videoId)}-${GT.timeLabel(meta.time).replace(/:/g, 'm')}s.jpg` }); document.body.append(link); link.click(); link.remove(); } catch (error) { status.textContent = String(error.message || error); } }
    async function copiar(meta) { try { status.textContent = `Copiando ${GT.timeLabel(meta.time)}…`; const size = await GT.copyImage(exigirImagem(meta)); status.textContent = size ? `Copiado ${size.width}×${size.height} — cole no seu editor.` : 'Print copiado.'; } catch (error) { status.textContent = `Não consegui copiar: ${error.message || error}`; } }
    async function salvarNoArsenal(meta) { const dataUrl = exigirImagem(meta), image = await GT.loadImage(dataUrl); await GT.db.put({ id: `${meta.videoId}-${Math.round(meta.time * 1000)}`, kind: 'frame', origin: 'meu-frame', createdAt: Date.now(), videoId: meta.videoId, videoTitle: meta.videoTitle || '', videoUrl: GT.videoUrl(meta.videoId), channel: meta.channel || '', channelId: null, time: meta.time, dataUrl, width: meta.width, height: meta.height, hash: meta.hash || '', sig: GT.signature(image), score: meta.score ?? null, tags: [], note: '', views: null, publishedAt: null }); }
    function abrirPreview(startMeta) {
      const lista = listaOrdenada(); let index = Math.max(0, lista.findIndex((m) => m.key === startMeta.key));
      const image = el('img', { alt: '' }), caption = el('p', {});
      const prev = el('button', { class: 'gt-nav', html: '&lsaquo;', onclick: () => passo(-1) });
      const next = el('button', { class: 'gt-nav', html: '&rsaquo;', onclick: () => passo(1) });
      const modal = el('div', { class: 'gt-modal', onclick: (event) => { if (event.target === modal) fechar(); } }, el('div', { class: 'gt-modal-body' },
        el('div', { class: 'gt-modal-stage' }, prev, image, next), caption,
        el('div', { class: 'gt-modal-actions' },
          el('button', { onclick: () => copiar(lista[index]) }, '⧉ Copiar'), el('button', { class: 'ghost', onclick: () => baixar(lista[index]) }, 'Baixar'),
          el('button', { class: 'ghost', onclick: () => abrirNoYoutube(lista[index]) }, '▶ Abrir no YouTube'), el('button', { class: 'ghost', onclick: async () => { try { await salvarNoArsenal(lista[index]); status.textContent = 'Print salvo no Arsenal.'; } catch (e) { status.textContent = `Falha ao salvar: ${e.message || e}`; } } }, '★ Arsenal'),
          el('button', { class: 'ghost', onclick: fechar }, 'Fechar')
        )
      ));
      function pintar() { const meta = lista[index]; image.src = exigirImagem(meta); caption.textContent = `${GT.timeLabel(meta.time)} · ${meta.width}×${meta.height}${meta.score != null ? ` · score ${meta.score}` : ''} · ${index + 1}/${lista.length}`; prev.disabled = index <= 0; next.disabled = index >= lista.length - 1; }
      function passo(delta) { const target = index + delta; if (target < 0 || target >= lista.length) return; index = target; pintar(); }
      function teclas(event) { if (event.key === 'Escape') { event.preventDefault(); fechar(); } else if (event.key === 'ArrowLeft') passo(-1); else if (event.key === 'ArrowRight') passo(1); }
      function fechar() { window.removeEventListener('keydown', teclas, true); modal.remove(); }
      window.addEventListener('keydown', teclas, true); pintar(); ctx.layer.append(modal);
    }
    async function salvarSelecao() { const lista = listaOrdenada().filter((m) => selecionados.has(m.key)); if (!lista.length) { status.textContent = 'Marque ao menos um print pela caixa de seleção.'; return; } let feitos = 0; try { for (const meta of lista) { await salvarNoArsenal(meta); feitos++; status.textContent = `Salvando no Arsenal ${feitos}/${lista.length}…`; } status.textContent = `${feitos} prints no Arsenal.`; } catch (error) { status.textContent = `Salvei ${feitos}/${lista.length}; parou em: ${error.message || error}`; } }
    async function baixarZip() { const lista = listaOrdenada().filter((m) => selecionados.has(m.key)).sort((a, b) => a.time - b.time); if (!lista.length) { status.textContent = 'Marque ao menos um print pela caixa de seleção.'; return; } try { const entradas = []; for (let i = 0; i < lista.length; i++) entradas.push({ nome: `${String(i + 1).padStart(3, '0')}-${GT.timeLabel(lista[i].time).replace(/:/g, 'm')}s.jpg`, blob: await (await fetch(exigirImagem(lista[i]))).blob() }); status.textContent = `Empacotando ${entradas.length} prints…`; const zip = await GT.makeZip(entradas); const url = URL.createObjectURL(zip), link = el('a', { href: url, download: `${GT.safeName(lista[0].videoTitle || videoId)}-prints.zip` }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); status.textContent = `${entradas.length} prints no zip, em resolução nativa.`; } catch (error) { status.textContent = `O zip falhou: ${error.message || error}`; } }
    // Galeria compartilhável: uma página HTML só, com as imagens embutidas. Não depende do banco
    // nem do YouTube. "leve" reduz para 960 px (arquivo enviável); "original" mantém a captura cheia.
    async function exportarGaleria(largura = 960) {
      const marcados = listaOrdenada().filter((m) => selecionados.has(m.key));
      const lista = (marcados.length ? marcados : listaOrdenada()).slice().sort((a, b) => a.time - b.time);
      if (!lista.length) { status.textContent = 'Nenhum print para compartilhar neste filtro.'; return; }
      try {
        const itens = [];
        for (let i = 0; i < lista.length; i++) {
          const meta = lista[i];
          status.textContent = `Preparando a galeria ${i + 1}/${lista.length}…`;
          if (!imagens.has(meta.key)) {
            const row = await GT.db.captures.get(meta.key);
            if (row?.dataUrl) imagens.set(meta.key, row.dataUrl);
          }
          const dataUrl = imagens.get(meta.key);
          if (!dataUrl) continue;
          const titulo = meta.videoTitle || videoId || 'Galeria';
          itens.push({
            videoId: meta.videoId, time: meta.time, width: meta.width, height: meta.height,
            score: meta.score ?? null, manual: !!meta.manual, camera: !!meta.lookingAtCamera,
            nome: `${GT.safeName(titulo)}-${GT.timeLabel(meta.time).replace(/:/g, 'm')}s.jpg`,
            img: largura ? await reduzirParaEnvio(dataUrl, largura) : dataUrl
          });
        }
        if (!itens.length) { status.textContent = 'Não consegui ler as imagens para a galeria.'; return; }
        const titulo = lista[0].videoTitle || videoId || 'Galeria';
        const html = montarHtmlGaleria({ titulo, canal: lista[0].channel || '', videoId: lista[0].videoId, itens, gerado: new Date() });
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = el('a', { href: url, download: `${GT.safeName(titulo)}-galeria.html` });
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        const mb = (blob.size / 1e6).toFixed(1);
        status.textContent = `Galeria com ${itens.length} prints salva (${mb} MB, ${largura ? `${largura} px` : 'original'}). É um arquivo único: envie para quem quiser.`;
      } catch (error) { status.textContent = `Não consegui gerar a galeria: ${error.message || error}`; }
    }
    carregar();
    return { el: root, destroy() { alive = false; } };
  }
})();
