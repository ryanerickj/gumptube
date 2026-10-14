// Gumptube — solução Dados. Na página do vídeo vira um dashboard de verdade: KPIs, donuts,
// medidor de outlier, pizza de distribuição, tendência das suas visitas, testes/trocas de
// thumbnail e histórico de títulos. Na página de um canal vira Channelytics.
(() => {
  const GT = (window.GT = window.GT || {});
  GT.views = GT.views || {};
  const { el } = GT;

  const CORES = ['#e51937', '#2bd97c', '#9ad7ff', '#ffd76a', '#b78cff', '#f0984f'];
  const CINZA = '#5a6066';

  function card(label, value, source, hint) {
    const na = value === 'indisponível';
    return el('div', { class: 'gt-metric' },
      el('span', { class: 'gt-metric-label' }, label),
      el('strong', { class: `gt-metric-value${na ? ' na' : ''}` }, value),
      hint && el('i', { class: 'gt-metric-hint' }, hint),
      source && el('b', { class: 'gt-src' }, source)
    );
  }

  function sect(title, hint) {
    return el('div', { class: 'gt-sect' },
      el('strong', {}, title),
      hint && el('span', {}, hint)
    );
  }

  const dataDeMs = (ms) => GT.dateLabel(new Date(ms).toISOString());
  const curto = (texto, teto = 18) => {
    const valor = String(texto || 'sem título');
    return valor.length > teto ? `${valor.slice(0, teto - 1)}…` : valor;
  };

  /* ------------------------------------------------------- gráficos */

  // Anel de progresso (donut) com valor no centro. `cap` define o fundo de escala.
  function donut(valor, cap, centro, rotulo, detalhe, cor = 'var(--gt-accent)') {
    const fatia = Math.max(2, Math.min(100, (valor / cap) * 100));
    return el('div', { class: 'gt-donut-wrap' },
      el('div', { class: 'gt-donut', style: { background: `conic-gradient(${cor} ${fatia}%, #33383a ${fatia}% 100%)` } },
        el('b', {}, centro)),
      el('span', {}, rotulo),
      detalhe && el('small', {}, detalhe)
    );
  }

  // Medidor horizontal 0–4× para o multiplicador de outlier.
  function gauge(ratio) {
    const pos = Math.max(1.5, Math.min(98.5, (ratio / 4) * 100));
    return el('div', { class: 'gt-gauge' },
      el('div', { class: 'gt-gauge-track' }, el('i', { style: { left: `${pos}%` } })),
      el('div', { class: 'gt-gauge-ticks' },
        ['0×', '1×', '2×', '3×', '4×+'].map((tick) => el('span', {}, tick)))
    );
  }

  // Pizza com legenda. fatias: [{ label, value, cor, destaque?, title? }]
  function pizza(fatias) {
    const total = fatias.reduce((soma, fatia) => soma + fatia.value, 0);
    if (!total) return null;
    let acumulado = 0;
    const paradas = fatias.map((fatia) => {
      const de = (acumulado / total) * 100;
      acumulado += fatia.value;
      return `${fatia.cor} ${de.toFixed(2)}% ${((acumulado / total) * 100).toFixed(2)}%`;
    });
    return el('div', { class: 'gt-pie-wrap' },
      el('div', { class: 'gt-pie', style: { background: `conic-gradient(${paradas.join(', ')})` } }),
      el('div', { class: 'gt-legend' },
        fatias.map((fatia) => el('span', { class: `gt-legend-item${fatia.destaque ? ' destaque' : ''}`, title: fatia.title || fatia.label },
          el('i', { style: { background: fatia.cor } }),
          `${fatia.label} · ${GT.decimal((fatia.value / total) * 100, 0)}%`)))
    );
  }

  // Linha de tendência (SVG) das views registradas nas suas visitas.
  function tendencia(rows) {
    if (!rows || rows.length < 2) return null;
    const w = 320, h = 72, pad = 8;
    const xs = rows.map((row) => row.takenAt);
    const ys = rows.map((row) => row.views);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const px = (x) => pad + (maxX === minX ? 0.5 : (x - minX) / (maxX - minX)) * (w - 2 * pad);
    const py = (y) => h - pad - (maxY === minY ? 0.5 : (y - minY) / (maxY - minY)) * (h - 2 * pad);
    const pontos = rows.map((row) => `${px(row.takenAt).toFixed(1)},${py(row.views).toFixed(1)}`);
    const area = `${px(xs[0]).toFixed(1)},${h - pad} ${pontos.join(' ')} ${px(xs[xs.length - 1]).toFixed(1)},${h - pad}`;
    const bolinhas = rows.map((row) =>
      `<circle cx="${px(row.takenAt).toFixed(1)}" cy="${py(row.views).toFixed(1)}" r="2.5" fill="#e51937"/>`).join('');
    return el('div', { class: 'gt-trend' },
      el('div', {
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`
          + `<polygon points="${area}" fill="rgba(229,25,55,.15)"/>`
          + `<polyline points="${pontos.join(' ')}" fill="none" stroke="#e51937" stroke-width="2"/>`
          + bolinhas
          + '</svg>'
      }),
      el('div', { class: 'gt-trend-eixo' },
        el('span', {}, `${dataDeMs(minX)} · ${GT.compact(minY)}`),
        el('span', {}, `${dataDeMs(maxX)} · ${GT.compact(maxY)}`))
    );
  }

  // Barras dos uploads recentes, com linha tracejada na mediana do canal.
  function sparkline(videos, videoId, median) {
    const withViews = videos.filter((item) => Number.isFinite(item.views));
    if (withViews.length < 2) return null;
    const max = Math.max(...withViews.map((item) => item.views));
    return el('div', { class: 'gt-spark' },
      Number.isFinite(median) && max > 0 && el('i', {
        class: 'gt-spark-median',
        style: { bottom: `${Math.min(96, (median / max) * 100)}%` },
        title: `mediana · ${GT.compact(median)} views`
      }),
      [...videos].reverse().map((item) => el('span', {
        class: `gt-bar${item.videoId === videoId ? ' current' : ''}${Number.isFinite(item.views) ? '' : ' unknown'}`,
        style: { height: `${Number.isFinite(item.views) ? Math.max(4, Math.round((item.views / max) * 100)) : 4}%` },
        title: `${item.title || 'sem título'} — ${Number.isFinite(item.views) ? `${GT.int(item.views)} views` : 'views indisponíveis'}`
      }))
    );
  }

  // Pizza da distribuição de views entre os uploads recentes (top 5 + outros).
  function pizzaDoFeed(videos, videoIdAtual) {
    const comViews = videos.filter((item) => Number.isFinite(item.views) && item.views > 0);
    if (comViews.length < 3) return null;
    const ordenados = [...comViews].sort((a, b) => b.views - a.views);
    const top = ordenados.slice(0, 5);
    const resto = ordenados.slice(5).reduce((soma, item) => soma + item.views, 0);
    const fatias = top.map((item, index) => ({
      label: curto(item.title) + (item.videoId === videoIdAtual ? ' (este)' : ''),
      title: item.title,
      value: item.views,
      cor: CORES[index],
      destaque: item.videoId === videoIdAtual
    }));
    if (resto > 0) fatias.push({ label: `outros ${ordenados.length - 5}`, value: resto, cor: CINZA });
    return pizza(fatias);
  }

  // mediana dos intervalos entre uploads → frequência de publicação
  function uploadRhythm(videos) {
    const dates = videos.map((item) => new Date(item.published).getTime()).filter((value) => !Number.isNaN(value)).sort((a, b) => b - a);
    if (dates.length < 3) return null;
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i - 1] - dates[i]) / 86400e3);
    return GT.data.median(gaps);
  }

  GT.views.dados = {
    create(ctx) {
      let alive = true;
      const body = el('div', { class: 'gt-dados' }, el('div', { class: 'gt-loading' }, 'Lendo os dados públicos'));
      const root = el('div', {}, body);

      /* ------------------------------------------------ página do vídeo */

      async function loadVideo() {
        const videoId = ctx.videoId;
        ctx.setStatus('Carregando dados do vídeo…');

        let video = null;
        let failure = null;
        try {
          video = await GT.data.getVideo(videoId);
        } catch (error) {
          failure = error.message || String(error);
        }
        if (!alive) return;
        GT.clear(body);

        if (!video) {
          body.append(el('div', { class: 'gt-empty' }, 'Não foi possível ler os dados públicos deste vídeo.', el('br'), el('small', {}, failure || 'Fonte indisponível.')));
          ctx.setStatus('Dados indisponíveis');
          return;
        }

        const views = Number.isFinite(video.views) ? video.views : null;
        const days = GT.daysSince(video.publishDate);
        // likes: botão da página OU o contador embutido no JSON da própria página do vídeo
        const likes = GT.data.likesFromDom()
          || (Number.isFinite(video.likes) ? { value: video.likes, source: 'página do vídeo', precision: 'exato' } : null);
        const subs = GT.data.subsFromDom();
        const comments = GT.data.commentsFromDom();
        const perDay = views !== null && days !== null && days >= 1 ? views / days : null;
        const engagement = likes && views ? (likes.value / views) * 100 : null;

        const graficos = [];
        if (engagement !== null) {
          graficos.push(donut(engagement, 8, `${GT.decimal(engagement, 1)}%`, 'Engajamento', 'likes ÷ views · escala 0–8%'));
        }
        if (comments && views) {
          const por1k = (comments.value / views) * 1000;
          graficos.push(donut(por1k, 15, GT.decimal(por1k, 1), 'Comentários / 1k views', 'escala 0–15', '#9ad7ff'));
        }
        if (likes && comments) {
          const conversa = (comments.value / likes.value) * 100;
          graficos.push(donut(conversa, 25, `${GT.decimal(conversa, 0)}%`, 'Comentários / likes', 'escala 0–25%', '#ffd76a'));
        }

        const heroThumb = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
        body.append(
          el('div', { class: 'gt-dash-hero' },
            el('img', {
              src: heroThumb,
              alt: 'Thumbnail atual',
              onclick: () => ctx.preview(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, video.title || 'Thumbnail atual')
            }),
            el('div', { class: 'gt-dash-hero-info' },
              el('strong', {}, video.title || GT.pageTitle()),
              el('span', {}, video.author || GT.pageChannel() || '—', video.category ? ` · ${video.category}` : ''),
              el('span', {}, video.publishDate ? `Publicado em ${GT.dateLabel(video.publishDate)} · ${GT.ageLabel(video.publishDate)}` : 'Data de publicação indisponível')
            )
          ),

          sect('Desempenho', 'fontes públicas, sem estimativa'),
          el('div', { class: 'gt-metrics' },
            card('Views', views === null ? 'indisponível' : GT.int(views), 'página do vídeo · exato'),
            card('Views por dia', perDay === null ? 'indisponível' : GT.int(perDay), 'calculado', days !== null ? `média sobre ${GT.int(days)} dia${Math.round(days) === 1 ? '' : 's'}` : null),
            card('Likes', likes ? GT.int(likes.value) : 'indisponível', likes ? `${likes.source} · ${likes.precision}` : null),
            card('Comentários', comments ? GT.int(comments.value) : 'indisponível', comments ? `${comments.source} · ${comments.precision}` : 'role até os comentários e reabra'),
            card('Duração', video.lengthSeconds ? GT.timeLabel(video.lengthSeconds) : 'indisponível', 'player'),
            card('Inscritos do canal', subs ? GT.compact(subs.value) : 'indisponível', subs ? `${subs.source} · ${subs.precision}` : null)
          ),
          // body.append é DOM puro e não filtra null — o wrapper display:contents não gera caixa
          el('div', { style: { display: 'contents' } },
            graficos.length ? el('div', { class: 'gt-panelcard gt-charts' }, graficos) : null),
          el('div', { id: 'gt-trend-slot' }),
          el('div', { id: 'gt-history' }),

          sect('Comparado ao canal', 'mediana dos uploads recentes'),
          el('div', { class: 'gt-panelcard', id: 'gt-outlier' }, el('div', { class: 'gt-loading' }, 'Comparando com os uploads recentes do canal')),

          sect('Thumbnail', 'testes A/B e trocas'),
          el('div', { class: 'gt-panelcard', id: 'gt-thumb' }, el('div', { class: 'gt-loading' }, 'Conferindo a thumbnail atual')),

          sect('Título', 'trocas observadas e arquivo público'),
          el('div', { class: 'gt-panelcard', id: 'gt-title' })
        );

        ctx.setStatus('Dados carregados');
        loadOutlier(video, views);
        loadThumbnail(videoId);
        loadTitle(videoId, video);
        loadHistory(videoId, views, likes?.value ?? null, video.title || null);
      }

      async function loadOutlier(video, views) {
        const slot = body.querySelector('#gt-outlier');
        if (!slot) return;
        if (!video.channelId) {
          GT.clear(slot).append(el('p', { class: 'gt-note' }, 'Canal não identificado nesta página — sem comparação com os uploads recentes.'));
          return;
        }
        let feed = null;
        let failure = null;
        try {
          feed = await GT.data.getChannelFeed(video.channelId);
        } catch (error) {
          failure = error.message || String(error);
        }
        if (!alive || !body.contains(slot)) return;

        const result = GT.data.outlier(views, feed, video.videoId);
        GT.clear(slot);
        if (!result) return slot.append(el('p', { class: 'gt-note' }, `Comparação indisponível. ${failure || 'O feed do canal não trouxe views.'}`));
        if (result.unavailable) return slot.append(el('p', { class: 'gt-note' }, result.unavailable));

        const tone = result.ratio >= 2 ? 'hot' : result.ratio >= 1 ? 'warm' : 'cold';
        const torta = pizzaDoFeed(result.videos, video.videoId);
        slot.append(el('div', { class: `gt-outlier ${tone}` },
          el('div', { class: 'gt-outlier-main' },
            el('strong', {}, `${GT.decimal(result.ratio, 2)}×`),
            el('span', {}, 'a mediana dos uploads recentes do canal')
          ),
          gauge(result.ratio),
          el('p', { class: 'gt-note' },
            `Mediana ${GT.compact(result.median)} views · amostra de ${result.sample} vídeo${result.sample === 1 ? '' : 's'} do feed RSS`,
            result.position ? ` · este é o ${result.position}º mais visto entre os ${result.total} recentes` : ''
          ),
          sparkline(result.videos, video.videoId, result.median),
          torta && el('p', { class: 'gt-note' }, 'Como as views se dividem entre os uploads recentes:'),
          torta,
          el('p', { class: 'gt-note gt-caveat' }, 'Comparação relativa ao próprio canal. O feed traz os 15 uploads mais recentes e inclui Shorts, quando o canal publica Shorts.')
        ));
      }

      /* --------------------------------------------- thumbnail: testes e trocas */
      // O YouTube alterna a arte de um teste A/B por IMPRESSÃO, não por formato — e pode fixar
      // a variante por sessão/região. Então a resposta vem de QUATRO fontes, da mais imediata
      // à mais confiável: a sondagem de agora, o que esta máquina viu ao longo dos dias,
      // o arquivo público (retroativo) e a thumbnail atual.
      function idDeEntrada(texto) {
        const valor = String(texto || '').trim();
        if (!valor) return '';
        const watch = valor.match(/[?&]v=([\w-]{6,})/);
        if (watch) return watch[1];
        const curtoLink = valor.match(/youtu\.be\/([\w-]{6,})/);
        if (curtoLink) return curtoLink[1];
        const shorts = valor.match(/\/shorts\/([\w-]{6,})/);
        if (shorts) return shorts[1];
        return /^[\w-]{6,}$/.test(valor) ? valor : '';
      }

      function caixaDeConsulta(atualId) {
        const campo = el('input', {
          class: 'gt-input',
          placeholder: 'Investigar outro vídeo: cole o link ou o ID',
          onkeydown: (event) => { if (event.key === 'Enter') disparar(); }
        });
        const botao = el('button', { class: 'gt-chip', onclick: () => disparar() }, 'Investigar');
        function disparar() {
          const id = idDeEntrada(campo.value);
          if (!id) return ctx.setStatus('Link ou ID não reconhecido.');
          if (id === atualId) return ctx.setStatus('Esse já é o vídeo aberto.');
          loadThumbnail(id, { avulso: true });
        }
        return el('div', { class: 'gt-toolbar gt-toolbar-thin' }, campo, botao);
      }

      async function loadThumbnail(videoId, { avulso = false } = {}) {
        const slot = body.querySelector('#gt-thumb');
        if (!slot) return;
        if (avulso) {
          GT.clear(slot).append(el('div', { class: 'gt-loading' }, `Consultando o vídeo ${videoId}`));
          ctx.setStatus(`Consultando ${videoId}…`);
        }

        let atual = null;
        try {
          const thumb = await GT.sw('gt:thumb', { videoId, fresh: true });
          atual = thumb;
          await GT.thumbs.sample(videoId, thumb.dataUrl, 'página do vídeo').catch(() => {});
        } catch { /* seguimos com o que der */ }
        if (!alive || !body.contains(slot)) return;

        GT.clear(slot).append(
          el('div', { class: 'gt-thumb-head' },
            el('strong', {}, avulso ? `Thumbnail · ${videoId}` : 'Agora'),
            el('span', { id: 'gt-thumb-resumo' }, 'consultando o arquivo público (5 a 30 s na primeira vez)')
          ),
          el('div', { id: 'gt-thumb-ab' }, el('p', { class: 'gt-note' }, 'Gerando impressões reais para flagrar teste A/B de thumbnail e título (10–20 s)…')),
          el('div', { id: 'gt-thumb-linha' }, atual
            ? el('div', { class: 'gt-thumb-strip' },
                el('figure', { class: 'gt-thumb-item current' },
                  el('img', { src: atual.dataUrl, alt: 'Thumbnail atual', onclick: () => ctx.preview(atual.dataUrl, 'Thumbnail atual') }),
                  el('figcaption', {}, 'no ar agora')
                ))
            : el('p', { class: 'gt-note' }, 'Thumbnail atual indisponível.')),
          el('div', { id: 'gt-thumb-local' }),
          el('p', { class: 'gt-note gt-caveat', id: 'gt-thumb-nota' },
            'Como funciona: a sondagem gera impressões reais na busca interna do YouTube. Durante um Teste e Comparar, o arquivo servido ganha sufixo “custom_N” que identifica a variante sorteada — por isso o veredito é confirmado, não estimado. O registro local acumula o que esta máquina viu em cada visita; datas retroativas vêm do Internet Archive.'),
          caixaDeConsulta(videoId)
        );

        carregarArquivo(videoId);
        carregarVariantes(videoId);
        carregarObservadas(videoId);
      }

      async function carregarArquivo(videoId) {
        const resumo = body.querySelector('#gt-thumb-resumo');
        const linha = body.querySelector('#gt-thumb-linha');
        if (!linha) return;
        let dados = null;
        let falha = null;
        try {
          dados = await GT.sw('gt:thumb-history', { videoId }, 60000);
        } catch (error) {
          falha = error.message || String(error);
        }
        if (!alive || !body.contains(linha)) return;

        const versoes = dados?.versoes || [];
        if (!versoes.length) {
          if (resumo) resumo.textContent = falha
            ? `arquivo público indisponível agora (${falha})`
            : 'este vídeo não está no arquivo público — sem histórico retroativo';
          return;
        }

        if (resumo) {
          resumo.textContent = versoes.length === 1
            ? `1 arte registrada no arquivo desde ${GT.dateLabel(versoes[0].capturadoEm)}`
            : `${versoes.length} artes diferentes no arquivo · última troca capturada em ${GT.dateLabel(versoes[versoes.length - 1].capturadoEm)}`;
        }

        const atualEl = linha.querySelector('.gt-thumb-item.current');
        GT.clear(linha);
        const strip = el('div', { class: 'gt-thumb-strip' });
        if (atualEl) strip.append(atualEl);

        for (const versao of [...versoes].reverse()) {
          strip.append(el('figure', { class: 'gt-thumb-item' },
            el('img', {
              src: versao.url,
              alt: `Arte capturada em ${GT.dateLabel(versao.capturadoEm)}`,
              loading: 'lazy',
              onclick: () => ctx.preview(versao.url, `Arte capturada em ${GT.dateLabel(versao.capturadoEm)}`)
            }),
            el('figcaption', {}, GT.dateLabel(versao.capturadoEm))
          ));
        }
        linha.append(strip);

        if (versoes.length > 1) {
          const trocas = [];
          for (let i = 1; i < versoes.length; i++) {
            trocas.push(`${GT.dateLabel(versoes[i - 1].capturadoEm)} → ${GT.dateLabel(versoes[i].capturadoEm)}`);
          }
          linha.append(el('p', { class: 'gt-note' },
            `Trocas observadas entre capturas do arquivo: ${trocas.slice(-4).join(' · ')}`));
        }
      }

      // Sondagem de AGORA: várias impressões reais na busca interna. Durante um teste, o arquivo
      // servido chama *_custom_N.jpg — o sufixo identifica a variante, então o veredito é direto.
      async function carregarVariantes(videoId) {
        const slot = body.querySelector('#gt-thumb-ab');
        if (!slot) return;
        let dados = null;
        try {
          // sondagem sai do content script: same-origin com a página, o YouTube aceita
          // (do service worker o Origin é chrome-extension:// e o endpoint devolve 403)
          dados = await GT.data.amostrarImpressoes(videoId);
        } catch (error) {
          // reserva: tenta pelo service worker antes de desistir
          try {
            dados = await GT.sw('gt:thumb-variants', { videoId }, 45000);
          } catch {
            if (alive && body.contains(slot)) {
              GT.clear(slot).append(el('p', { class: 'gt-note' },
                `A sondagem de impressões falhou agora: ${error.message || error}`));
            }
            return;
          }
        }
        if (!alive || !body.contains(slot)) return;

        // baixa a imagem de cada variante pelo service worker (URL assinada; sem ela dá 404)
        for (const v of dados.variantes || []) {
          if (!v.dataUrl && v.url) {
            v.dataUrl = (await GT.sw('gt:image', { url: v.url }).catch(() => null))?.dataUrl || null;
          }
        }
        if (!alive || !body.contains(slot)) return;

        const variantes = dados.variantes || [];
        const custom = variantes.filter((v) => v.teste);
        GT.clear(slot);

        if (dados.emTeste) {
          slot.append(
            el('p', { class: 'gt-flag ab' },
              `Teste A/B de thumbnail CONFIRMADO: o YouTube está sorteando a arte por impressão — `
              + `${custom.length} variante${custom.length === 1 ? '' : 's'} flagrada${custom.length === 1 ? '' : 's'} em ${dados.colhidas} impressões.`),
            el('div', { class: 'gt-thumb-strip' },
              custom.map((v) => el('figure', { class: 'gt-thumb-item' },
                v.dataUrl
                  ? el('img', {
                      src: v.dataUrl,
                      alt: `Variante ${v.indice}`,
                      onclick: () => ctx.preview(v.dataUrl, `Variante ${v.indice} · sorteada ${v.vezes}× em ${dados.colhidas} impressões`)
                    })
                  : el('span', { class: 'gt-note' }, 'imagem indisponível'),
                el('figcaption', {}, `variante ${v.indice} · ${v.vezes}/${dados.colhidas} impressões`)
              ))),
            custom.length === 1
              ? el('p', { class: 'gt-note' }, 'Só uma variante caiu nesta amostra — as outras existem (o sufixo “custom” só aparece durante teste). Amostre de novo para flagrar as demais.')
              : null,
            el('button', { class: 'gt-chip', onclick: () => {
              GT.clear(slot).append(el('p', { class: 'gt-note' }, 'Amostrando mais impressões…'));
              carregarVariantes(videoId);
            } }, 'Amostrar de novo')
          );
        } else {
          slot.append(el('p', { class: 'gt-note' },
            `${dados.colhidas} impressões reais amostradas agora e o arquivo servido não tem sufixo de teste — `,
            el('b', {}, 'nenhum Teste e Comparar de thumbnail rodando neste momento.'),
            ' ', el('i', {}, 'Trocas passadas aparecem no arquivo público acima e no registro local abaixo.')),
            el('p', { class: 'gt-note gt-caveat' },
              `Diagnóstico: arquivos servidos — ${variantes.map((v) => `${v.arquivo} (${v.vezes}×)`).join(', ')}`
              + (dados.falhas ? ` · ${dados.falhas} amostra${dados.falhas === 1 ? '' : 's'} falhou` : '')),
            el('button', { class: 'gt-chip', onclick: () => {
              GT.clear(slot).append(el('p', { class: 'gt-note' }, 'Amostrando mais impressões…'));
              carregarVariantes(videoId);
            } }, 'Amostrar de novo'));
        }

        // teste de TÍTULO: a mesma amostra traz o título sorteado em cada impressão
        const titulos = dados.titulos || [];
        if (titulos.length > 1) {
          const alvo = body.querySelector('#gt-title');
          if (alvo) {
            alvo.prepend(el('p', { class: 'gt-flag ab' },
              `Teste A/B de TÍTULO confirmado: ${titulos.length} títulos alternando em ${dados.colhidas} impressões — `
              + titulos.map((t) => `“${t.texto}” (${t.vezes}×)`).join(' · ')));
          }
        }

        // cada variante flagrada entra no registro local — é o que data o teste daqui pra frente
        for (const v of variantes) {
          if (v.dataUrl) await GT.thumbs.sample(videoId, v.dataUrl, v.teste ? `variante ${v.indice}` : 'impressão da busca').catch(() => {});
        }
        carregarObservadas(videoId);
      }

      // Registro local: o que ESTA máquina viu, com datas — alternância = teste A/B em curso.
      async function carregarObservadas(videoId) {
        const slot = body.querySelector('#gt-thumb-local');
        if (!slot) return;
        let lista = [];
        try {
          lista = await GT.thumbs.list(videoId);
        } catch {
          return;
        }
        if (!alive || !body.contains(slot) || !lista.length) return;

        GT.clear(slot);
        if (lista.length === 1) {
          slot.append(el('p', { class: 'gt-note' },
            `Registro local: 1 arte vista nesta máquina desde ${dataDeMs(lista[0].firstSeen)} (${lista[0].seenCount || 1}× conferida).`));
          return;
        }

        const sobrepostas = GT.thumbs.overlapping(lista);
        slot.append(
          sobrepostas.length
            ? el('p', { class: 'gt-flag ab' },
                `Teste A/B flagrado pelo registro local: ${lista.length} artes alternando em períodos sobrepostos nesta máquina.`)
            : el('p', { class: 'gt-flag change' },
                `${lista.length} artes vistas nesta máquina em períodos distintos — troca de thumbnail, com datas abaixo.`),
          el('div', { class: 'gt-thumb-strip' },
            lista.map((row) => el('figure', { class: 'gt-thumb-item' },
              el('img', {
                src: row.dataUrl,
                alt: 'Arte vista nesta máquina',
                loading: 'lazy',
                onclick: () => ctx.preview(row.dataUrl, `Vista de ${dataDeMs(row.firstSeen)} a ${dataDeMs(row.lastSeen)} · ${row.seenCount || 1}×`)
              }),
              el('figcaption', {}, `${dataDeMs(row.firstSeen)} → ${dataDeMs(row.lastSeen)} · ${row.seenCount || 1}×`)
            )))
        );
      }

      /* --------------------------------------------------- título: histórico */

      async function loadTitle(videoId, video) {
        const slot = body.querySelector('#gt-title');
        if (!slot) return;
        GT.clear(slot);

        const tituloAtual = video.title || GT.pageTitle();
        slot.append(el('div', { class: 'gt-title-row current' },
          el('b', {}, tituloAtual || '—'),
          el('small', {}, 'no ar agora')
        ));

        // trocas que ESTA máquina presenciou (snapshots diários guardam o título)
        try {
          const snapshots = await GT.db.videoSnapshots(videoId);
          const locais = [];
          for (const row of snapshots) {
            if (!row.title) continue;
            const anterior = locais[locais.length - 1];
            if (anterior && anterior.title === row.title) anterior.ate = row.takenAt;
            else locais.push({ title: row.title, de: row.takenAt, ate: row.takenAt });
          }
          if (alive && body.contains(slot) && locais.length > 1) {
            slot.append(el('p', { class: 'gt-flag change' }, `Troca de título presenciada nesta máquina (${locais.length} versões):`));
            for (const item of [...locais].reverse().slice(0, 5)) {
              if (item.title === tituloAtual) continue;
              slot.append(el('div', { class: 'gt-title-row' },
                el('b', {}, item.title),
                el('small', {}, `visto de ${dataDeMs(item.de)} a ${dataDeMs(item.ate)}`)
              ));
            }
          }
        } catch { /* registro local é bônus */ }

        const resultado = el('div', { class: 'gt-title-resultado' });
        const botao = el('button', {
          class: 'gt-chip',
          onclick: async () => {
            botao.disabled = true;
            botao.textContent = 'Lendo capturas do arquivo público… (30 s a 2 min)';
            try {
              const dados = await GT.sw('gt:title-history', { videoId }, 150000);
              if (!alive || !body.contains(slot)) return;
              GT.clear(resultado);
              const titulos = dados?.titulos || [];
              if (!titulos.length) {
                resultado.append(el('p', { class: 'gt-note' },
                  dados?.capturas
                    ? 'As capturas do arquivo não expuseram o título (páginas antigas incompletas ou bloqueadas na época do crawl).'
                    : 'Este vídeo não está no arquivo público — sem histórico retroativo de título.'));
              } else {
                resultado.append(el('p', { class: 'gt-note' },
                  `${titulos.length} título${titulos.length === 1 ? '' : 's'} no arquivo público (${dados.amostradas || titulos.length} capturas lidas de ${dados.capturas}). A troca aconteceu entre uma captura e a seguinte.`));
                for (const item of [...titulos].reverse()) {
                  const mesmoQueAtual = item.titulo === tituloAtual;
                  resultado.append(el('div', { class: `gt-title-row${mesmoQueAtual ? ' current' : ''}` },
                    el('b', {}, item.titulo),
                    el('small', {}, item.capturadoEm === item.vistoAte
                      ? `capturado em ${GT.dateLabel(item.capturadoEm)}`
                      : `capturado de ${GT.dateLabel(item.capturadoEm)} a ${GT.dateLabel(item.vistoAte)}`,
                      mesmoQueAtual ? ' · é o título atual' : '')
                  ));
                }
                const ultimo = titulos[titulos.length - 1];
                if (ultimo && ultimo.titulo !== tituloAtual) {
                  resultado.append(el('p', { class: 'gt-flag change' },
                    `O título mudou depois da última captura do arquivo (${GT.dateLabel(ultimo.vistoAte)}).`));
                }
              }
              botao.remove();
            } catch (error) {
              botao.disabled = false;
              botao.textContent = 'Buscar histórico de títulos no arquivo público';
              GT.clear(resultado).append(el('p', { class: 'gt-note' },
                `Falhou agora: ${error.message || error} — o arquivo costuma oscilar; vale tentar de novo.`));
            }
          }
        }, 'Buscar histórico de títulos no arquivo público');

        slot.append(botao, resultado,
          el('p', { class: 'gt-note gt-caveat' },
            'Datas retroativas vêm das capturas do Internet Archive (até 8 leituras espalhadas). Daqui pra frente, cada visita sua registra o título do dia — trocas futuras aparecem automaticamente.'));
      }

      /* ----------------------------------------------- histórico local de views */

      async function loadHistory(videoId, views, likes, title) {
        const slot = body.querySelector('#gt-history');
        if (!slot || views === null) return;
        try {
          const previous = await GT.db.videoSnapshots(videoId);
          const today = new Date().toISOString().slice(0, 10);
          const earlier = previous.filter((row) => row.day !== today);
          await GT.db.saveVideoSnapshot(videoId, { views, likes, title });
          if (!alive || !body.contains(slot)) return;
          GT.clear(slot);

          // tendência real das SUAS visitas (um ponto por dia visitado)
          const pontos = [...earlier.filter((row) => Number.isFinite(row.views)), { takenAt: Date.now(), views }];
          const trendSlot = body.querySelector('#gt-trend-slot');
          if (trendSlot && pontos.length >= 2) {
            GT.clear(trendSlot).append(el('div', { class: 'gt-panelcard' },
              el('p', { class: 'gt-note' }, `Crescimento registrado nas suas visitas (${pontos.length} dias):`),
              tendencia(pontos)
            ));
          }

          const last = earlier[earlier.length - 1];
          if (!last) {
            slot.append(el('p', { class: 'gt-note' }, 'Primeiro registro deste vídeo na sua Gumptube. A cada visita, o gráfico de crescimento ganha um ponto por dia.'));
            return;
          }
          const delta = views - last.views;
          const days = Math.max(1, Math.round((Date.now() - last.takenAt) / 86400e3));
          slot.append(el('p', { class: 'gt-note' },
            el('b', { class: delta >= 0 ? 'gt-up' : 'gt-down' }, `${delta >= 0 ? '+' : ''}${GT.int(delta)} views`),
            ` desde ${dataDeMs(last.takenAt)} · ${GT.int(delta / days)}/dia no período`
          ));
          if (last.title && title && last.title !== title) {
            slot.append(el('p', { class: 'gt-flag change' },
              `O título mudou desde ${dataDeMs(last.takenAt)}: era "${last.title}".`));
          }
        } catch { /* histórico é bônus */ }
      }

      /* ---------------------------------------------- página do canal */

      async function loadChannel() {
        ctx.setStatus('Lendo o canal…');
        let channel = null;
        let feed = null;
        let failure = null;
        try {
          channel = await GT.sw('gt:channel-page', { path: ctx.page.channelPath });
          feed = await GT.data.getChannelFeed(channel.channelId);
        } catch (error) {
          failure = error.message || String(error);
        }
        if (!alive) return;
        GT.clear(body);

        if (!feed) {
          body.append(el('div', { class: 'gt-empty' }, 'Não foi possível ler os uploads recentes deste canal.', el('br'), el('small', {}, failure || '')));
          ctx.setStatus('Canal indisponível');
          return;
        }

        const withViews = feed.videos.filter((item) => Number.isFinite(item.views));
        const values = withViews.map((item) => item.views);
        const median = GT.data.median(values);
        const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        const rhythm = uploadRhythm(feed.videos);
        const subs = GT.parseCount(channel?.subsText);
        const torta = pizzaDoFeed(feed.videos, null);

        body.append(
          el('div', { class: 'gt-video-head' },
            el('strong', {}, channel?.name || feed.channelName || 'Canal'),
            el('span', {}, `${feed.videos.length} uploads recentes no feed público`)
          ),
          sect('Canal em números', 'feed RSS público'),
          el('div', { class: 'gt-metrics' },
            card('Inscritos', subs ? GT.compact(subs) : 'indisponível', subs ? 'página do canal · aproximado' : null),
            card('Mediana de views', median ? GT.compact(median) : 'indisponível', 'RSS · calculado', `${withViews.length} vídeos com views`),
            card('Média de views', average ? GT.compact(average) : 'indisponível', 'RSS · calculado'),
            card('Ritmo de upload', rhythm ? `${GT.decimal(rhythm, 1)} dias` : 'indisponível', 'RSS · calculado', 'mediana entre publicações')
          ),
          sect('Uploads recentes', 'multiplicador sobre a mediana do canal'),
          el('div', { class: 'gt-panelcard' },
            sparkline(feed.videos, null, median),
            torta && el('p', { class: 'gt-note' }, 'Como as views se dividem entre os uploads recentes:'),
            torta,
            el('div', { class: 'gt-list' },
              feed.videos.map((item) => {
                const ratio = median && Number.isFinite(item.views) ? item.views / median : null;
                const tone = ratio === null ? '' : ratio >= 2 ? ' hot' : ratio >= 1 ? ' warm' : ' cold';
                return el('a', { class: 'gt-row', href: GT.videoUrl(item.videoId), target: '_blank', rel: 'noopener' },
                  el('span', { class: 'gt-row-title', title: item.title }, item.title || 'sem título'),
                  el('span', { class: 'gt-row-meta' },
                    Number.isFinite(item.views) ? `${GT.compact(item.views)} views` : 'views indisponíveis',
                    ' · ', GT.ageLabel(item.published)
                  ),
                  ratio !== null && el('b', { class: `gt-ratio${tone}` }, `${GT.decimal(ratio, 1)}×`)
                );
              })
            ),
            el('p', { class: 'gt-note gt-caveat' }, 'Fonte: feed RSS público do canal (15 uploads mais recentes, Shorts incluídos). Inscritos são arredondados pelo próprio YouTube.')
          )
        );
        ctx.setStatus(`${feed.videos.length} uploads recentes analisados`);
      }

      /* ------------------------------------------------------ despacho */

      function loadOther() {
        GT.clear(body).append(
          el('div', { class: 'gt-empty' },
            'Abra um vídeo para ver o dashboard de desempenho, testes de thumbnail e histórico de título — ou o canal de alguém para ver mediana, ritmo de upload e destaques.'),
          el('div', { class: 'gt-panelcard', id: 'gt-thumb' },
            el('p', { class: 'gt-note' }, 'Ou investigue a thumbnail de qualquer vídeo:'),
            caixaDeConsulta(''))
        );
        ctx.setStatus('Aguardando um vídeo ou canal');
      }

      const type = ctx.page.type;
      if (type === 'watch') loadVideo();
      else if (type === 'channel') loadChannel();
      else loadOther();

      return { el: root, destroy() { alive = false; } };
    }
  };
})();
