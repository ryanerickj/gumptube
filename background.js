// Gumptube — service worker.
// Toda a rede passa por aqui: content scripts em MV3 obedecem ao CORS da página.
// O banco central (IndexedDB da extensão) também vive aqui — ver src/db-sw.js.
import { dbOps } from './src/db-sw.js';

// A sondagem A/B via youtubei exige Origin https://www.youtube.com. Nos content scripts isso
// é automático (same-origin), mas na aba cheia da Gumptube o Chrome enviaria
// Origin chrome-extension://… e o YouTube devolve 403. Esta regra DNR conserta o cabeçalho.
async function registrarRegraOrigin() {
  try {
    const regra = {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Origin', operation: 'set', value: 'https://www.youtube.com' }]
      },
      condition: {
        urlFilter: '||youtube.com/youtubei/',
        resourceTypes: ['xmlhttprequest'],
        initiatorDomains: [chrome.runtime.id]
      }
    };
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1], addRules: [regra] });
  } catch {
    // alguns Chromes não aceitam o próprio id em initiatorDomains — regra só para youtubei, sem iniciador
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [1],
        addRules: [{
          id: 1,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Origin', operation: 'set', value: 'https://www.youtube.com' }] },
          condition: { urlFilter: '||youtube.com/youtubei/', resourceTypes: ['xmlhttprequest'] }
        }]
      });
    } catch { /* sem DNR, a sondagem na aba cheia avisa o erro na tela */ }
  }
}
registrarRegraOrigin();

const TTL = { video: 10 * 60e3, channel: 6 * 60 * 60e3, image: 30 * 60e3 };
const cache = new Map();   // key -> { at, value }
const inflight = new Map(); // key -> Promise (deduplica requisições em voo)

function cached(key, ttl, work) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);
  const run = work()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

function pick(re, text) {
  const match = text.match(re);
  return match ? match[1] : null;
}

function unescapeJson(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
}

function unescapeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

async function fetchVideoPage(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    credentials: 'omit',
    headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao ler a página do vídeo.`);
  const html = await response.text();

  const detailsAt = html.indexOf('"videoDetails"');
  const details = detailsAt >= 0 ? html.slice(detailsAt, detailsAt + 8000) : '';
  const microAt = html.indexOf('"playerMicroformatRenderer"');
  const micro = microAt >= 0 ? html.slice(microAt, microAt + 6000) : '';

  const views = pick(/"viewCount":"(\d+)"/, details);
  // o contador de likes também vem embutido no JSON da página — mais confiável que raspar o DOM
  const likesRaw = pick(/"likeCount":"?(\d+)"?[,}]/, html)
    || pick(/"likeCountIfLiked":\{"accessibilityText":"[^"]*?([\d.,]+)/, html);
  const data = {
    videoId,
    views: views ? Number(views) : null,
    likes: likesRaw ? Number(String(likesRaw).replace(/[.,]/g, '')) || null : null,
    lengthSeconds: Number(pick(/"lengthSeconds":"(\d+)"/, details)) || null,
    title: unescapeJson(pick(/"title":"((?:[^"\\]|\\.)*)"/, details)),
    author: unescapeJson(pick(/"author":"((?:[^"\\]|\\.)*)"/, details)),
    channelId: pick(/"channelId":"([\w-]+)"/, details),
    publishDate: pick(/"publishDate":"([^"]+)"/, micro) || pick(/"publishDate":"([^"]+)"/, html),
    uploadDate: pick(/"uploadDate":"([^"]+)"/, micro),
    category: unescapeJson(pick(/"category":"((?:[^"\\]|\\.)*)"/, micro)),
    isLive: /"isLiveContent":true/.test(details),
    source: 'pagina'
  };
  if (data.views === null && !data.title) throw new Error('A página do vídeo não expôs os dados esperados.');
  return data;
}

async function fetchChannelFeed(channelId) {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
    credentials: 'omit'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao ler o feed do canal.`);
  const xml = await response.text();

  const head = xml.slice(0, xml.indexOf('<entry>') === -1 ? 2000 : xml.indexOf('<entry>'));
  const channelName = unescapeXml(pick(/<title>([^<]*)<\/title>/, head));

  const videos = [];
  const entries = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
  for (const [, entry] of entries) {
    const id = pick(/<yt:videoId>([^<]+)<\/yt:videoId>/, entry);
    if (!id) continue;
    const viewsRaw = pick(/<media:statistics\s+views="(\d+)"/, entry);
    videos.push({
      videoId: id,
      title: unescapeXml(pick(/<media:title>([^<]*)<\/media:title>/, entry) || pick(/<title>([^<]*)<\/title>/, entry)),
      published: pick(/<published>([^<]+)<\/published>/, entry),
      views: viewsRaw ? Number(viewsRaw) : null,
      thumb: pick(/<media:thumbnail\s+url="([^"]+)"/, entry)
    });
  }
  if (!videos.length) throw new Error('O feed do canal veio sem vídeos.');
  return { channelId, channelName, videos, source: 'rss', fetchedAt: Date.now() };
}

