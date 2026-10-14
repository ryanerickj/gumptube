// Gumptube — solução Arsenal: biblioteca visual (frames próprios + referências externas).
(() => {
  const GT = (window.GT = window.GT || {});
  GT.views = GT.views || {};
  const { el } = GT;

  const FILTERS = [
    { id: 'all', label: 'Tudo' },
    { id: 'meu-frame', label: 'Meus frames' },
    { id: 'externo', label: 'Referências' }
  ];

  GT.views.arsenal = {
    create(ctx) {
      let alive = true;
      let items = [];
      let filter = 'all';
      let query = '';
      let referenceId = null;

      const grid = el('div', { class: 'gt-grid' }, el('div', { class: 'gt-loading' }, 'Abrindo o Arsenal…'));

      const search = el('input', {
        class: 'gt-input',
        type: 'search',
        placeholder: 'Buscar por título, canal ou tag',
        oninput: (event) => { query = event.target.value.trim().toLowerCase(); render(); }
      });

      const chips = el('div', { class: 'gt-chips' },
        FILTERS.map((item) =>
          el('button', {
            class: `gt-chip${item.id === filter ? ' active' : ''}`,
            'data-id': item.id,
            onclick: () => {
              filter = item.id;
              for (const chip of chips.querySelectorAll('.gt-chip')) chip.classList.toggle('active', chip.dataset.id === filter);
              render();
            }
          }, item.label)
        )
      );

      // A thumbnail do vídeo atual aparece em preview: você vê antes de decidir salvar.
      const currentBox = el('div', { class: 'gt-current' });
      let currentThumb = null;

      const toolbar = el('div', { class: 'gt-toolbar' }, search, chips);

      // Mesmo Arsenal em dois computadores: exporta um .json com o banco inteiro e importa
      // no outro — a importação mescla sem duplicar (importar duas vezes não estraga nada).
      const fileInput = el('input', {
        type: 'file',
        accept: 'application/json,.json',
        style: { display: 'none' },
        onchange: (event) => { importarBanco(event.target.files?.[0]); event.target.value = ''; }
      });
      const syncBar = el('div', { class: 'gt-toolbar gt-sync' },
        el('button', { class: 'gt-chip', title: 'Baixa um .json com todo o banco: thumbs, frames, tags e históricos', onclick: () => exportarBanco() }, '⇩ Exportar banco'),
        el('button', { class: 'gt-chip', title: 'Mescla um banco exportado em outro computador — nada é apagado', onclick: () => fileInput.click() }, '⇧ Importar banco'),
        fileInput,
        el('span', { class: 'gt-note' }, 'leve o Arsenal para outro computador')
      );

      const biblioteca = el('div', {}, currentBox, toolbar, syncBar, grid);
      const buscaBox = el('div', {});
      let buscaView = null;
      let modo = 'biblioteca';

      const modoBar = el('nav', { class: 'gt-tabs' });
      function renderModo() {
        GT.clear(modoBar);
        for (const item of [{ id: 'biblioteca', label: 'Biblioteca' }, { id: 'busca', label: 'Buscar no YouTube' }]) {
          modoBar.append(el('button', {
            class: item.id === modo ? 'active' : '',
            onclick: () => {
              modo = item.id;
              biblioteca.style.display = modo === 'biblioteca' ? '' : 'none';
              buscaBox.style.display = modo === 'busca' ? '' : 'none';
              if (modo === 'busca' && !buscaView) {
                buscaView = GT.thumbSearch.create(ctx, { onSaved: () => { GT.db.list().then((rows) => { items = rows; render(); }); } });
                buscaBox.append(buscaView.el);
              }
              renderModo();
            }
          }, item.label));
        }
      }
      buscaBox.style.display = 'none';
      renderModo();

      const root = el('div', { class: 'gt-arsenal' }, modoBar, biblioteca, buscaBox);

      async function loadCurrentThumb() {
        if (ctx.page.type !== 'watch') { currentBox.style.display = 'none'; return; }
        GT.clear(currentBox).append(el('div', { class: 'gt-loading' }, 'Carregando a thumbnail deste vídeo'));
        try {
          const videoId = ctx.videoId;
          const [thumb, video] = await Promise.all([
            GT.sw('gt:thumb', { videoId }),
            GT.data.getVideo(videoId).catch(() => null)
          ]);
          if (!alive) return;
          currentThumb = { thumb, video, videoId };
          renderCurrent();
        } catch (error) {
          if (alive) GT.clear(currentBox).append(el('p', { class: 'gt-note' }, `Thumbnail indisponível: ${error.message || error}`));
        }
      }

      function renderCurrent() {
        if (!currentThumb) return;
        const { thumb, video, videoId } = currentThumb;
        const jaSalvo = items.some((item) => item.id === `thumb-${videoId}`);
        GT.clear(currentBox).append(
          el('img', {
            src: thumb.dataUrl,
            alt: 'Thumbnail deste vídeo',
            title: 'Clique para ver em tamanho cheio',
            onclick: () => ctx.preview(thumb.dataUrl, video?.title || GT.pageTitle())
          }),
          el('div', { class: 'gt-current-info' },
            el('span', { class: 'gt-item-title', title: video?.title || '' }, video?.title || GT.pageTitle()),
            el('span', { class: 'gt-item-meta' }, `${video?.author || GT.pageChannel() || '—'} · ${thumb.quality}`),
            el('div', { class: 'gt-item-actions' },
              el('button', { class: 'primary', onclick: () => copyCurrentThumb() }, '⧉ Copiar'),
              el('button', { onclick: () => saveCurrentThumb() }, jaSalvo ? '★ Salvar de novo' : '★ Salvar')
            )
          )
        );
      }

      /* --------------------------------------------------------- dados */

      async function load() {
        try {
          await GT.db.migrateLegacy();
          items = await GT.db.list();
          if (!alive) return;
          render();
          loadCurrentThumb();
          backfillSignatures();
        } catch (error) {
          if (!alive) return;
          GT.clear(grid).append(el('div', { class: 'gt-empty' }, 'Não foi possível abrir o Arsenal neste navegador.', el('br'), el('small', {}, error.message || '')));
        }
      }

      // Itens salvos na 0.3.x não têm assinatura visual: calculamos sob demanda.
      async function backfillSignatures() {
        const pending = items.filter((item) => !item.sig && item.dataUrl).slice(0, 24);
        for (const item of pending) {
          if (!alive) return;
          try {
            const image = await GT.loadImage(item.dataUrl);
            const sig = GT.signature(image);
            await GT.db.update(item.id, { sig });
            item.sig = sig;
          } catch {
            /* item segue comparável pelo hash antigo */
          }
        }
        if (alive && pending.length) render();
      }

      async function saveCurrentThumb() {
        const videoId = ctx.videoId;
        if (!videoId) return ctx.setStatus('Abra um vídeo para salvar a thumbnail.');
        ctx.setStatus('Salvando a thumbnail…');
        try {
          // reaproveita o que o preview já baixou
          const thumb = currentThumb?.thumb || await GT.sw('gt:thumb', { videoId });
          const video = currentThumb?.video ?? await GT.data.getVideo(videoId).catch(() => null);
          const image = await GT.loadImage(thumb.dataUrl);
          const id = `thumb-${videoId}`;
          const item = {
            id,
            kind: 'thumb',
            origin: 'externo',
            createdAt: Date.now(),
            videoId,
            videoTitle: video?.title || GT.pageTitle(),
            videoUrl: GT.videoUrl(videoId),
            channel: video?.author || GT.pageChannel() || '',
            channelId: video?.channelId || null,
            time: null,
            dataUrl: thumb.dataUrl,
            width: image.naturalWidth,
            height: image.naturalHeight,
            hash: '',
            sig: GT.signature(image),
            score: null,
            tags: [],
            note: '',
            views: Number.isFinite(video?.views) ? video.views : null,
            publishedAt: video?.publishDate || null,
            quality: thumb.quality
          };
          await GT.db.put(item);
          items = [item, ...items.filter((existing) => existing.id !== id)];
          if (!alive) return;
          render();
          renderCurrent();
          ctx.setStatus(`Thumbnail salva (${thumb.quality}) no Arsenal`);
        } catch (error) {
          ctx.setStatus(`Não foi possível salvar: ${error.message || error}`);
        }
      }

      async function copyCurrentThumb() {
        const videoId = ctx.videoId;
        if (!videoId) return ctx.setStatus('Abra um vídeo para copiar a thumbnail.');
        ctx.setStatus('Copiando a thumbnail…');
        try {
          const pending = currentThumb?.thumb
            ? Promise.resolve(currentThumb.thumb.dataUrl)
            : GT.sw('gt:thumb', { videoId }).then((thumb) => thumb.dataUrl);
          const size = await GT.copyImage(pending);
          ctx.setStatus(size ? `Copiado ${size.width}×${size.height} — cole no seu editor` : 'Thumbnail copiada');
        } catch (error) {
          ctx.setStatus(`Não foi possível copiar: ${error.message || error}`);
        }
      }

      async function copyItem(item) {
        try {
          ctx.setStatus('Copiando imagem…');
          const size = await GT.copyImage(item.dataUrl);
          ctx.setStatus(size ? `Copiado ${size.width}×${size.height} — cole no seu editor` : 'Imagem copiada');
        } catch (error) {
          ctx.setStatus(`Não foi possível copiar: ${error.message || error}`);
        }
      }

      async function exportarBanco() {
        ctx.setStatus('Preparando o arquivo do banco…');
        try {
          const dump = await GT.db.exportAll();
          const nome = `gumptube-banco-${new Date().toISOString().slice(0, 10)}.json`;
          const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = el('a', { href: url, download: nome });
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          ctx.setStatus(`Banco exportado: ${dump.items?.length || 0} itens do Arsenal + históricos. Importe no outro computador.`);
        } catch (error) {
          ctx.setStatus(`Exportação falhou: ${error.message || error}`);
        }
      }

      async function importarBanco(file) {
        if (!file) return;
        ctx.setStatus('Lendo o arquivo…');
        try {
          const dump = JSON.parse(await file.text());
          if (dump?.formato !== 'gumptube-banco') throw new Error('este arquivo não é um banco exportado da Gumptube.');
          const resumo = await GT.db.importAll(dump);
          items = await GT.db.list();
          if (!alive) return;
          render();
          ctx.setStatus(`Importado: ${resumo.novos} novos · ${resumo.mesclados} mesclados · ${resumo.ignorados} já existiam.`);
        } catch (error) {
          ctx.setStatus(`Importação falhou: ${error.message || error}`);
        }
      }

      async function remove(item) {
        try {
          await GT.db.remove(item.id);
          items = items.filter((existing) => existing.id !== item.id);
          if (referenceId === item.id) referenceId = null;
          render();
          ctx.setStatus('Item removido do Arsenal');
        } catch {
          ctx.setStatus('Não foi possível remover o item.');
        }
      }

      async function commitTags(item, value) {
        const tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
        try {
          await GT.db.update(item.id, { tags });
          item.tags = tags;
          ctx.setStatus('Tags salvas');
        } catch {
          ctx.setStatus('Não foi possível salvar as tags.');
        }
      }

      /* ------------------------------------------------------- render */

      function visibleItems() {
        let list = items;
        if (filter !== 'all') list = list.filter((item) => item.origin === filter);
        if (query) {
          list = list.filter((item) =>
            `${item.videoTitle} ${item.channel} ${(item.tags || []).join(' ')} ${item.note || ''}`.toLowerCase().includes(query)
          );
        }
        const reference = items.find((item) => item.id === referenceId);
        if (!reference) return list.map((item) => ({ item, similarity: null }));
        return list
          .map((item) => ({ item, similarity: item.id === reference.id ? null : GT.similarity(reference, item) }))
          .sort((a, b) => (b.similarity?.value ?? -1) - (a.similarity?.value ?? -1));
      }

      function itemCard({ item, similarity }) {
        const isReference = item.id === referenceId;
        const meta = [
          item.origin === 'meu-frame' ? 'meu frame' : 'referência',
          item.time !== null && item.time !== undefined ? GT.timeLabel(item.time) : null,
          item.width ? `${item.width}×${item.height}` : null,
          Number.isFinite(item.views) ? `${GT.compact(item.views)} views` : null,
          Number.isFinite(item.score) ? `score ${item.score}` : null
        ].filter(Boolean).join(' · ');

        const tagsInput = el('input', {
          class: 'gt-tags',
          placeholder: 'tags separadas por vírgula',
          value: (item.tags || []).join(', '),
          onblur: (event) => commitTags(item, event.target.value),
          onkeydown: (event) => { if (event.key === 'Enter') event.target.blur(); }
        });

        return el('article', { class: `gt-item${isReference ? ' reference' : ''}` },
          el('img', {
            src: item.preview || item.dataUrl,
            alt: item.videoTitle || 'Item do Arsenal',
            loading: 'lazy',
            onclick: () => ctx.preview(item.dataUrl, item.videoTitle || '')
          }),
          similarity && el('b', { class: 'gt-sim' }, `${similarity.value}% parecida${similarity.precise ? '' : ' (hash antigo)'}`),
          isReference && el('b', { class: 'gt-sim ref' }, 'Referência visual'),
          el('div', { class: 'gt-item-info' },
            el('span', { class: 'gt-item-title', title: item.videoTitle }, item.videoTitle || 'Sem título'),
            el('span', { class: 'gt-item-meta' }, meta),
            item.channel && el('span', { class: 'gt-item-meta' }, item.channel),
            tagsInput,
            el('div', { class: 'gt-item-actions' },
              el('button', { class: 'primary', title: 'Copiar imagem em alta', onclick: () => copyItem(item) }, '⧉ Copiar'),
              el('button', { onclick: () => { referenceId = isReference ? null : item.id; render(); } }, isReference ? 'Limpar' : 'Semelhantes'),
              item.videoUrl && el('button', {
                onclick: () => {
                  const separator = item.videoUrl.includes('?') ? '&' : '?';
                  const stamp = Number.isFinite(item.time) ? `${separator}t=${Math.max(0, Math.floor(item.time))}s` : '';
                  window.open(`${item.videoUrl}${stamp}`, '_blank', 'noopener');
                }
              }, 'Abrir vídeo'),
              el('button', { class: 'danger', onclick: () => remove(item) }, 'Remover')
            )
          )
        );
      }

      function render() {
        if (!alive) return;
        const list = visibleItems();
        GT.clear(grid);
        if (!items.length) {
          grid.append(el('div', { class: 'gt-empty' },
            'Arsenal vazio.',
            el('br'),
            el('small', {}, 'Passe o mouse sobre qualquer thumbnail do YouTube e clique em ★ para guardá-la aqui em alta — ou marque um frame na solução Screenshot.')
          ));
          return;
        }
        if (!list.length) {
          grid.append(el('div', { class: 'gt-empty' }, 'Nenhum item bate com esse filtro.'));
          return;
        }
        const reference = items.find((item) => item.id === referenceId);
        if (reference) {
          grid.append(el('p', { class: 'gt-note gt-span' }, 'Ordenado por semelhança visual (estrutura 50% · cor 30% · composição 20%).'));
        }
        for (const entry of list) grid.append(itemCard(entry));
      }

      load();
      return { el: root, destroy() { alive = false; buscaView?.destroy?.(); } };
    }
  };
})();
