# Gumptube — Plataforma de 3 soluções

> Documento mestre de produto. O detalhamento técnico (build, parsers, IndexedDB,
> storyboards, protocolo de mensagens) está em [PLANO-v0.4.md](PLANO-v0.4.md).
> Referências de mercado: [ViewStats](https://www.viewstats.com/) e [vidIQ](https://vidiq.com/pt/).
> Última revisão: 17/09/2026.

---

## 1. Posicionamento

A Gumptube deixa de ser "um painel de frames" e passa a ser **uma plataforma visual-estratégica
para YouTube**, com três soluções que se alimentam entre si:

| Pilar | O que é | Pergunta que responde |
|---|---|---|
| **Arsenal** | Biblioteca de thumbnails: referências, frames próprios, boards, busca visual | *"O que eu já vi funcionar, e o que se parece com isto?"* |
| **Screenshot** | Produção do ativo: extrair o melhor frame de qualquer vídeo | *"De onde sai a imagem da minha thumbnail?"* |
| **Frases** | Ganchos de thumbnail garimpados da legenda, com minutagem | *"O que escrever na thumb sem repetir o título?"* |
| **Dados** | Contexto estratégico: métricas, outliers, canais, histórico | *"Isso performou mesmo, ou só parece bonito?"* |

O que amarra os três é um ciclo único, e é isso que nenhuma das duas referências faz:

```
  Dados qualifica  →  Arsenal guarda e organiza  →  Screenshot produz o ativo
        ↑                                                       │
        └───────────  o ativo volta comparado ao nicho  ─────────┘
```

O ViewStats e o vidIQ **analisam** o que já existe. A Gumptube analisa **e produz** — o frame de
qualquer vídeo entra na mesma biblioteca onde moram as referências do nicho. Esse é o diferencial
real, não um detalhe de implementação.

Contexto de custo, que também é argumento: ViewStats Pro custa R$ 149,64/mês e o vidIQ cobra por
plano. A Gumptube roda **local, dentro do navegador, sem conta e sem mensalidade** — o teto disso
está declarado na seção 6.

---

## 2. Arquitetura de produto: duas portas de entrada

**Porta 1 — painel contextual** (dentro do YouTube, como hoje): três abas espelhando os pilares.
Aparece na página do vídeo e, novidade, também nas grades (home, busca, canal).

**Porta 2 — Gumptube Studio** (`studio.html`, aba própria da extensão): o aplicativo completo, com
navegação lateral no tema vermelho.

```
┌ GUMPTUBE STUDIO ──────────────────────────────────────────┐
│ ⌘K  busca global (thumbnails, canais, boards, notas)      │
├────────────────┬──────────────────────────────────────────┤
│  ARSENAL       │   Biblioteca · Boards · Busca de nicho    │
│                │   Similares · Relatório de estilo        │
│  SCREENSHOT    │   Capturas recentes · Fila por URL        │
│                │   Enquadramento 16:9 · Exportação        │
│  DADOS         │   Vídeo · Canal (Channelytics)           │
│                │   Outliers · Acompanhados · Histórico    │
└────────────────┴──────────────────────────────────────────┘
```

O painel contextual é para **capturar** no meio do trabalho (1 clique, sem sair do vídeo).
O Studio é para **trabalhar em cima do que foi capturado**. Nenhuma função existe só num dos dois
sem motivo: o que é contextual mora no painel, o que precisa de tela grande mora no Studio.

---

## 3. Pilar 1 — Arsenal *(prioridade do Ryan, e o coração da plataforma)*

### 3.1 Ingestão: salvar tem que ser trivial

Um Arsenal só vale se encher sozinho. Cinco caminhos, todos de 1 clique:

1. **Grade do YouTube**: hover em qualquer thumbnail (home, busca, canal, relacionados) mostra um ★. Clicou, salvou — com título, canal, views, idade e outlier já anexados.
2. **Painel do vídeo**: salvar a thumbnail oficial do vídeo aberto.
3. **Frame analisado**: o ★ que já existe hoje, agora com destino ("salvar em board…").
4. **Busca de nicho no Studio**: ★ em cada resultado da grade.
5. **Arrastar e soltar** arquivo local, ou colar URL de vídeo (captura a thumbnail oficial em alta).

Todo item nasce com **origem** (`meu frame` / `referência externa` / `upload`) e com os metadados
que existiam no momento — nada é preenchido depois com chute.

### 3.2 Organização

- **Boards (Collections)**: um item em vários boards, capa automática, contadores, nota por item e por board, reordenação por arrastar.
- **Tags**: manuais + automáticas (nicho pesquisado, canal, "tem rosto", "close", "texto denso", paleta dominante).
- **Filtros**: origem, board, tag, canal, faixa de views, outlier mínimo, atributo visual, cor dominante.

### 3.3 Busca — três formas, mesma caixa

| Forma | Como funciona |
|---|---|
| **Textual** | título, canal, tag, nota |
| **Visual** | escolhe um item (ou envia uma imagem) → reordena Arsenal **e** resultados do YouTube por similaridade |
| **Por atributo** | "com rosto grande", "alto contraste", "paleta quente", "pouco texto" — derivado da análise local |

A similaridade sobe de nível na v0.4: o aHash 8×8 de hoje ignora cor e estrutura. Vai para
**dHash 16×16 + histograma HSV + mapa de bordas**, com pesos ajustáveis (mais cor / mais composição).

### 3.4 Busca de thumbnails por nicho

Campo de busca que consulta a busca pública do YouTube e devolve **grade só de thumbnails grandes**,
com título/canal/views/idade e selo de outlier, filtros de duração/data/ordenação e paginação
contínua. É o equivalente honesto ao *Thumbnail Search* do ViewStats: mesma utilidade, feita sobre
resultados públicos em vez de dataset proprietário.

### 3.5 Relatório de estilo

Roda o pipeline local em lote sobre um conjunto (board inteiro ou top resultados de um nicho):
% com rosto e tamanho médio do rosto, close vs. cena aberta, paletas dominantes, brilho/contraste/
saturação, densidade **estimada** de texto — cruzados com views e outlier score. Compara sua
candidata ao padrão do conjunto, com delta por atributo.

Sempre declara `n`, termo e data. Correlação com views não é causalidade, e isso vai escrito.

### 3.6 Preview de packaging

Sua thumbnail + título renderizados como apareceriam na grade real do YouTube (desktop grande,
desktop pequeno, mobile, sidebar de relacionados), lado a lado com concorrentes do nicho.
É onde a decisão realmente acontece — e é barato de fazer, porque o CSS da grade já é conhecido.

---

## 4. Pilar 2 — Screenshot

Evolução do que a 0.3.1 já faz bem, com uma regra nova: **nunca tocar no player**.

- **Automático ao abrir o vídeo**, via storyboards (mosaicos públicos da barra de progresso) — abas Melhores/Câmera/Rosto/B-roll já preenchidas, sem clique e sem seek.
- **Refino sem seek**: enquanto o vídeo toca, `requestVideoFrameCallback` entrega frames em resolução real; os cards sobem de `storyboard` (aproximado) para `frame real` (medido).
- **Exportação em alta**: só aqui o player é posicionado, para capturar em resolução máxima.
- **Enquadramento 16:9** com crop e regra dos terços antes de exportar ou mandar para o Arsenal.
- **Varredura profunda manual** continua disponível para quem quiser ir além dos storyboards.

Fora do escopo: editor de imagem completo (camadas, texto, remoção de fundo). A Gumptube entrega o
frame certo, enquadrado; o acabamento é no Photoshop/Figma.

---

## 5. Pilar 3 — Dados

Aqui a inspiração é mais vidIQ (scorecard contextual) que ViewStats (dataset histórico).

- **Scorecard na página do vídeo**, carregado sozinho: views exatas, views/dia, likes (aproximados, marcados como tal), engajamento, idade e **outlier score** contra os uploads recentes do canal.
- **Badge de outlier na grade**: cada thumbnail na home/busca/canal ganha um selo discreto (`3,2×` a mediana do canal). Esse é o recurso que conecta os três pilares — o olho bate no selo, o ★ salva no Arsenal já qualificado.
- **Channelytics**: canal por handle/URL com inscritos, total de views, uploads recentes, média/mediana, frequência e outliers destacados.
- **Acompanhados (Competitors)**: canais fixados, atualizados por `chrome.alarms` enquanto o navegador estiver aberto, com destaque para variações e novos outliers.
- **Histórico local**: snapshot a cada visita/verificação, alimentando gráficos de evolução **a partir da primeira visita**. Exportável em JSON/CSV.

Regra de ouro, válida para os três pilares: **todo número carrega origem e precisão**
(`página` = exato, `busca` = aproximado, `RSS` = últimos 15, `estimativa` = calculado aqui).
Dado indisponível aparece como indisponível.

---

## 6. O que dá e o que não dá, comparado às referências

| Recurso | ViewStats / vidIQ | Gumptube |
|---|---|---|
| Thumbnail Search por nicho | ✅ dataset próprio | ✅ busca pública parseada |
| Collections / Boards | ✅ | ✅ local, com export |
| Análise de estilo de thumbnails | ✅ | ✅ local (MediaPipe + métricas de imagem) |
| Outlier score | ✅ global | ✅ **relativo ao canal** (mediana dos 15 recentes) |
| Scorecard no vídeo | ✅ (vidIQ) | ✅ |
| Competitors | ✅ 24/7 servidor | ⚠️ enquanto o navegador está aberto |
| Histórico de anos (subs/views) | ✅ banco proprietário | ❌ impossível sem servidor — só **daqui em diante** |
| Histórico de trocas de thumbnail | ✅ banco proprietário | ✅ retroativo via Internet Archive (cobertura parcial) |
| Busca de thumbnail por imagem em toda a web | ✅ | ⚠️ só reordena o que você já vê (Arsenal + busca atual) |
| Alertas em tempo real | ✅ | ⚠️ verificação periódica com o navegador aberto |
| Ideias/títulos com IA | ✅ | ❌ fora do escopo |
| **Extrair frames do vídeo como thumbnail** | ❌ | ✅ **exclusivo da Gumptube** |
| Custo | R$ 149,64/mês (ViewStats Pro) | Grátis, local |

As três limitações (histórico retroativo, dataset global, alertas 24/7) têm a mesma causa: elas
exigem um servidor gravando o YouTube continuamente. Não são preguiça de implementação — são o
preço de não ter backend. O plano assume isso e mostra na interface, em vez de fingir.

---

## 6b. Estado atual do código (0.4.0 nesta pasta)

Entregue e verificado:

- [x] **Fase 0** — projeto reescrito em JS puro (sem build, sem React): 1.877 linhas em `src/`, no lugar do bundle de 1,16 MB. O bundle antigo ficou em `legacy/`.
- [x] **Ícone da extensão** — 16/32/48/128 px (o `manifest.json` não declarava ícone nenhum, por isso o Chrome mostrava o quebra-cabeça genérico).
- [x] **Painel em qualquer vídeo, sem recarregar** — montagem reativa à navegação SPA do YouTube.
- [x] **Ativa em todo o YouTube** — dock flutuante fora do /watch e retomada automática da última solução (sem re-escolher a cada página).
- [x] **Channelytics na página do canal** — inscritos, mediana/média, ritmo de upload e uploads recentes com multiplicador.
- [x] **Seletor de solução** na abertura, com identidade visual própria por pilar (âmbar/vermelho/verde) e opção "abrir sempre nesta".
- [x] **Dados** — views exatas, publicação, views/dia, likes, engajamento, comentários, duração, inscritos, resolução, outlier vs. mediana do canal (RSS), gráfico dos uploads recentes e histórico local por visita.
- [x] **Arsenal** — biblioteca local, salvar a thumbnail oficial em 1 clique, filtro por origem, busca textual, tags, ordenação por semelhança visual (dHash + cor + composição), migração do Arsenal 0.3.x.
- [x] **Screenshot** — varredura densa em duas passadas (até ~360 frames), descarte de frames repetidos/rasgados, olhar para a câmera com régua dura (direção do olhar + pose + olhos), ordenação por score ou tempo, modal com setas e envio para o Arsenal em alta.
- [x] **Copiar em alta como ação principal** — na grade, no frame e no Arsenal; baixar virou alternativa.
- [x] **Histórico retroativo de thumbnails via Internet Archive** (CDX por digest) — datas de troca de qualquer vídeo, com pré-carregamento e cache; e sonda de teste A/B comparando endpoints 16:9 no mesmo instante.
- [x] **Histórico local de thumbnails** — versões observadas por vídeo, data de troca e indício de teste A/B por janelas sobrepostas.
- [x] **Montagem independente de layout** — MutationObserver, checagem de visibilidade real e migração automática para o dock no modo teatro; diagnóstico em `__gumptube.state`.
- [x] **Escolha da solução ao abrir**, com opção de memorizar e botão ⌂ para voltar.
- [x] **Quarta solução: Frases** — legendas públicas viram ganchos curtos com minutagem, pontuados por impacto e penalizados por repetir o título; moldes com lacuna à parte.
- [x] **Painel fora da home** — na tela inicial só as ações de grade; nas demais páginas o dock fica recolhido numa alça lateral.
- [x] **Legenda em três camadas** (json3 → srv3 → painel de transcrição da página), com trilha de tentativas quando tudo falha.
- [x] **Injeção nas abas já abertas** ao instalar/recarregar a extensão, e dock fixo quando o YouTube insiste em apagar o painel da coluna.
- [x] **Gerações do content script** — a carga nova assume e a órfã se aposenta, sem exigir recarregar a página.
- [x] **Varredura por intervalo (2/3/5/10 s) e por trecho**, preview guardado em resolução média e tamanho de galeria P/M/G.
- [x] **Frases ancoradas** — recorte só na fala inteira, no começo ou no fim dela, com exigência de número, negação, impacto ou fala completa.
- [x] **Botão de screenshot no player** (controles da direita) — captura instantânea do frame atual, funciona em tela cheia; clique copia, Shift baixa, Alt manda para o Arsenal.
- [x] **Qualidade de captura escolhida pelo usuário** (máxima/alta/média/leve) com estimativa de memória — a cópia sai na resolução que você mandou capturar.
- [x] **Transcrição por nó de texto** (inclui shadow roots abertos) e diagnóstico `__gumptube.transcricao()`.
- [x] **Transcrição do layout novo** — leitura estrutural do painel "Neste vídeo", onde horário e texto vêm em elementos separados.
- [x] **Altura controlada** — seta de recolher no cabeçalho, alça de redimensionar na base e teto padrão de 420 px, para dividir a lateral com o Gemini.
- [x] **Modo turbo de varredura** — reprodução acelerada com captura por quadro, sem seeks.
- [x] **UI achatada** — sem gradientes, paleta cinza neutra alinhada ao YouTube, cantos e sombras sóbrios, ajustes da varredura recolhidos atrás de ⚙.
- [x] **Altura fixa do painel** (como a transcrição do YouTube), ajustável pela alça.
- [x] **Captura manual** (tecla `S` / botão) entrando na galeria pela aba Manuais.
- [x] **Preview da thumbnail do vídeo atual** no Arsenal, antes de salvar.
- [x] **Duas versões do mesmo frame** — leve (640 px) na galeria, cheia (resolução do player) na cópia, no download e no Arsenal; mesma captura, sem recaptura e sem divergência de frame.

Ainda pendente da 0.4 (próximos passos):

- [x] ★ no hover das thumbnails da grade do YouTube (home, busca, canal) — com copiar e baixar em alta
- [ ] Boards / Collections
- [x] Busca de thumbnails por nicho — três ordenações por consulta, leitura local de cor/luz/contraste/rosto/texto e filtros por estilo
- [ ] Badge de outlier na grade
- [ ] Preview de packaging

## 7. Roadmap

A ordem abaixo **mudou** em relação ao plano anterior, que começava por Screenshot automático.
Como o foco declarado é visual-estratégico, o Arsenal vem primeiro e o Screenshot desce uma casa.

| Versão | Tema | Entrega |
|---|---|---|
| **0.4.0** | **Arsenal** | Fase 0 (fonte + build) · ingestão de 1 clique nas grades do YouTube · boards · nova similaridade visual · busca de nicho · Studio com o pilar Arsenal · Dados mínimos por item (views/idade/outlier) |
| **0.5.0** | **Dados** | Scorecard automático no vídeo · badge de outlier na grade · Channelytics · acompanhados com alarms · snapshots e histórico local |
| **0.6.0** | **Screenshot** | Análise automática por storyboards · refino sem seek · enquadramento 16:9 · exportação em alta revista |
| **0.7.0** | **Studio maduro** | Relatório de estilo · preview de packaging · export de boards · Thumbnail Game · busca global ⌘K |

A Fase 0 (reconstruir `src/` e o build, hoje ausentes desta pasta) continua bloqueante e abre a 0.4.

---

## 8. Critérios de aceite da 0.4 (Arsenal)

- Salvar qualquer thumbnail da grade do YouTube em 1 clique, com metadados anexados no momento do salvamento.
- Arsenal com boards funcionais: criar, mover item entre boards, um item em vários boards, reordenar, anotar.
- Busca textual, visual e por atributo sobre a biblioteca, na mesma caixa.
- Busca de nicho devolvendo grade de thumbnails reais, com filtros, paginação e ★ em cada resultado.
- Similaridade visual melhor que o aHash atual, com o hash antigo preservado (Arsenal existente não quebra).
- Migração do Arsenal 0.3.x → v2 sem perder nenhum favorito.
- Nenhum número fabricado: origem e precisão visíveis em cada métrica.

---

## 9. Perguntas em aberto

1. **Confirma a nova ordem** (Arsenal → Dados → Screenshot)? Se o scorecard/outlier na grade for mais urgente no dia a dia, troco 0.4 e 0.5.
2. **O `src/` original existe em algum lugar?** É o que define o tamanho da Fase 0.
3. **Preview de packaging entra na 0.4 ou fica na 0.7?** É barato e tem alto valor de decisão — dá para antecipar.
4. **Teto de armazenamento do Arsenal**: proponho 2 GB configurável com aviso, em vez de crescer em silêncio.
