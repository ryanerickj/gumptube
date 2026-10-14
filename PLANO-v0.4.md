# Anexo técnico — Gumptube v0.4 (base para os 3 pilares)

> **Nota (17/09/2026):** a Gumptube foi reposicionada como plataforma de 3 pilares
> (Arsenal · Screenshot · Dados). O documento mestre de produto é [PLANO-PLATAFORMA.md](PLANO-PLATAFORMA.md);
> este arquivo passa a ser o **anexo técnico** (build, parsers, storyboards, IndexedDB, riscos).
> A ordem das fases na seção 5 foi substituída pelo roadmap do documento mestre.

> Documento de planejamento técnico. Continuação do plano de produto da v0.4, agora
> ancorado no que existe de fato no build 0.3.1 desta pasta.
> Última revisão: 17/09/2026.

---

## 0. Situação atual (auditoria do build 0.3.1)

O que está nesta pasta hoje:

| Arquivo | Conteúdo |
|---|---|
| `manifest.json` | MV3, permissões `storage` + `downloads`, host permissions só `youtube.com` |
| `content.js` | Bundle único de 1,16 MB (React **development**) com `src/main.tsx`, `src/arsenal.ts`, `src/arsenal-panel.tsx` |
| `content.css` | Tema vermelho (`#e51937` / `#ff4d5e` / fundo `#17090c`), painel `.ff-card`, modal 1240px |
| `analyzer.js` + `analyzer.html` | Iframe isolado que carrega MediaPipe FaceLandmarker e responde por `postMessage` (`ff-init`, `ff-detect`) |
| `background.js` | 7 linhas: só `chrome.downloads.download` para o frame exportado |
| `vendor/`, `wasm/`, `models/` | MediaPipe vision bundle, WASM e `face_landmarker.task` |

Capacidades reais hoje:

- Painel React injetado na página do vídeo, abas **Melhores / Câmera / Rosto / B-roll / Similares / Arsenal / Dados**.
- Varredura **manual** (botão "Analisar vídeo"): `seek()` a cada 10 s (20 s se o vídeo passa de 20 min), teto de **90 frames**, pausa/retoma o player e restaura o `currentTime` no fim.
- Por frame: `measureQuality()` (nitidez por gradiente, brilho, contraste, clipping, exposição), `analyzeFace()` (yaw/roll/EAR/blendshapes → pose, olhos abertos, sorriso, área do rosto), `hash()` (aHash 8×8 = 64 bits), `clusterFrames()` (cenas por distância de hash) e `diverseRank()` (ranking com penalidade de similaridade).
- Arsenal: IndexedDB `frame-finder-arsenal` v1, store `favorites`, chave `${videoId}-${ms}`, campos `{id, createdAt, videoId, videoTitle, videoUrl, time, dataUrl, width, height, hash, score, tags[]}`, comparação por distância de hash.
- Aba "Dados": só o que é local (título, canal, duração, resolução do player, frames analisados, cenas). **Nenhuma métrica do YouTube ainda.**

### 0.1 Lacuna crítica: não existe código-fonte nesta pasta

Só o bundle compilado está aqui — não há `src/`, `package.json`, nem configuração de build.
Editar 19.812 linhas de bundle com React em modo dev à mão é inviável para o escopo da v0.4
(nova página `studio.html`, service worker com vários módulos, novas stores).

**Fase 0 (bloqueante) — reconstruir o projeto:**

1. Recuperar `src/main.tsx`, `src/arsenal.ts`, `src/arsenal-panel.tsx` do bundle (o código da aplicação está legível nas linhas 18741–19812 de `content.js`) e retipar em TypeScript.
2. Criar `package.json` + esbuild com três entradas: `content.js`, `background.js` (module), `studio.js`, mais `analyzer.js`.
3. Build de **produção** do React (`--define:process.env.NODE_ENV='"production"'` + `--minify`): o bundle cai de ~1,16 MB para uma fração disso e o JSX deixa de usar `jsxDEV`.
4. Confirmar que o 0.3.1 reconstruído se comporta igual antes de escrever qualquer linha de v0.4.

