// Gumptube — banco central no service worker (IndexedDB da ORIGEM DA EXTENSÃO).
// Antes o banco vivia na origem youtube.com: cada contexto via um banco diferente e a aba
// cheia da extensão não enxergava o Arsenal. Agora todos os contextos (YouTube, aba cheia)
// falam com ESTE banco por RPC ('gt:db'), e exportar/importar vive aqui também.

const DB_NAME = 'gumptube';
const DB_VERSION = 3;   // v2: store 'captures' — prints da varredura. v3: 'captureMeta' (metadados + miniatura, sem a imagem cheia) — a galeria lista sem carregar os prints

const STORES = {
  items: { keyPath: 'id', indexes: [['createdAt', 'createdAt'], ['videoId', 'videoId'], ['origin', 'origin']] },
  boards: { keyPath: 'id', indexes: [['createdAt', 'createdAt']] },
  boardItems: { keyPath: 'key', indexes: [['boardId', 'boardId'], ['itemId', 'itemId']] },
  videoSnapshots: { keyPath: 'key', indexes: [['videoId', 'videoId'], ['takenAt', 'takenAt']] },
  channels: { keyPath: 'channelId', indexes: [] },
  channelSnapshots: { keyPath: 'key', indexes: [['channelId', 'channelId']] },
  thumbs: { keyPath: 'key', indexes: [['videoId', 'videoId'], ['firstSeen', 'firstSeen']] },
  // Última varredura de cada vídeo (imagens em resolução cheia). É cache de trabalho —
  // fica FORA do exportar/importar de propósito, senão o arquivo de banco incharia gigas.
  captures: { keyPath: 'key', indexes: [['videoId', 'videoId'], ['takenAt', 'takenAt']] },
  captureMeta: { keyPath: 'key', indexes: [['videoId', 'videoId'], ['takenAt', 'takenAt']] }
};

let dbPromise = null;

function openDb() {
  dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (const [name, spec] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: spec.keyPath });
        for (const [indexName, path] of spec.indexes) store.createIndex(indexName, path);
      }
      // v2 -> v3: copia os metadados das capturas já guardadas (sem as imagens) para a captureMeta
      if (event.oldVersion > 0 && event.oldVersion < 3 && db.objectStoreNames.contains('captures')) {
        const origem = request.transaction.objectStore('captures');
        const destino = request.transaction.objectStore('captureMeta');
        origem.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const { dataUrl, ...meta } = cursor.value;
          destino.put(meta);
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error ?? new Error('Não foi possível abrir o banco da Gumptube.')); };
  });
  return dbPromise;
}

function tx(storeName, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = work(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha na transação do banco.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Transação do banco abortada.'));
  }));
}

/* ----------------------------------------------- assinatura visual (lado SW) */
// Mesma matemática do GT.signature do lado da página, mas com OffscreenCanvas,
// porque o service worker não tem <canvas> nem Image().

function hexFromBits(bits) {
  let out = '';
  for (let i = 0; i < bits.length; i += 4) {
    out += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
  }
  return out;
}

async function bitmapFromDataUrl(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

function assinatura(bitmap) {
  const W = 17, H = 16;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, W, H);
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

  const C = 32;
  const big = new OffscreenCanvas(C, C);
  const bctx = big.getContext('2d', { willReadFrequently: true });
  bctx.drawImage(bitmap, 0, 0, C, C);
  const pixels = bctx.getImageData(0, 0, C, C).data;
  const hist = new Array(16).fill(0);
  const edges = new Array(16).fill(0);
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
}

function compararAssinaturas(a, b) {
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
  const clamped = Math.min(1, Math.max(0, structure * 0.5 + color * 0.3 + layout * 0.2));
  return Math.round(clamped * 100);
}

