// Gumptube — busca de thumbnails no YouTube, com leitura de estilo feita aqui na máquina.
(() => {
  const GT = (window.GT = window.GT || {});
  const { el } = GT;

  // Três ordenações da mesma busca rendem conjuntos diferentes — é assim que se junta volume
  // sem um banco global: relevância, mais vistos e mais recentes.
  const SORTS = [
    { id: '', label: 'relevância' },
    { id: 'CAM=', label: 'mais vistos' },
    { id: 'CAI=', label: 'recentes' }
  ];

  const ATRIBUTOS = [
    { id: 'rosto', label: 'Com rosto', teste: (r) => r.face?.present },
    { id: 'close', label: 'Close', teste: (r) => (r.face?.areaRatio || 0) >= 0.16 },
    { id: 'claro', label: 'Claro', teste: (r) => r.style?.claro },
    { id: 'escuro', label: 'Escuro', teste: (r) => r.style?.escuro },
    { id: 'contraste', label: 'Alto contraste', teste: (r) => r.style?.altoContraste },
    { id: 'texto', label: 'Muito texto', teste: (r) => r.style?.muitoTexto }
  ];

  GT.thumbSearch = {
    create(ctx, { onSaved } = {}) {
      let alive = true;
      let resultados = [];
      let cor = 'todas';
      let atributos = new Set();
      let ordem = 'busca';
      let buscando = false;

      const input = el('input', {
        class: 'gt-input',
        type: 'search',
        placeholder: 'Nicho ou palavra-chave (ex.: desafio, finanças, receita)',
        onkeydown: (event) => { if (event.key === 'Enter') buscar(); }
      });
      const botao = el('button', { class: 'gt-primary', onclick: () => buscar() }, 'Buscar');
      const corChips = el('div', { class: 'gt-chips' });
      const atrChips = el('div', { class: 'gt-chips' });
      const ordemChips = el('div', { class: 'gt-chips' });
      const grid = el('div', { class: 'gt-grid gt-cols-2' });
      const resumo = el('p', { class: 'gt-note' });

      const root = el('div', { class: 'gt-search' },
        el('div', { class: 'gt-toolbar' }, input, botao),
        el('div', { class: 'gt-toolbar gt-toolbar-thin' }, el('span', { class: 'gt-note' }, 'Cor'), corChips),
        el('div', { class: 'gt-toolbar gt-toolbar-thin' }, atrChips),
        el('div', { class: 'gt-toolbar gt-toolbar-thin' }, el('span', { class: 'gt-note' }, 'Ordem'), ordemChips),
        el('div', { class: 'gt-toolbar gt-toolbar-thin' }, resumo),
        grid
      );

      /* -------------------------------------------------------- busca */

      async function buscar() {
        const termo = input.value.trim();
        if (!termo || buscando) return;
        buscando = true;
        botao.disabled = true;
        resultados = [];
        GT.clear(grid).append(el('div', { class: 'gt-loading' }, 'Buscando no YouTube'));

        const vistos = new Set();
        for (const sort of SORTS) {
          if (!alive) return;
          try {
            ctx.setStatus(`Buscando "${termo}" por ${sort.label}…`);
            const data = await GT.sw('gt:search', { query: termo, sort: sort.id });
            for (const item of data.results) {
              if (vistos.has(item.videoId)) continue;
              vistos.add(item.videoId);
              resultados.push({ ...item, views: GT.parseCount(item.viewsText), style: null, face: null });
            }
            render();
          } catch (error) {
            ctx.setStatus(`Busca (${sort.label}) falhou: ${error.message || error}`);
          }
        }

        buscando = false;
        botao.disabled = false;
        if (!alive) return;
        ctx.setStatus(`${resultados.length} thumbnails encontradas para "${termo}"`);
        render();
        analisar();
      }

      // Carrega a imagem de forma que dê para ler os pixels: primeiro direto do CDN,
      // depois pelo service worker, se o CORS barrar.
      async function imagemDe(item) {
        try {
          return await new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('cors'));
            image.src = item.thumbUrl;
          });
        } catch {
          const { dataUrl } = await GT.sw('gt:image', { url: item.thumbUrl });
          return GT.loadImage(dataUrl);
        }
      }

      async function analisar() {
        // 1) estilo (rápido, todas)
        for (const item of resultados) {
          if (!alive) return;
          if (item.style) continue;
          try {
            const image = await imagemDe(item);
            item.image = image;
            item.style = GT.analyzeThumb(image);
          } catch {
            item.style = null;
          }
        }
        if (!alive) return;
        render();

        // 2) rosto (modelo local, em segundo plano)
        try {
          await GT.analysis.initAnalyzer();
        } catch {
          ctx.setStatus('Modelo facial indisponível — os filtros de rosto ficam de fora.');
          return;
        }
        let feitos = 0;
        for (const item of resultados) {
          if (!alive) return;
          if (item.face || !item.image) continue;
          try {
            item.face = await GT.analysis.analyzeFaceOf(item.image);
          } catch {
            item.face = GT.analysis.EMPTY_FACE;
          }
          feitos++;
          if (feitos % 6 === 0) { ctx.setStatus(`Lendo rostos ${feitos}/${resultados.length}`); render(); }
        }
        if (!alive) return;
        ctx.setStatus(`${resultados.length} thumbnails analisadas`);
        render();
      }

      /* ------------------------------------------------------- ações */

      async function salvar(item) {
        try {
          ctx.setStatus('Salvando no Arsenal…');
          const thumb = await GT.sw('gt:thumb', { videoId: item.videoId });
          const image = await GT.loadImage(thumb.dataUrl);
          const tags = [input.value.trim(), item.style?.corLabel, item.face?.present ? 'rosto' : null]
            .filter(Boolean).map((tag) => tag.toLowerCase());
          await GT.db.put({
            id: `thumb-${item.videoId}`,
            kind: 'thumb',
            origin: 'externo',
            createdAt: Date.now(),
            videoId: item.videoId,
            videoTitle: item.title,
            videoUrl: GT.videoUrl(item.videoId),
            channel: item.channel || '',
            channelId: null,
            time: null,
            dataUrl: thumb.dataUrl,
            width: image.naturalWidth,
            height: image.naturalHeight,
            hash: '',
            sig: GT.signature(image),
            score: null,
            tags,
            note: '',
            views: item.views ?? null,
            viewsSource: item.viewsText ? 'busca do YouTube' : null,
            viewsPrecision: item.viewsText ? 'aproximado' : null,
            publishedAt: null,
            style: item.style || null,
            quality: thumb.quality
          });
          ctx.setStatus(`"${item.title.slice(0, 40)}" salva no Arsenal`);
          onSaved?.();
        } catch (error) {
          ctx.setStatus(`Não foi possível salvar: ${error.message || error}`);
        }
      }

      async function copiar(item) {
        try {
          ctx.setStatus('Copiando thumbnail…');
          const size = await GT.copyImage(GT.sw('gt:thumb', { videoId: item.videoId }).then((t) => t.dataUrl));
          ctx.setStatus(size ? `Copiado ${size.width}×${size.height}` : 'Thumbnail copiada');
        } catch (error) {
          ctx.setStatus(`Não foi possível copiar: ${error.message || error}`);
        }
      }

      /* ------------------------------------------------------ render */

      function visiveis() {
        let lista = resultados;
        if (cor !== 'todas') lista = lista.filter((item) => item.style?.cor === cor);
        for (const id of atributos) {
          const atributo = ATRIBUTOS.find((a) => a.id === id);
          if (atributo) lista = lista.filter(atributo.teste);
        }
        if (ordem === 'views') lista = [...lista].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
        return lista;
      }

      function renderChips() {
        const contagem = new Map();
        for (const item of resultados) {
          if (!item.style) continue;
          contagem.set(item.style.cor, (contagem.get(item.style.cor) || 0) + 1);
        }
        GT.clear(corChips);
        corChips.append(el('button', {
          class: `gt-chip${cor === 'todas' ? ' active' : ''}`,
          onclick: () => { cor = 'todas'; render(); }
        }, 'Todas'));
        for (const [id, total] of [...contagem.entries()].sort((a, b) => b[1] - a[1])) {
          const familia = GT.STYLE_FAMILIES.find((f) => f.id === id);
          corChips.append(el('button', {
            class: `gt-chip${cor === id ? ' active' : ''}`,
            onclick: () => { cor = id; render(); }
          }, `${familia?.label || id} ${total}`));
        }

        GT.clear(atrChips);
        for (const atributo of ATRIBUTOS) {
          atrChips.append(el('button', {
            class: `gt-chip${atributos.has(atributo.id) ? ' active' : ''}`,
            onclick: () => {
              if (atributos.has(atributo.id)) atributos.delete(atributo.id); else atributos.add(atributo.id);
              render();
            }
          }, atributo.label));
        }

        GT.clear(ordemChips);
        for (const item of [{ id: 'busca', label: 'Da busca' }, { id: 'views', label: 'Mais vistas' }]) {
          ordemChips.append(el('button', {
            class: `gt-chip${ordem === item.id ? ' active' : ''}`,
            onclick: () => { ordem = item.id; render(); }
          }, item.label));
        }
      }

      function card(item) {
        const selos = [
          item.style?.corLabel,
          item.face?.present ? ((item.face.areaRatio || 0) >= 0.16 ? 'close' : 'rosto') : null,
          item.style?.muitoTexto ? 'texto' : null
        ].filter(Boolean).join(' · ');

        return el('article', { class: 'gt-item' },
          el('img', {
            src: item.thumbUrl,
            alt: item.title,
            loading: 'lazy',
            onclick: () => ctx.preview(item.thumbUrl, item.title)
          }),
          selos && el('b', { class: 'gt-sim' }, selos),
          el('div', { class: 'gt-item-info' },
            el('span', { class: 'gt-item-title', title: item.title }, item.title),
            el('span', { class: 'gt-item-meta' },
              [item.channel, item.viewsText, item.publishedText].filter(Boolean).join(' · ')),
            el('div', { class: 'gt-item-actions' },
              el('button', { class: 'primary', onclick: () => salvar(item) }, '★ Salvar'),
              el('button', { onclick: () => copiar(item) }, '⧉ Copiar'),
              el('button', { onclick: () => window.open(GT.videoUrl(item.videoId), '_blank', 'noopener') }, 'Abrir')
            )
          )
        );
      }

      function render() {
        if (!alive) return;
        renderChips();
        const lista = visiveis();
        const analisadas = resultados.filter((item) => item.style).length;
        resumo.textContent = resultados.length
          ? `${lista.length} de ${resultados.length} thumbnails · ${analisadas} com estilo lido`
            + (atributos.size || cor !== 'todas' ? ' · filtros ativos' : '')
          : '';

        GT.clear(grid);
        if (!resultados.length) {
          grid.append(el('div', { class: 'gt-empty' },
            'Busque um nicho para ver as thumbnails reais do YouTube.',
            el('br'),
            el('small', {}, 'Cada busca junta três ordenações (relevância, mais vistas e recentes) e lê cor, luz, contraste, rosto e densidade de texto de cada imagem — aqui, na sua máquina.')
          ));
          return;
        }
        if (!lista.length) {
          grid.append(el('div', { class: 'gt-empty' }, 'Nenhuma thumbnail com esses filtros.'));
          return;
        }
        for (const item of lista) grid.append(card(item));
      }

      render();
      return { el: root, destroy() { alive = false; } };
    }
  };
})();