> Se o Ryan já tiver o `src/` original em outro lugar, a Fase 0 vira só "trazer o fonte + build de produção" e economiza a maior parte deste passo.

---

## 1. Objetivo da v0.4

Concentrar na Gumptube um conjunto de ferramentas de trabalho diário inspirado no ViewStats
(Channelytics, estatísticas na página, Thumbnail Game, pesquisa/referências), usando
**apenas dados públicos do YouTube e armazenamento local** — sem backend, sem conta, sem custo.

### Princípios desta versão

1. **Zero clique, zero espera.** Tudo que puder carregar sozinho carrega ao abrir o vídeo. Nada de botão "Analisar" para dado básico.
2. **Zero interferência no player.** Nenhum `seek` automático. A análise inicial vem de storyboards; o refino vem de frames capturados *enquanto o vídeo toca*. O player só é posicionado quando o usuário pede exportação em alta.
3. **Thumbnail é cidadão de primeira classe.** Busca por nicho com grade de thumbnails reais, integrada ao Arsenal.
4. **Nunca inventar número.** Todo valor exibido carrega origem (`página`, `RSS`, `busca`, `estimativa`, `storyboard`) e precisão (`exato` / `aproximado`). Dado indisponível aparece como indisponível — nunca interpolado.

---

## 2. Fontes de dados: o que dá, como pega, onde quebra

| Fonte | Como obter | Entrega | Limite honesto |
|---|---|---|---|
| `ytInitialPlayerResponse` | Regex nos `<script>` da página (content script está em mundo isolado, não enxerga a variável global) | Storyboard spec, duração exata, `videoDetails`, `viewCount` **exato** | Chave pode mudar de nome; parser precisa falhar em silêncio |
| `ytInitialData` | Idem | Título, canal, `channelId`, data de publicação, texto de views, likes **formatados** | Likes só aproximados ("12 mil") — o número exato não é mais público |
| DOM da página | `document.querySelector` | Fallback de título/canal | Muda com frequência; sempre secundário |
| RSS do canal | `https://www.youtube.com/feeds/videos.xml?channel_id=UC…` via service worker | Últimos **15** vídeos com título, id, data e, quando presente, `media:statistics/@views` | Só 15 itens; sem duração (Shorts entram misturados na mediana); views do feed às vezes ausentes |
| Página do canal | `/@handle` e `/@handle/videos` via service worker | Inscritos (arredondado), total de views (em `/about`), lista maior de uploads | Inscritos sempre arredondados pelo YouTube ("1,2 mi") |
| Busca pública | `/results?search_query=…` via service worker, parse de `ytInitialData` | Grade de resultados com thumb, título, canal, views **aproximadas**, idade relativa ("há 3 semanas") | Views aproximadas; idade relativa vira data estimada; layout de resposta muda |
| Storyboards | Spec do player response → mosaicos em `i.ytimg.com/sb/…` | Miniaturas de toda a linha do tempo, sem tocar no player | Tiles pequenos (~160×90 no nível alto); ausentes em lives e alguns vídeos |
| Thumbnails | `i.ytimg.com/vi/<id>/maxresdefault.jpg` (fallback `hqdefault`) | Imagem oficial em alta | `maxres` não existe para todo vídeo — precisa de cascata de fallback |

### 2.1 Storyboards — detalhamento

O spec vem em `storyboards.playerStoryboardSpecRenderer.spec`: uma URL-modelo com `$L` (nível) e
`$N` (nome), seguida de blocos separados por `|`, um por nível, com largura/altura do tile,
colunas, linhas, intervalo entre tiles em ms, nome e assinatura `sigh`. A URL final de cada mosaico é
o modelo com `$L`/`$N` substituídos mais `&sigh=<assinatura>`.

Decisões de implementação:

- **Parser defensivo e validado**: se qualquer campo numérico não bater (colunas × linhas × mosaicos ≠ cobertura da duração), o módulo desiste e cai para o fluxo oportunista, sem erro visível.
- **Fetch pelo service worker** (`host_permissions` em `https://i.ytimg.com/*`), porque `fetch` de content script em MV3 obedece ao CORS da página. O SW devolve `ImageBitmap`/blob transferível.
- **Nível escolhido**: o mais alto disponível (tile maior). Fatiar o mosaico em `OffscreenCanvas`, um tile por timestamp `índice × intervalo`.
- **Honestidade sobre o que dá pra medir num tile de 160×90**: cena, hash, corte de cena, paleta, brilho/contraste e **presença** de rosto saem bem. Landmarks finos (olho aberto, sorriso, yaw preciso) ficam ruins nesse tamanho — o resultado será marcado como *aproximado* e refinado depois.

### 2.2 Refino sem seek: captura oportunista

Enquanto o usuário assiste, `video.requestVideoFrameCallback` entrega frames em resolução real
sem nenhum `seek`. A Gumptube amostra esses frames (um a cada N segundos de reprodução),
roda a análise completa neles e **substitui** o dado aproximado do storyboard pelo medido —
o card troca o selo `storyboard` por `frame real`. Custo zero de interferência, ganho de precisão
proporcional ao tempo que o vídeo é assistido.

A varredura profunda manual (com seeks) continua existindo como opção explícita.

---

## 3. Arquitetura alvo

```
página do vídeo (content script)          página da extensão            service worker
┌───────────────────────────┐            ┌──────────────────┐        ┌─────────────────────┐
│ painel .ff-card (React)   │            │ studio.html      │        │ fetch RSS/busca/    │
│  • Insights automáticos   │◄─messages─►│  • Channelytics  │◄──────►│   canal/storyboard  │
│  • Abas de frames         │            │  • Thumb Search  │        │ cache + throttle    │
│  • Arsenal / Boards       │            │  • Style Report  │        │ chrome.alarms       │
│  • rVFC (captura oport.)  │            │  • Thumb Game    │        │ snapshots           │
└──────────┬────────────────┘            └────────┬─────────┘        └──────────┬──────────┘
           │ postMessage (bitmap)                 │                             │
     ┌─────▼──────────────┐                       └───────── IndexedDB `gumptube` v2 ────────┘
     │ analyzer.html      │  MediaPipe FaceLandmarker (já existe; reaproveitado tal e qual)
     └────────────────────┘
```

Regras de arquitetura:

- **Todo acesso à rede passa pelo service worker.** Content script e Studio só pedem e recebem.
- **Cache com TTL por chave** (`canal:UC…` 6 h, `busca:<termo>:<página>` 30 min, `video:<id>` 10 min), com de-duplicação de requisições em voo e fila serializada — nada de rajada de requests ao YouTube.
- **Uma única camada de dados** (`src/db.ts`) compartilhada por painel, Studio e SW.
- **Parsing isolado** em `src/parsers/` (um arquivo por fonte), cada um com teste de fixture salva. Quando um parser falha, o módulo mostra o que conseguiu e sinaliza a lacuna.
- **MediaPipe em lote** (relatório de estilo do nicho) roda dentro da própria `studio.html`, que é página de extensão e tem DOM — sem precisar de `chrome.offscreen`.

### 3.1 Diff do `manifest.json`

```jsonc
{
  "version": "0.4.0",
  "permissions": ["storage", "downloads", "alarms", "unlimitedStorage"],
  "host_permissions": [
    "https://www.youtube.com/*",
    "https://youtube.com/*",
    "https://i.ytimg.com/*",
    "https://yt3.ggpht.com/*"
  ],
  "action": { "default_title": "Gumptube Studio" },   // clique abre studio.html
  "web_accessible_resources": [{ "resources": ["analyzer.html", "studio.html", "vendor/*", "models/*", "wasm/*", "content.css", "studio.css"], "matches": ["https://www.youtube.com/*", "https://youtube.com/*"] }]
}
```

`unlimitedStorage` porque thumbnails e frames em `dataUrl` crescem rápido; sem ele o IndexedDB
pode ser despejado justamente no Arsenal, que é o que o usuário menos quer perder.

### 3.2 Modelo de dados — IndexedDB `gumptube` v2

Migração da base atual (`frame-finder-arsenal` v1) para uma base única, preservando os favoritos.