async function fetchImageDataUrl(url, fresh = false) {
  const response = await fetch(url, { credentials: 'omit', cache: fresh ? 'reload' : 'default' });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar a imagem.`);
  const type = response.headers.get('content-type') || 'image/jpeg';
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength < 1024) throw new Error('Imagem indisponível nesta resolução.');
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buffer.subarray(i, i + CHUNK));
  }
  return { dataUrl: `data:${type};base64,${btoa(binary)}`, bytes: buffer.byteLength };
}

// Cascata oficial de thumbnails: maxres nem sempre existe.
async function fetchBestThumb(videoId, fresh = false) {
  const names = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault'];
  let lastError = null;
  for (const name of names) {
    try {
      const result = await fetchImageDataUrl(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`, fresh);
      return { ...result, quality: name };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Nenhuma thumbnail disponível para este vídeo.');
}

async function fetchChannelPage(path) {
  const response = await fetch(`https://www.youtube.com${path}`, {
    credentials: 'omit',
    headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao ler a página do canal.`);
  const html = await response.text();
  const channelId = pick(/"externalId":"(UC[\w-]+)"/, html)
    || pick(/channel_id=(UC[\w-]+)/, html)
    || pick(/"browseId":"(UC[\w-]+)"/, html);
  if (!channelId) throw new Error('Não foi possível identificar o canal nesta página.');
  return {
    channelId,
    name: unescapeJson(pick(/"channelMetadataRenderer":\{"title":"((?:[^"\\]|\\.)*)"/, html))
      || unescapeJson(pick(/"title":"((?:[^"\\]|\\.)*)","description"/, html)),
    subsText: pick(/"subscriberCountText":\{"simpleText":"([^"]+)"/, html)
      || pick(/"subscriberCountText":\{"accessibility".*?"simpleText":"([^"]+)"/, html),
    source: 'pagina'
  };
}

// Extrai um array JSON balanceado a partir de uma chave no HTML.
function extractArray(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('[', at);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[') depth++;
    else if (char === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Lista de faixas de legenda. O CORPO da legenda é baixado pelo content script: o endpoint
// timedtext responde vazio para requisições fora do contexto da página do YouTube.
async function fetchCaptionTracks(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    credentials: 'omit',
    headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao ler a página do vídeo.`);
  const html = await response.text();

  const tracks = extractArray(html, '"captionTracks"');
  if (!tracks || !tracks.length) throw new Error('Este vídeo não tem faixas de legenda públicas.');

  const isAuto = (track) => track.kind === 'asr';
  const rank = (track) => ((track.languageCode || '').startsWith('pt') ? 2 : 0) + (isAuto(track) ? 0 : 1);

  return {
    videoId,
    tracks: [...tracks].sort((a, b) => rank(b) - rank(a)).map((track) => ({
      baseUrl: track.baseUrl,
      lang: track.languageCode || '',
      name: track.name?.simpleText || track.name?.runs?.[0]?.text || '',
      auto: isAuto(track)
    }))
  };
}

// Extrai um objeto JSON balanceado a partir de uma chave no HTML.
function extractObject(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Coleta todos os objetos com determinada chave dentro da árvore de resposta do YouTube.
function collectRenderers(node, key, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectRenderers(item, key, out);
    return out;
  }
  for (const [name, value] of Object.entries(node)) {
    if (name === key && value && typeof value === 'object') out.push(value);
    else collectRenderers(value, key, out);
  }
  return out;
}

const textOf = (node) => node?.simpleText || node?.runs?.map((run) => run.text).join('') || '';

// Busca pública do YouTube. `sort`: '' relevância · CAI= recentes · CAM= mais vistos · CAE= avaliação
async function fetchSearch(query, sort = '') {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    + (sort ? `&sp=${encodeURIComponent(sort)}` : '');
  const response = await fetch(url, { credentials: 'omit', headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} na busca.`);
  const html = await response.text();

  const data = extractObject(html, 'var ytInitialData =') || extractObject(html, '"ytInitialData"');
  if (!data) throw new Error('A busca não devolveu resultados legíveis.');

  const results = [];
  const seen = new Set();
  for (const renderer of collectRenderers(data, 'videoRenderer')) {
    const videoId = renderer.videoId;
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    const thumbs = renderer.thumbnail?.thumbnails || [];
    results.push({
      videoId,
      title: textOf(renderer.title),
      channel: textOf(renderer.ownerText) || textOf(renderer.longBylineText),
      viewsText: textOf(renderer.shortViewCountText) || textOf(renderer.viewCountText),
      publishedText: textOf(renderer.publishedTimeText),
      durationText: textOf(renderer.lengthText),
      thumbUrl: thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    });
  }
  if (!results.length) throw new Error('Nenhum vídeo encontrado para esse termo.');
  return { query, sort, results, source: 'busca pública' };
}

// ---------------------------------------------------------------- histórico público
// O YouTube não publica quando uma thumbnail mudou. O Internet Archive, sim: ele guarda a própria
// imagem do i.ytimg.com ao longo dos anos, e cada "digest" diferente é uma arte diferente.
async function fetchArchivedHistory(videoId) {
  const nomes = ['maxresdefault', 'hqdefault'];
  const versoes = [];

  for (const nome of nomes) {
    const url = `https://web.archive.org/cdx/search/cdx?url=i.ytimg.com/vi/${videoId}/${nome}.jpg`
      + '&output=json&collapse=digest&fl=timestamp,digest,statuscode&limit=120';
    let linhas = null;
    try {
      const controller = new AbortController();
      const limite = setTimeout(() => controller.abort(), 28000);   // o CDX costuma levar 10–25 s
      const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
      clearTimeout(limite);
      if (!response.ok) continue;
      const texto = await response.text();
      if (!texto.trim()) continue;
      linhas = JSON.parse(texto);
    } catch {
      continue;
    }
    if (!Array.isArray(linhas) || linhas.length < 2) continue;

    const vistos = new Set();
    for (const [timestamp, digest, statuscode] of linhas.slice(1)) {
      if (statuscode !== '200') continue;           // 404/revisita não é arte nova
      if (!digest || vistos.has(digest)) continue;
      vistos.add(digest);
      versoes.push({
        timestamp,
        digest,
        capturadoEm: `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`,
        url: `https://web.archive.org/web/${timestamp}im_/https://i.ytimg.com/vi/${videoId}/${nome}.jpg`,
        resolucao: nome
      });
    }
    if (versoes.length) break;                      // maxres já resolveu; hqdefault é só reserva
  }

  versoes.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { videoId, versoes, fonte: 'Internet Archive (CDX)' };
}

// Teste A/B de thumbnail/título — detecção DETERMINÍSTICA, validada empiricamente:
// durante um "Teste e Comparar", as superfícies de impressão (busca, feed) sorteiam a arte a
// cada renderização, e o arquivo servido ganha sufixo *_custom_N.jpg (ex.: hq720_custom_1.jpg)
// com URL assinada (sqp/rs) — o N identifica a variante. Sem teste, o arquivo é puro (hq720.jpg).
// O endpoint do player NÃO expõe o teste (devolve só a arte canônica); a busca interna expõe.
// Então: várias chamadas à busca interna (deslogadas, sem cache) = várias impressões reais.
// Bônus: cada impressão também traz o TÍTULO sorteado — teste de título cai na mesma rede.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';   // chave pública do cliente web

// Caminha o JSON colhendo TODAS as aparições do vídeo na resposta — cada renderer traz a arte
// e o título sorteados. Parse real evita o regex capturar o título do vídeo vizinho, e renderers
// paralelos com a arte canônica (maxresdefault puro) não podem mais esconder a variante custom.
function colherAparicoes(node, videoId, saida) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) colherAparicoes(item, videoId, saida); return; }
  if (node.videoId === videoId) {
    const runs = node.title?.runs;
    const titulo = Array.isArray(runs) ? runs.map((r) => r?.text || '').join('') : (node.title?.simpleText || null);
    if (titulo) saida.titulos.add(titulo);
    const thumbs = node.thumbnail?.thumbnails;
    if (Array.isArray(thumbs)) {
      for (const t of thumbs) {
        if (typeof t?.url === 'string' && (t.url.includes(`/vi/${videoId}/`) || t.url.includes(`/vi_webp/${videoId}/`))) {
          saida.urls.add(t.url.startsWith('//') ? `https:${t.url}` : t.url);
        }
      }
    }
  }
  for (const value of Object.values(node)) colherAparicoes(value, videoId, saida);
}

