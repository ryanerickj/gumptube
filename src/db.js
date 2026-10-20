// Gumptube — camada de dados. O banco de verdade agora vive no SERVICE WORKER (origem da
// extensão): assim as abas do YouTube e a aba cheia da Gumptube enxergam o MESMO Arsenal,
// e exportar/importar entre computadores sai de um lugar só. Este arquivo é o cliente RPC
// ('gt:db') + a assinatura visual local (usada pelas views, que têm canvas e Image).
(() => {
  const GT = (window.GT = window.GT || {});

  const rpc = (op, args = [], timeoutMs = 30000) => GT.sw('gt:db', { op, args }, timeoutMs);

  /* ------------------------------------------------------------ itens */

  const db = {
    put: (item) => rpc('itemPut', [item]),
    get: (id) => rpc('itemGet', [id]),
    remove: (id) => rpc('itemRemove', [id]),
    list: () => rpc('itemList', [], 60000),
    update: (id, patch) => rpc('itemUpdate', [id, patch]),

    listBoards: () => rpc('boardList'),
    createBoard: (name) => rpc('boardCreate', [name]),
    removeBoard: (boardId) => rpc('boardRemove', [boardId]),

    saveVideoSnapshot: (videoId, metrics) => rpc('snapshotSave', [videoId, metrics]),
    videoSnapshots: (videoId) => rpc('snapshotList', [videoId]),

    exportAll: () => rpc('exportAll', [], 120000),
    importAll: (dump) => rpc('importAll', [dump], 120000),

    // prints da varredura (Screenshot → aba cheia): imagens pesadas viajam uma a uma
    captures: {
      clear: (videoId) => rpc('captureClear', [videoId], 60000),
      put: (row) => rpc('capturePut', [row], 60000),
      update: (key, patch) => rpc('captureUpdate', [key, patch], 60000),
      list: (videoId) => rpc('captureList', [videoId], 60000),
      get: (key) => rpc('captureGet', [key], 60000),
      index: () => rpc('captureIndex', [], 60000)
    }
  };

  /* --------------------------------------- histórico de thumbnails (RPC) */

  const thumbs = {
    list: (videoId) => rpc('thumbList', [videoId]),
    sample: (videoId, dataUrl, source = 'pagina do vídeo') => rpc('thumbSample', [videoId, dataUrl, source], 60000),

    // Indício de teste A/B: duas versões vistas em janelas que se sobrepõem no tempo.
    overlapping(list) {
      const pairs = [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (a.firstSeen <= b.lastSeen && b.firstSeen <= a.lastSeen) pairs.push([a, b]);
        }
      }
      return pairs;
    }
  };

  /* ------------------------------------------- migração dos bancos antigos */
  // Versões anteriores guardavam tudo no IndexedDB da ORIGEM youtube.com (e a 0.3.x em um
  // banco próprio). Uma vez por instalação, lemos esses bancos daqui (só o content script
  // na origem youtube.com os enxerga) e empurramos tudo para o banco central em lotes.

  const LEGACY_DB = 'frame-finder-arsenal';
  const LEGACY_STORE = 'favorites';

  function abrirBancoLocal(nome) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
      try {
        const request = indexedDB.open(nome);
        request.onupgradeneeded = () => { /* banco não existia: nasce vazio e é ignorado */ };
        request.onsuccess = () => finish(request.result);
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
        setTimeout(() => finish(null), 5000);
      } catch {
        finish(null);
      }
    });
  }

  function lerStore(dbLocal, nome) {
    return new Promise((resolve) => {
      if (!dbLocal || !dbLocal.objectStoreNames.contains(nome)) return resolve([]);
      try {
        const read = dbLocal.transaction(nome, 'readonly').objectStore(nome).getAll();
        read.onsuccess = () => resolve(read.result || []);
        read.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async function importarEmLotes(store, rows, tamanho) {
    for (let i = 0; i < rows.length; i += tamanho) {
      await db.importAll({ formato: 'gumptube-banco', [store]: rows.slice(i, i + tamanho) });
    }
  }

  db.migrateLegacy = async function migrateLegacy() {
    // os bancos antigos vivem na origem youtube.com — só o content script lá os enxerga.
    // Na aba da extensão não há o que migrar E não podemos marcar a flag, senão o acervo
    // antigo nunca migraria.
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return { migrated: 0, skipped: true };
    const done = await GT.store.get('gt:migrated-sw', false);
    if (done) return { migrated: 0, skipped: true };
    let migrated = 0;

    try {
      // 1) banco 'gumptube' da origem youtube.com (versões 0.4 anteriores a esta)
      const local = await abrirBancoLocal('gumptube');
      if (local) {
        for (const [store, lote] of [['items', 10], ['boards', 100], ['boardItems', 200], ['videoSnapshots', 200], ['thumbs', 25]]) {
          const rows = await lerStore(local, store);
          if (rows.length) { await importarEmLotes(store, rows, lote); migrated += rows.length; }
        }
        local.close();
      }

      // 2) Arsenal 0.3.x (banco próprio, formato antigo)
      const legacy = await abrirBancoLocal(LEGACY_DB);
      if (legacy) {
        const olds = await lerStore(legacy, LEGACY_STORE);
        legacy.close();
        const items = olds.filter((old) => old?.id && old?.dataUrl).map((old) => ({
          id: old.id,
          kind: 'frame',
          origin: 'meu-frame',
          createdAt: old.createdAt ?? Date.now(),
          videoId: old.videoId ?? '',
          videoTitle: old.videoTitle ?? '',
          videoUrl: old.videoUrl ?? '',
          channel: '',
          time: old.time ?? null,
          dataUrl: old.dataUrl,
          width: old.width ?? null,
          height: old.height ?? null,
          hash: old.hash ?? '',
          sig: null,
          score: old.score ?? null,
          tags: Array.isArray(old.tags) ? old.tags : [],
          note: '',
          views: null,
          publishedAt: null
        }));
        if (items.length) { await importarEmLotes('items', items, 10); migrated += items.length; }
      }

      await GT.store.set('gt:migrated-sw', true);
    } catch (error) {
      // sem a flag, a próxima abertura tenta de novo — melhor do que perder o acervo
      return { migrated, skipped: false, error: error.message || String(error) };
    }
    return { migrated, skipped: false };
  };

  /* ----------------------------------------------------- similaridade */
  // Assinatura visual: dHash 16x16 + histograma de cor (HSV) + densidade de bordas 4x4.
  // Fica no lado da página porque as views têm canvas/Image; o SW tem uma cópia própria.

  function hexFromBits(bits) {
    let out = '';
    for (let i = 0; i < bits.length; i += 4) {
      out += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
    }
    return out;
  }

  GT.signature = function signature(source) {
    const W = 17, H = 16;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const luma = [];
    for (let i = 0; i < data.length; i += 4) {
      luma.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    }
    let bits = '';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        bits += luma[y * W + x] > luma[y * W + x + 1] ? '1' : '0';
      }
    }

    // histograma de cor em 32x32
    const C = 32;
    const big = document.createElement('canvas');
    big.width = big.height = C;
    const bctx = big.getContext('2d', { willReadFrequently: true });
    bctx.drawImage(source, 0, 0, C, C);
    const pixels = bctx.getImageData(0, 0, C, C).data;
    const hist = new Array(16).fill(0);   // 12 matizes + 4 faixas de luminância
    const edges = new Array(16).fill(0);  // grade 4x4 de gradiente
    const lumaBig = [];
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      let hue = 0;
      if (delta > 0.0001) {
        if (max === r) hue = ((g - b) / delta + 6) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue *= 60;
      }
      const sat = max <= 0 ? 0 : delta / max;
      if (sat > 0.18) hist[Math.min(11, Math.floor(hue / 30))] += sat;
      hist[12 + Math.min(3, Math.floor(max * 4))] += 0.6;
      lumaBig.push(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
    }
    const histSum = hist.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < hist.length; i++) hist[i] = Number((hist[i] / histSum).toFixed(4));

    const counts = new Array(16).fill(0);
    for (let y = 1; y < C - 1; y++) {
      for (let x = 1; x < C - 1; x++) {
        const gx = lumaBig[y * C + x + 1] - lumaBig[y * C + x - 1];
        const gy = lumaBig[(y + 1) * C + x] - lumaBig[(y - 1) * C + x];
        const cell = Math.floor(y / (C / 4)) * 4 + Math.floor(x / (C / 4));
        edges[cell] += Math.hypot(gx, gy);
        counts[cell]++;
      }
    }
    for (let i = 0; i < edges.length; i++) {
      edges[i] = Number(Math.min(1, edges[i] / Math.max(1, counts[i]) / 90).toFixed(4));
    }

    return { d: hexFromBits(bits), h: hist, e: edges };
  };

  GT.compareSignatures = function compareSignatures(a, b) {
    if (!a || !b || !a.d || !b.d) return null;
    const length = Math.min(a.d.length, b.d.length);
    let differing = 0;
    for (let i = 0; i < length; i++) {
      let xor = parseInt(a.d[i], 16) ^ parseInt(b.d[i], 16);
      while (xor) { differing += xor & 1; xor >>= 1; }
    }
    const structure = 1 - differing / (length * 4);
    const color = (a.h && b.h) ? a.h.reduce((acc, value, i) => acc + Math.min(value, b.h[i] ?? 0), 0) : 0;
    const layout = (a.e && b.e)
      ? 1 - a.e.reduce((acc, value, i) => acc + Math.abs(value - (b.e[i] ?? 0)), 0) / a.e.length
      : 0;
    return Math.round(GT.clamp01(structure * 0.5 + color * 0.3 + layout * 0.2) * 100);
  };

  // Compatibilidade com itens do 0.3.x, que só têm aHash de 64 bits.
  GT.legacySimilarity = function legacySimilarity(a, b) {
    if (!a || !b) return null;
    const length = Math.max(a.length, b.length);
    if (!length) return null;
    let differing = Math.abs(a.length - b.length);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) differing++;
    return Math.round((1 - differing / length) * 100);
  };

  GT.similarity = function similarity(a, b) {
    const bySignature = GT.compareSignatures(a.sig, b.sig);
    if (bySignature !== null) return { value: bySignature, precise: true };
    const byHash = GT.legacySimilarity(a.hash, b.hash);
    return byHash === null ? null : { value: byHash, precise: false };
  };

  GT.thumbs = thumbs;
  GT.db = db;
})();