| Store | Chave | Campos principais |
|---|---|---|
| `items` | `id` | Substitui `favorites`. `kind: "frame" \| "reference"`, além dos campos atuais + `source`, `channelId`, `views`, `publishedAt`, `thumbUrl`, `origin: "meu-frame" \| "externo"` |
| `boards` | `id` | `name`, `createdAt`, `coverItemId`, `notes` |
| `boardItems` | `[boardId, itemId]` | `order`, `note` — relação N:N (um item em vários boards) |
| `videoSnapshots` | `[videoId, takenAt]` | `views`, `likesApprox`, `commentsApprox`, `source` |
| `channels` | `channelId` | `handle`, `name`, `subsApprox`, `totalViews`, `tracked: boolean`, `lastCheckedAt` |
| `channelSnapshots` | `[channelId, takenAt]` | `subsApprox`, `totalViews`, `recentMedianViews` |
| `searches` | `id` | `query`, `filters`, `createdAt`, `resultIds[]` |
| `styleReports` | `id` | `query`, `sampleSize`, `metrics`, `createdAt` |
| `gameScores` | `id` | `playedAt`, `streak`, `record`, `channelId` |

Cada registro de métrica guarda `{ value, source, precision }` — o selo de origem vive no dado,
não na UI, para que exportações (JSON/CSV) preservem a honestidade do número.

### 3.3 Protocolo de mensagens (content/studio → service worker)

```
gt:video-insights   { videoId }                  → { views, likes, publishedAt, channelId, source }
gt:channel-summary  { channelId | handle }       → { channel, recentVideos[], median, outliers[] }
gt:storyboard-spec  { videoId }                  → { levels[], chosen, tiles[] } | { unavailable: motivo }
gt:fetch-image      { url }                      → ImageBitmap transferível
gt:search           { query, filters, page }     → { results[], nextPage }
gt:snapshot         { kind, id }                 → { ok }
```

Toda resposta carrega `{ ok, data?, error?, stale? }`. `stale: true` = veio do cache expirado
porque a rede falhou — a UI mostra o dado com a marca de "atualizado em …".

---

## 4. Módulos

### 4.1 Video Insights automáticos

Carregam sozinhos ao abrir qualquer vídeo: views exatas, likes (aproximados, marcados como tal),
data de publicação, **views/dia** desde a publicação, engajamento e **outlier score** contra os
vídeos recentes do canal. O SW dispara RSS + dados do canal assim que a página abre e mantém cache,
então trocar de vídeo do mesmo canal é instantâneo. Cada vídeo aberto grava um snapshot local —
revisitas mostram a evolução real entre visitas ("histórico da sua Gumptube").

Tarefas: parser de `ytInitialPlayerResponse`/`ytInitialData`; hook `useVideoInsights`; aba "Dados"
virando **Insights**; gravação de snapshot com deduplicação por dia; render de delta entre snapshots.

Honestidade obrigatória: outlier score é **relativo ao canal** (views ÷ mediana dos até 15 uploads
recentes do RSS) e a amostra inclui Shorts quando o canal publica Shorts — isso vai escrito no
tooltip, junto com o tamanho da amostra.

### 4.2 Análise de frames automática por storyboards

Ao abrir o vídeo: busca do spec → download dos mosaicos pelo SW → fatiamento em `OffscreenCanvas` →
qualidade + hash + clusterização de cenas em todos os tiles → detecção de rosto nos tiles em uma fila
com concorrência limitada. As abas Melhores/Câmera/Rosto/B-roll já abrem preenchidas, cada card com
timestamp real e selo `storyboard`. A captura oportunista (4.2 acima, §2.2) vai promovendo cards para
`frame real`. Exportação em alta continua posicionando o player só no momento do export.

Orçamento de desempenho alvo: vídeo de 10 min → primeira grade preenchida em **≤ 4 s**,
análise facial completa dos tiles em **≤ 10 s**, sem travar a página (fila com `requestIdleCallback`).

### 4.3 Thumbnail Search + Arsenal integrado *(prioridade do Ryan)*