async function amostraDeImpressao(videoId) {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'pt', gl: 'BR' } },
      query: videoId
    })
  });
  if (!response.ok) throw new Error(`Busca interna respondeu ${response.status}.`);
  const saida = { titulos: new Set(), urls: new Set() };
  colherAparicoes(await response.json(), videoId, saida);

  // identidade da variante = nome do arquivo (hq720_custom_2 etc.)
  const porNome = new Map();
  for (const url of saida.urls) {
    const nome = url.match(/\/vi(?:_webp)?\/[^/]+\/([a-zA-Z0-9_]+)\.(?:jpg|webp)/)?.[1];
    if (nome && !porNome.has(nome)) porNome.set(nome, url);
  }
  const nomes = [...porNome.keys()];
  // arquivos de teste têm prioridade ABSOLUTA: a arte canônica aparece junto em renderers
  // paralelos e, se ganhasse por "peso", esconderia o teste (era o bug da versão anterior)
  let escolhidos = nomes.filter((n) => /_custom_\d+/.test(n));
  if (!escolhidos.length && nomes.length) {
    const peso = (n) => (n.startsWith('maxres') ? 3 : n.startsWith('hq720') ? 2 : 1);
    escolhidos = [[...nomes].sort((a, b) => peso(b) - peso(a))[0]];
  }
  return {
    artes: escolhidos.map((arquivo) => ({ arquivo, url: porNome.get(arquivo) })),
    titulos: [...saida.titulos]
  };
}