async function blobToDataUrl(blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buffer.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

/* ------------------------------------------------------------- operações */

const SAME_THUMB = 96;   // acima disso é a mesma arte (tolera recompressão do CDN)

async function thumbList(videoId) {
  const all = (await tx('thumbs', 'readonly', (store) => store.getAll())) || [];
  return all.filter((row) => row.videoId === videoId).sort((a, b) => a.firstSeen - b.firstSeen);
}

async function thumbSample(videoId, dataUrl, source = 'pagina do vídeo') {
  if (!videoId || !dataUrl) return null;
  const bitmap = await bitmapFromDataUrl(dataUrl);
  const sig = assinatura(bitmap);
  const existing = await thumbList(videoId);
  const now = Date.now();

  let match = null;
  let bestScore = 0;
  for (const row of existing) {
    const score = compararAssinaturas(sig, row.sig) ?? 0;
    if (score > bestScore) { bestScore = score; match = row; }
  }

  if (match && bestScore >= SAME_THUMB) {
    await tx('thumbs', 'readwrite', (store) => store.put({ ...match, lastSeen: now, seenCount: (match.seenCount || 1) + 1 }));
    return { changed: false, versions: existing.length, current: match, similarity: bestScore };
  }

  // miniatura leve: o histórico não precisa guardar a arte em resolução cheia
  const scale = Math.min(1, 320 / (bitmap.width || 320));
  const canvas = new OffscreenCanvas(Math.round((bitmap.width || 320) * scale), Math.round((bitmap.height || 180) * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const mini = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 }));

  const row = {
    key: `${videoId}|${sig.d.slice(0, 24)}`,
    videoId,
    sig,
    dataUrl: mini,
    firstSeen: now,
    lastSeen: now,
    seenCount: 1,
    source
  };
  await tx('thumbs', 'readwrite', (store) => store.put(row));
  return {
    changed: existing.length > 0,
    versions: existing.length + 1,
    current: row,
    previous: existing[existing.length - 1] || null,
    similarity: existing.length ? bestScore : null
  };
}

/* --------------------------------------------- exportar / importar / mesclar */

const EXPORT_STORES = ['items', 'boards', 'boardItems', 'videoSnapshots', 'thumbs'];

async function exportAll() {
  const dump = { formato: 'gumptube-banco', versao: 1, exportadoEm: new Date().toISOString() };
  for (const store of EXPORT_STORES) {
    dump[store] = (await tx(store, 'readonly', (s) => s.getAll())) || [];
  }
  return dump;
}

// Mescla sem destruir: linhas novas entram, existentes são preservadas (thumbs ganham a
// união das janelas de observação). Importar duas vezes o mesmo arquivo não duplica nada.
async function importAll(dump) {
  if (!dump || typeof dump !== 'object') throw new Error('Arquivo de banco inválido.');
  const resumo = { novos: 0, mesclados: 0, ignorados: 0 };

  const porChave = {
    items: 'id', boards: 'id', boardItems: 'key', videoSnapshots: 'key', thumbs: 'key'
  };

  for (const store of EXPORT_STORES) {
    const rows = Array.isArray(dump[store]) ? dump[store] : [];
    const keyPath = porChave[store];
    for (const row of rows) {
      if (!row || !row[keyPath]) continue;
      const existente = await tx(store, 'readonly', (s) => s.get(row[keyPath]));
      if (!existente) {
        await tx(store, 'readwrite', (s) => s.put(row));
        resumo.novos++;
      } else if (store === 'thumbs') {
        await tx(store, 'readwrite', (s) => s.put({
          ...existente,
          firstSeen: Math.min(existente.firstSeen || Infinity, row.firstSeen || Infinity),
          lastSeen: Math.max(existente.lastSeen || 0, row.lastSeen || 0),
          seenCount: Math.max(existente.seenCount || 1, row.seenCount || 1)
        }));
        resumo.mesclados++;
      } else {
        resumo.ignorados++;
      }
    }
  }
  return resumo;
}