Campo de busca no Studio consultando a busca pública do YouTube em background, renderizando
**grade só de thumbnails grandes** com título/canal/views/idade e selo de outlier; filtros de duração,
data e ordenação, com paginação contínua. **Salvar em 1 clique** manda o item para o Arsenal como
referência (thumb em alta + metadados + tag automática do nicho pesquisado). **Referência visual**:
enviar imagem ou escolher item do Arsenal reordena resultados e Arsenal por similaridade local.
**URL direta**: colar link captura a thumbnail oficial na hora.

Sobre similaridade: o aHash 8×8 de hoje é fraco para comparar thumbnails (ignora cor e estrutura).
A v0.4 sobe para um vetor combinado — **dHash 16×16 + histograma de cor em HSV + mapa de bordas 4×4** —
com pesos ajustáveis. O hash antigo continua guardado para não invalidar o Arsenal existente.

Arsenal ganha filtro por origem (meus frames × referências externas) e busca textual + visual unificadas.

### 4.4 Análise de estilos do nicho

A partir de uma busca, baixa as thumbnails dos top resultados e roda o pipeline local em lote.
Relatório do nicho: % com rosto e tamanho médio do rosto, close vs. cena aberta, paletas dominantes,
brilho/contraste/saturação médios e **densidade estimada de texto** (regiões de alto contraste —
rotulada explicitamente como estimativa, porque não há OCR aqui) — tudo cruzado com views e outlier
score para mostrar o que os vídeos que performam têm em comum. Comparação direta: sua candidata
(Arsenal ou upload) ao lado do padrão do nicho, com delta por atributo.

Honestidade obrigatória: correlação com views **não é causalidade**, e a amostra é a primeira página
da busca — o relatório declara `n`, o termo e a data.

### 4.5 Collections / Research Boards

Boards nomeados agrupando frames próprios, referências externas e buscas salvas. Um item pertence a
vários boards; capa automática, contadores, notas por item e por board. Grade estilo moodboard com
arrastar-para-reordenar, exportação do board (JSON + imagens em ZIP) e do relatório de estilo do board.
A aba Arsenal do painel do vídeo ganha "salvar em board…" direto do frame analisado.

### 4.6 Gumptube Studio + Channelytics

`studio.html` aberta pelo ícone da extensão, navegação lateral própria no tema vermelho.
**Channelytics**: pesquisa de canal por URL/handle mostrando inscritos, total de views, vídeos
recentes com views/idade, média/mediana, frequência de upload, outliers destacados e gráfico de views
recentes. **Histórico local**: cada visita/verificação grava snapshot e alimenta o gráfico de evolução
daquele canal daqui em diante; exportável em JSON/CSV. **Competitors**: fixar canais; `chrome.alarms`
atualiza snapshots periodicamente e destaca variações e novos outliers.

Limite real, dito na própria tela: o retroativo do ViewStats vem de um banco proprietário gravando o
YouTube há anos. Não existe fonte pública equivalente. O que a Gumptube faz é instantâneo hoje
(views/dia, trajetória vs. canal, outlier) e **histórico de verdade a partir da primeira visita**.

### 4.7 Thumbnail Game

Dois vídeos do mesmo canal (thumbnails reais em alta), o usuário aponta qual tem mais views; revela
números, streak, recorde local e histórico de acertos. Fontes: canais acompanhados, canal pesquisado
ou canal do vídeo atual. Pares só são formados quando as duas views vêm da mesma fonte e precisão
(evita comparar "aproximado da busca" com "exato da página").

---

## 5. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **0** | Fonte + build esbuild + React produção | 0.3.1 reconstruído se comporta igual ao atual |
| **1** | Insights sem clique + storyboards + captura oportunista + snapshots | Abrir vídeo preenche Insights e as abas de frames sem clique e sem tocar no player |
| **2** | Thumbnail Search + Arsenal integrado + nova similaridade | Busca por palavra-chave com filtros, salvar em 1 clique, reordenar por referência visual |
| **3** | Relatório de estilo do nicho + Collections/Boards | Relatório gerado de thumbnails reais, com `n` e data; boards criam/movem/exportam |
| **4** | Studio + Channelytics + histórico local | Studio abre como página, pesquisa por handle/URL, snapshots persistem entre sessões |
| **5** | Thumbnail Game | Placar local persistente com views reais |
| **6** | Competitors com `chrome.alarms` + polimento + pacote 0.4.0 | Canais acompanhados atualizam sozinhos e destacam variações |