async function fetchThumbVariants(videoId) {
  const AMOSTRAS = 8;
  const porArquivo = new Map();   // nome do arquivo = identidade da variante (custom_N)
  const titulos = new Map();
  let colhidas = 0;
  let falhas = 0;
  let primeiroErro = null;

  for (let i = 0; i < AMOSTRAS; i++) {
    if (i) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const { artes, titulos: vistos } = await amostraDeImpressao(videoId);
      if (artes.length) colhidas++;
      for (const arte of artes) {
        const atual = porArquivo.get(arte.arquivo);
        if (atual) atual.vezes++;
        else porArquivo.set(arte.arquivo, { arquivo: arte.arquivo, url: arte.url, vezes: 1 });
      }
      for (const t of vistos) titulos.set(t, (titulos.get(t) || 0) + 1);
    } catch (error) {
      falhas++;
      if (!primeiroErro) primeiroErro = error.message || String(error);
    }
  }
  if (!colhidas) {
    throw new Error(falhas
      ? `Nenhuma impressão colhida — ${falhas} falha${falhas === 1 ? '' : 's'} (${primeiroErro}).`
      : 'A busca interna não devolveu este vídeo (muito novo ou não listado).');
  }

  // baixa cada variante distinta pela URL ASSINADA (sem assinatura os arquivos custom dão 404)
  const variantes = [];
  for (const item of porArquivo.values()) {
    const indice = item.arquivo.match(/_custom_(\d+)/)?.[1] ?? null;
    let dataUrl = null;
    try { ({ dataUrl } = await fetchImageDataUrl(item.url, false)); } catch { /* exibimos mesmo sem imagem */ }
    variantes.push({ ...item, dataUrl, indice, teste: indice !== null });
  }
  variantes.sort((a, b) => b.vezes - a.vezes);

  return {
    videoId,
    amostras: AMOSTRAS,
    colhidas,
    falhas,
    emTeste: variantes.some((v) => v.teste),
    variantes,
    titulos: [...titulos.entries()].map(([texto, vezes]) => ({ texto, vezes }))
  };
}