export const dbOps = {
  itemPut: (item) => tx('items', 'readwrite', (store) => store.put(item)).then(() => item),
  itemGet: (id) => tx('items', 'readonly', (store) => store.get(id)),
  itemRemove: (id) => tx('items', 'readwrite', (store) => store.delete(id)),
  itemList: async () => {
    const items = (await tx('items', 'readonly', (store) => store.getAll())) || [];
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },
  itemUpdate: async (id, patch) => {
    const item = await tx('items', 'readonly', (store) => store.get(id));
    if (!item) return null;
    const next = { ...item, ...patch };
    await tx('items', 'readwrite', (store) => store.put(next));
    return next;
  },

  boardList: () => tx('boards', 'readonly', (store) => store.getAll()).then((rows) => (rows || []).sort((a, b) => b.createdAt - a.createdAt)),
  boardCreate: (name) => {
    const board = { id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, createdAt: Date.now() };
    return tx('boards', 'readwrite', (store) => store.put(board)).then(() => board);
  },
  boardRemove: (boardId) => tx('boards', 'readwrite', (store) => store.delete(boardId)),

  snapshotSave: async (videoId, metrics) => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${videoId}|${day}`;
    const existing = await tx('videoSnapshots', 'readonly', (store) => store.get(key));
    const row = { key, videoId, takenAt: Date.now(), day, ...metrics };
    await tx('videoSnapshots', 'readwrite', (store) => store.put(row));
    return { row, replaced: !!existing };
  },
  snapshotList: async (videoId) => {
    const all = (await tx('videoSnapshots', 'readonly', (store) => store.getAll())) || [];
    return all.filter((row) => row.videoId === videoId).sort((a, b) => a.takenAt - b.takenAt);
  },

  thumbList,
  thumbSample,

  /* ---- capturas da varredura (Screenshot → aba cheia) ---- */
  // 'captures' guarda a imagem cheia; 'captureMeta' guarda o resto (com miniatura). A galeria
  // lê só a captureMeta, então abrir a lista de vídeos não carrega imagem nenhuma.
  captureClear: async (videoId) => {
    const metas = (await tx('captureMeta', 'readonly', (store) => store.getAll())) || [];
    const alvo = metas.filter((row) => row.videoId === videoId);
    if (!alvo.length) return { removidos: 0 };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['captures', 'captureMeta'], 'readwrite');
      for (const row of alvo) { transaction.objectStore('captures').delete(row.key); transaction.objectStore('captureMeta').delete(row.key); }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return { removidos: alvo.length };
  },
  // grava a imagem cheia e os metadados numa única transação
  capturePut: async (row) => {
    const { dataUrl, ...meta } = row;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['captures', 'captureMeta'], 'readwrite');
      transaction.objectStore('captures').put(row);
      transaction.objectStore('captureMeta').put(meta);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return { ok: true };
  },
  // atualiza só campos de metadado (score, rosto, miniatura) sem reenviar a imagem
  captureUpdate: async (key, patch) => {
    const atual = await tx('captureMeta', 'readonly', (store) => store.get(key));
    if (!atual) return { ok: false };
    await tx('captureMeta', 'readwrite', (store) => store.put({ ...atual, ...patch }));
    return { ok: true };
  },
  captureList: async (videoId) => {
    const all = (await tx('captureMeta', 'readonly', (store) => store.getAll())) || [];
    return all.filter((row) => row.videoId === videoId).sort((a, b) => a.time - b.time);
  },
  captureGet: (key) => tx('captures', 'readonly', (store) => store.get(key)),
  // índice por vídeo: total, título, data e a capa (melhor frame com miniatura)
  captureIndex: async () => {
    const all = (await tx('captureMeta', 'readonly', (store) => store.getAll())) || [];
    const porVideo = new Map();
    for (const row of all) {
      const atual = porVideo.get(row.videoId) || { videoId: row.videoId, videoTitle: '', total: 0, takenAt: 0, coverKey: null, thumb: null, coverScore: -2 };
      atual.total++;
      atual.takenAt = Math.max(atual.takenAt, row.takenAt || 0);
      if (row.videoTitle) atual.videoTitle = row.videoTitle;
      const score = Number.isFinite(row.score) ? row.score : -1;
      if (row.thumb && score > atual.coverScore) { atual.coverScore = score; atual.coverKey = row.key; atual.thumb = row.thumb; }
      if (!atual.coverKey && !atual.coverKey2) atual.coverKey2 = row.key;   // capa de reserva (sem miniatura)
      porVideo.set(row.videoId, atual);
    }
    return [...porVideo.values()]
      .map(({ coverScore, coverKey2, ...item }) => ({ ...item, coverKey: item.coverKey || coverKey2 || null }))
      .sort((a, b) => b.takenAt - a.takenAt);
  },

  exportAll,
  importAll
};