Fases 1 e 2 são as que mudam o dia a dia; 3–6 se apoiam na infra que elas entregam.

---

## 6. Critérios de aceite (v0.4.0)

- Abrir um vídeo preenche Insights e a análise de frames automaticamente, sem clique, **sem pausar, pular ou alterar a reprodução**.
- A análise por storyboards termina em segundos num vídeo típico e distingue na UI `storyboard` (aproximado), `frame real` (medido durante a reprodução) e `captura em alta` (exportação).
- Quando o vídeo não tem storyboard (live, indisponível), o painel diz isso e oferece a varredura manual — não fica girando.
- A busca de thumbnails retorna grade por palavra-chave com filtros e salva no Arsenal em 1 clique.
- O relatório de estilo do nicho é gerado localmente de thumbnails reais, distingue métrica medida de estimativa e declara tamanho de amostra e data.
- Collections permitem criar boards, mover itens entre boards e exportar um board completo.
- Insights mostra métricas reais do vídeo atual e o compara com os vídeos recentes do canal, com fonte identificada e tamanho de amostra visível.
- Studio abre como página da extensão, pesquisa canais por handle/URL e exibe Channelytics com outliers; snapshots persistem entre sessões.
- Thumbnail Game funciona com thumbnails/views reais e guarda placar local.
- Referências externas entram no Arsenal com metadados e aparecem na busca por similares.
- Nenhum módulo apresenta número fabricado: dado indisponível aparece como indisponível; dado aproximado aparece marcado como aproximado.
- Migração do Arsenal 0.3.x → v2 preserva 100% dos favoritos existentes.

---

## 7. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| YouTube muda `ytInitialData`/busca | Módulos param | Parser por fonte, com fixtures de teste; falha degradada e visível, nunca número inventado |
| Spec de storyboard muda ou some | Análise automática cai | Validação do spec + fallback para captura oportunista + varredura manual |
| Volume de requisições parece scraping | Bloqueio/CAPTCHA no navegador do usuário | Fila serializada, cache agressivo, alarms espaçados (≥ 6 h por canal), nada de polling em segundo plano fora dos canais fixados |
| Tile de 160×90 é pequeno para landmarks | Métrica facial imprecisa | Marcar como aproximado e promover com frames reais da reprodução |
| MediaPipe em lote trava a aba | UX ruim no relatório de nicho | Fila com concorrência 2–3, `requestIdleCallback`, progresso cancelável |
| `dataUrl` de frames incha o IndexedDB | Despejo do Arsenal | `unlimitedStorage`, guardar `Blob` em vez de `dataUrl` nos itens novos, limite configurável por board |
| Publicação na Chrome Web Store | Revisão pode questionar host permissions amplas | Escopo mínimo de hosts, justificativa por permissão; se necessário, distribuir como extensão descompactada/uso próprio |

---

## 8. Fora do escopo

Histórico retroativo de anos, dataset global de nicho, busca de thumbnails por imagem em toda a web,
alertas server-side 24/7 e recursos de IA generativa do ViewStats.

---

## 9. Perguntas em aberto

1. **O `src/` original existe em algum lugar?** Se sim, a Fase 0 encolhe muito. Se não, reconstruo a partir do bundle.
2. **Studio como aba dedicada ou popup?** O plano assume aba (`studio.html` no clique do ícone), que é o formato certo para grade de thumbnails e gráficos.
3. **Quanto o Arsenal pode ocupar?** Proponho teto configurável (padrão 2 GB) com aviso, em vez de crescimento ilimitado silencioso.
4. **Ordem das fases 3 a 6** — o plano coloca Boards antes de Studio; se o Channelytics for mais urgente no seu dia a dia, troco 3 e 4.