// ---------------------------------------------------------------- histórico de títulos
// O YouTube também não publica trocas de título. O Internet Archive guarda capturas da página
// do vídeo ao longo dos anos — lemos uma amostra espalhada delas e extraímos só o <title>,
// em streaming, abortando o download assim que o título aparece (a página inteira teria MBs).
// Capturas antigas vêm poluídas: página de erro do próprio Wayback, consent/captcha do Google
// no momento do crawl, stubs de JS. Nada disso é título de vídeo.
const TITULO_LIXO = /^(wayback machine|youtube)$|^https?:\/\/|before you continue|sorry/i;
function tituloValido(valor) {
  const puro = String(valor || '').trim();
  return puro && !TITULO_LIXO.test(puro) ? puro : null;
}

async function tituloDaCaptura(videoId, timestamp) {
  const controller = new AbortController();
  const limite = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(
      `https://web.archive.org/web/${timestamp}id_/https://www.youtube.com/watch?v=${videoId}`,
      { credentials: 'omit', signal: controller.signal }
    );
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let texto = '';
    while (texto.length < 400000) {
      const { done, value } = await reader.read();
      if (done) break;
      texto += decoder.decode(value, { stream: true });
      const meta = texto.match(/<meta\s+name="title"\s+content="([^"]*)"/i);
      if (meta) { reader.cancel().catch(() => {}); return tituloValido(unescapeXml(meta[1])); }
      const tag = texto.match(/<title>([\s\S]*?)<\/title>/i);
      if (tag) {
        reader.cancel().catch(() => {});
        return tituloValido(unescapeXml(tag[1]).replace(/\s*-\s*YouTube\s*$/i, ''));
      }
    }
    reader.cancel().catch(() => {});
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(limite);
  }
}

async function fetchTitleHistory(videoId) {
  // uma captura por mês no máximo (collapse=timestamp:6) — suficiente para datar trocas
  const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`youtube.com/watch?v=${videoId}`)}`
    + '&output=json&fl=timestamp,statuscode&filter=statuscode:200&collapse=timestamp:6&limit=400';
  let linhas = null;
  try {
    const controller = new AbortController();
    const limite = setTimeout(() => controller.abort(), 28000);
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    clearTimeout(limite);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const texto = await response.text();
    linhas = texto.trim() ? JSON.parse(texto) : [];
  } catch (error) {
    throw new Error('O arquivo público (CDX) não respondeu agora. Tente de novo em instantes.');
  }
  const capturas = Array.isArray(linhas) ? linhas.slice(1).map((linha) => linha[0]).filter(Boolean) : [];
  if (!capturas.length) return { videoId, titulos: [], capturas: 0, fonte: 'Internet Archive (CDX)' };

  // amostra espalhada: primeira, última e intermediárias — teto de 8 downloads para caber no timeout da ponte
  const MAX = 8;
  const escolhidas = [];
  if (capturas.length <= MAX) escolhidas.push(...capturas);
  else {
    for (let i = 0; i < MAX; i++) {
      escolhidas.push(capturas[Math.round((i * (capturas.length - 1)) / (MAX - 1))]);
    }
  }

  const titulos = [];
  let primeira = true;
  for (const timestamp of [...new Set(escolhidas)]) {
    if (!primeira) await new Promise((resolve) => setTimeout(resolve, 300));   // gentileza com o archive
    primeira = false;
    const titulo = await tituloDaCaptura(videoId, timestamp);
    if (!titulo) continue;
    const capturadoEm = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`;
    const anterior = titulos[titulos.length - 1];
    if (anterior && anterior.titulo === titulo) anterior.vistoAte = capturadoEm;   // mesmo título: estende a janela
    else titulos.push({ titulo, capturadoEm, vistoAte: capturadoEm, timestamp });
  }
  return { videoId, titulos, capturas: capturas.length, amostradas: escolhidas.length, fonte: 'Internet Archive (CDX)' };
}

const HANDLERS = {
  'gt:video-page': ({ videoId }) => cached(`video:${videoId}`, TTL.video, () => fetchVideoPage(videoId)),
  'gt:channel-feed': ({ channelId }) => cached(`channel:${channelId}`, TTL.channel, () => fetchChannelFeed(channelId)),
  'gt:image': ({ url }) => cached(`img:${url}`, TTL.image, () => fetchImageDataUrl(url)),
  // fresh: ignora cache — é assim que se percebe que a arte mudou na mesma URL
  'gt:thumb': ({ videoId, fresh }) => (fresh
    ? fetchBestThumb(videoId, true)
    : cached(`thumb:${videoId}`, TTL.image, () => fetchBestThumb(videoId))),
  'gt:channel-page': ({ path }) => cached(`channelPage:${path}`, TTL.channel, () => fetchChannelPage(path)),
  'gt:thumb-history': ({ videoId }) => cached(`arquivo:${videoId}`, TTL.channel, () => fetchArchivedHistory(videoId)),
  'gt:thumb-variants': ({ videoId }) => fetchThumbVariants(videoId),
  'gt:title-history': ({ videoId }) => cached(`titulos:${videoId}`, TTL.channel, () => fetchTitleHistory(videoId)),
  'gt:search': ({ query, sort }) => cached(`busca:${sort}:${query}`, TTL.video, () => fetchSearch(query, sort)),
  'gt:caption-tracks': ({ videoId }) => cached(`tracks:${videoId}`, TTL.channel, () => fetchCaptionTracks(videoId)),
  // banco central — todas as abas falam com o MESMO IndexedDB (origem da extensão)
  'gt:db': ({ op, args }) => {
    const operacao = dbOps[op];
    if (!operacao) return Promise.reject(new Error(`Operação de banco desconhecida: ${op}`));
    return operacao(...(Array.isArray(args) ? args : []));
  },
  // abre a Gumptube em aba cheia (páginas da extensão só abrem via chrome.tabs)
  'gt:open-app': async ({ query }) => {
    const url = chrome.runtime.getURL('app.html') + (query ? `?${query}` : '');
    const tab = await chrome.tabs.create({ url });
    return { tabId: tab.id };
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'download-frame' && message.url && message.filename) {
    chrome.downloads.download({ url: message.url, filename: message.filename, saveAs: true });
    return false;
  }
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  handler(message.payload ?? {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true; // resposta assíncrona
});

// Uma aba do YouTube aberta ANTES de instalar/recarregar a extensão fica sem content script —
// é por isso que "só funciona depois de recarregar o vídeo". Aqui injetamos nessas abas.
const CONTENT_FILES = [
  'src/core.js', 'src/zip.js', 'src/db.js', 'src/analysis.js', 'src/data.js', 'src/phrases.js', 'src/captions.js',
  'src/style.js', 'src/view-launcher.js', 'src/thumb-search.js', 'src/view-arsenal.js', 'src/view-screenshot.js', 'src/view-dados.js',
  'src/view-frases.js', 'src/panel.js', 'src/grid-actions.js', 'src/player-button.js', 'src/content.js'
];

async function injectIntoOpenTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://youtube.com/*'] });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      // Sempre reinjetamos: depois de recarregar a extensão, o script antigo continua na página
      // porém órfão (sem acesso a chrome.*). O novo assume o lugar pelo contador de geração.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
      // A ponte de qualidade precisa do mundo da página para falar com a API do player.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/page-quality.js'], world: 'MAIN' });
    } catch {
      /* aba sem permissão ou em processo de fechar: ignora */
    }
  }
}

chrome.runtime.onInstalled.addListener(() => injectIntoOpenTabs());
chrome.runtime.onStartup.addListener(() => injectIntoOpenTabs());

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id && /^https:\/\/(www\.)?youtube\.com\//.test(tab.url || '')) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'gt:toggle-panel' });
      return;
    } catch {
      /* aba antiga, sem o content script novo: recarrega abaixo */
    }
  }
  chrome.tabs.create({ url: 'https://www.youtube.com/' });
});
