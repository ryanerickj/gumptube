# Gumptube 0.4.0

Plataforma visual-estratégica para YouTube, com **4 soluções** num painel só, dentro da própria
página do vídeo. Tudo roda local: nenhum dado sai do navegador, nenhuma conta, nenhuma mensalidade.

| Solução | Cor | O que faz |
|---|---|---|
| **Arsenal** | âmbar | Biblioteca de thumbnails e frames, tags, busca e ordenação por semelhança visual |
| **Screenshot** | vermelho | Varredura densa do vídeo: pontua nitidez, cena, rosto e **olhar para a câmera**, e copia o frame na resolução do player |
| **Frases** | violeta | Garimpa na legenda as falas curtas e fortes que complementam o título, com a minutagem |
| **Dados** | verde | Views exatas, views/dia, engajamento, outlier vs. canal e histórico local |

## Sempre ativa, sem clique para ligar

- O painel aparece na **coluna da direita** quando você está num vídeo, e como um dock recolhido
  na lateral (só uma alça, na altura do meio da tela) na busca e nas páginas de canal.
- **Na home ele não aparece**, para não atrapalhar a navegação — mas as ações de copiar thumbnail
  da grade continuam funcionando ali. Para abrir o painel na home mesmo assim, clique no ícone da
  Gumptube na barra do Chrome.
- Se a coluna da direita não existir ou estiver escondida (**modo teatro**, janela estreita, layout
  novo), o painel migra sozinho para o dock flutuante em até 2,5 s — ele não depende do layout.
- Ao abrir, você **escolhe a solução**. Marcando *"Abrir sempre nesta solução"*, ela passa a entrar
  direto; os ícones no topo trocam de solução em 1 clique e o **⌂** volta para a tela de escolha.
- **Ações na grade**: passe o mouse sobre qualquer thumbnail do YouTube — home, busca, canal,
  relacionados — e use os botões que aparecem no canto da imagem, sem abrir o vídeo:

  | Botão | O que faz |
  |---|---|
  | ⧉ | copia a thumbnail em alta para a área de transferência (cola direto no Photoshop/Figma) |
  | ★ | salva no Arsenal com título, canal e views da grade |
  | ⤓ | baixa o PNG em alta |

  A imagem vem da melhor resolução oficial disponível (`maxresdefault`, com queda para `sddefault`/`hqdefault`).
- Clicar no ícone da Gumptube na barra do Chrome abre/fecha o painel da aba atual.
- Na página de um canal, a solução **Dados** vira Channelytics: inscritos, mediana e média de views,
  ritmo de upload e os 15 uploads recentes com o multiplicador de cada um contra a mediana do canal.

## Frases para a thumbnail

A solução **Frases** lê a legenda pública do vídeo e garimpa os trechos que funcionam como gancho:

- **falas reais**, ditas exatamente pela pessoa, cada uma com a **minutagem** — clicar no tempo
  leva o player até o trecho para você conferir;
- **frases curtas** (2 a 7 palavras) e **ancoradas**: a Gumptube junta a legenda inteira num
  fluxo, corta onde a fala realmente termina (pontuação ou pausa) e só aceita três formas de
  recorte — a fala inteira, o começo dela ou o fim dela. Janela solta no meio da frase, que era
  o que produzia resultado arbitrário, não entra mais;
- cada frase precisa ter **motivo para existir**: carregar número, negação ou palavra de impacto,
  ou ser uma fala completa;
- **complementam o título sem repeti-lo**: as palavras que o título já ocupa aparecem listadas no
  topo e cada repetição derruba a pontuação da frase;
- etiquetas explicando por que a frase subiu: `fala inteira`, `número`, `negação`,
  `palavra de impacto`, `não repete o título`;
- filtros por `≤ 3 palavras`, `com número` e `não repete o título`, e um clique copia a frase
  (ou a frase com a minutagem).

No fim da lista há **moldes** — padrões com lacuna, como `O ERRO DE ___`, para você preencher.
Eles são marcados como moldes justamente porque não são falas do vídeo.

A legenda é lida em **três camadas**, porque o endpoint de legendas do YouTube às vezes responde
vazio: faixa oficial em `json3` → o mesmo em `srv3`/XML → **painel de transcrição da própria
página** (a Gumptube abre, rola até carregar tudo e fecha o painel sozinha). O leitor do painel
tenta três estratégias, sem depender do nome dos componentes: os campos próprios do layout antigo;
uma varredura por **nó de texto**, que acha todo texto igual a um horário (`3:13`) e sobe até a
linha — funciona mesmo quando o horário não está num elemento próprio e atravessa shadow roots
abertos; e, por fim, qualquer linha que comece com um horário, com ou sem espaço depois dele.
O selo no topo diz qual camada funcionou.

Se mesmo assim falhar, rode no console da página (contexto **Gumptube**):

```
__gumptube.transcricao()
```

O relatório diz se o painel foi encontrado, quantos horários existem no DOM, quantas linhas foram
reconhecidas e uma amostra da estrutura — é o que permite ajustar o leitor ao layout do seu YouTube.

Limite honesto: **sem legenda pública não há frases** — a Gumptube diz isso, mostra o que tentou
em cada camada e oferece "Tentar de novo", em vez de inventar texto. Quando a legenda é automática,
o YouTube erra palavras e pontuação; por isso cada frase traz o minuto para conferência.

## Buscar thumbnails por nicho, cor e estilo

Na solução **Arsenal**, a aba **Buscar no YouTube** traz thumbnails reais por palavra-chave:

- cada busca junta **três ordenações** da mesma consulta — relevância, mais vistas e mais recentes
  — porque é assim que se ganha volume sem um banco global;
- cada thumbnail é lida **aqui na sua máquina**: cor dominante, brilho, contraste, saturação,
  densidade de grafismo (aproximação de texto) e rosto/close pelo modelo local;
- filtros por **cor** (com a contagem de cada família), **com rosto**, **close**, **claro**,
  **escuro**, **alto contraste** e **muito texto**; ordenação pela busca ou pelas mais vistas;
- **★ Salvar** manda para a biblioteca em alta, já com as tags do nicho, da cor e de rosto;
  **⧉ Copiar** joga na área de transferência.

Limite honesto: **não existe fonte pública com todas as thumbnails do YouTube** — isso exigiria o
tipo de banco que só se mantém com servidores gravando a plataforma. O que a Gumptube faz é buscar
de verdade, em cima da busca pública, e ler o estilo de cada imagem localmente.

## Histórico de thumbnail e testes A/B

Na solução **Dados**, o bloco **Thumbnail** junta três fontes — e diz de onde veio cada coisa.

**1. Histórico retroativo, de qualquer vídeo (Internet Archive).** O YouTube não publica quando uma
arte mudou, mas o Internet Archive guarda as próprias imagens do `i.ytimg.com` ao longo dos anos.
A Gumptube consulta o índice CDX do arquivo, agrupa por *digest* (cada digest diferente é uma arte
diferente) e monta a linha do tempo com as datas de captura e as imagens de cada versão.

- Funciona **em vídeos que você nunca abriu** — é histórico de verdade, não observação local.
- A data é **quando o arquivo capturou** a arte nova, então a troca aconteceu em algum momento
  entre uma captura e a seguinte. A interface mostra os intervalos, não finge precisão.
- Cobertura é parcial: só vale para vídeos que o arquivo capturou.
- O arquivo é **lento** (5 a 25 s na primeira consulta). Por isso a Gumptube dispara a consulta
  assim que o vídeo abre, antes de você pedir, e guarda em cache por 6 h — na prática, quando você
  olha o painel a resposta já está lá.

**2. Teste A/B rodando agora.** A Gumptube pede a thumbnail por três endpoints 16:9 diferentes
(`maxresdefault`, `hq720` e o WebP), sem cache, e compara as imagens por semelhança visual. Duas
artes distintas no mesmo instante são indício forte de teste em andamento. Isso é instantâneo.
Quando não há diferença, a interface diz o que isso significa: **não prova ausência de teste**, já
que o YouTube pode fixar uma variante por sessão.

**3. Observação local.** Cada visita ainda registra a arte vista, alimentando o histórico próprio.

**Consultar qualquer vídeo**: no fim do bloco há um campo onde você cola um link (normal, curto ou
`/shorts/`) ou o ID e vê o histórico daquele vídeo sem sair de onde está. Nas páginas que não são
de vídeo, esse campo aparece sozinho na solução Dados.

## Se o painel não aparecer

Uma aba do YouTube **aberta antes de você instalar ou recarregar a extensão fica sem o código** —
é a causa clássica do "só funciona depois de recarregar o vídeo". A Gumptube se injeta sozinha
nessas abas ao ser instalada ou ao iniciar o Chrome. Como o script antigo continua na página
(órfão, sem acesso à extensão), cada carga do script marca uma **geração**: a nova assume e a
anterior se aposenta sozinha, tirando o painel velho da tela. Se ainda assim falhar:

1. Recarregue a extensão em `chrome://extensions` (↻) e depois a aba do YouTube.
2. No DevTools da página (F12), troque o contexto do console de `top` para **Gumptube** e rode:

   ```
   __gumptube.state      // modo, montado, visível, contexto, teatro, coluna lateral
   __gumptube.remontar() // força a remontagem
   ```

   O resultado diz se o painel está montado e por que escolheu o dock flutuante ou a coluna.

## Botão de screenshot no player

A Gumptube adiciona um botão próprio nos **controles do player, à direita** — primeiro da fila,
antes das legendas e do engrenagem. Ele captura o frame que está na tela **naquele instante**:
sem seek, sem espera, na resolução do player, e funciona também em **tela cheia e modo teatro**,
onde o painel lateral não existe.

| Ação | O que faz |
|---|---|
| clique | copia o frame para a área de transferência |
| **Shift** + clique | baixa o PNG |
| **Alt** + clique | salva no Arsenal |

A confirmação (`Copiado 1920×1080`) aparece dentro do próprio player, no canto inferior direito.

## Espaço na lateral

O painel divide a coluna da direita com o que mais estiver lá (recomendações, Gemini). Por isso:

- a **seta ⌃ no cabeçalho** recolhe o painel para a barra de título e devolve a lateral inteira —
  clicando de novo ele volta como estava, na mesma solução;
- a **alça na base** define a altura: arraste para cima ou para baixo, duplo clique volta ao padrão
  (420 px). A altura fica guardada entre sessões;
- a altura é **fixa**, como o painel de transcrição do YouTube: o painel ocupa sempre o mesmo
  espaço e o conteúdo rola por dentro, sem empurrar nem encolher o resto da coluna.

## Copiar em vez de baixar

A ação principal em todo lugar é **copiar a imagem em alta** para a área de transferência —
cola direto no Photoshop, Figma ou Canva. Baixar continua disponível, como alternativa.

- Grade do YouTube: botão **⧉** no hover da thumbnail (vermelho, primeiro da barra).
- Frame analisado: botão **⧉** no card e **⧉ Copiar em alta** no visualizador — a imagem é
  recapturada na resolução do player na hora da cópia.
- Arsenal: botão **⧉ Copiar** em cada item.

Frames salvos no Arsenal guardam a versão em alta (resolução do player), justamente para que a
cópia saia em qualidade máxima depois.

## Baixar os frames em massa

No rodapé da galeria há um botão que baixa **tudo de uma vez, num único `.zip`**:

- sem seleção: **⤓ Baixar todos (N)** leva todos os frames da aba aberta;
- com frames marcados: **⤓ Baixar N selecionados**;
- os arquivos saem numerados e em ordem de tempo (`001-2m08s.jpg`, `002-3m14s.jpg`…), na mesma
  resolução escolhida em Qualidade;
- a barra de progresso acompanha o empacotamento e o status informa o tamanho final.

O ZIP é montado no próprio navegador, sem compressão (os JPEGs já são comprimidos) e sem biblioteca
externa. Um download único evita o bloqueio do Chrome a downloads múltiplos em sequência.

## Varredura de frames

- **Modo**: `Preciso` pula de ponto em ponto (não mexe na reprodução) ou `Turbo`, que **reproduz o
  vídeo acelerado (até 16×, mudo) e captura os frames conforme passam, sem nenhum seek**. Em
  varredura densa o turbo muda a ordem de grandeza: o custo passa a ser a duração do trecho
  dividida pela velocidade, não o número de frames. Ao terminar, o player volta ao ponto, à
  velocidade e ao volume originais.
- **Intervalo**: você escolhe direto — `2 s`, `3 s`, `5 s` (padrão) ou `10 s` entre frames.
  A linha abaixo dos botões estima quantos frames e quanto tempo a varredura vai levar.
- **Trecho**: `Vídeo todo`, `5 min do ponto atual` ou `15 min do ponto atual` — num vídeo de uma
  hora, varrer a cada 2 s só o trecho que interessa é muito mais rápido que varrer tudo.
  Há um teto de 1.600 frames por varredura; se a conta passar disso, o intervalo é ajustado e a
  interface avisa.
- **Duas passadas**: primeiro a captura e a qualidade de imagem (rápido, sem modelo facial);
  depois o modelo facial roda só nos candidatos (representantes de cena + frames mais nítidos,
  teto de 180). É isso que permite varrer muito mais frames sem multiplicar o tempo.
- **Nada de frame rasgado**: a captura espera o frame ser de fato apresentado
  (`requestVideoFrameCallback`). Um frame idêntico ao anterior só é descartado quando o player
  não apresentou nada de novo — cena parada continua valendo como frame.
- **Qualidade** (padrão `Máxima`): define o tamanho do que você **copia e baixa** — `Máxima` usa a
  resolução do player, e há `Alta` (1600 px), `Média` (1024 px) e `Leve` (640 px) para varreduras
  muito densas. A estimativa mostra o tamanho real dos frames e **quanta memória** a varredura vai
  ocupar, ficando laranja acima de 700 MB.
- **Duas versões do mesmo frame, nenhuma recaptura**: cada frame capturado gera uma versão **cheia**
  (a que você copia, baixa e manda para o Arsenal) e uma **leve de 640 px** (a que a galeria
  desenha, para rolar rápido com centenas de cards). O visualizador mostra a versão cheia. Como as
  duas saem da **mesma captura**, a imagem é sempre o mesmo frame — só muda o tamanho. Nada é
  recapturado depois, porque um novo seek no mesmo timestamp não devolve exatamente o mesmo frame. Nada é recapturado depois — um novo seek no
  mesmo timestamp não devolve exatamente o mesmo frame, e era isso que fazia o preview em alta
  mostrar uma imagem diferente da miniatura. As imagens ficam em `blob`, não em `dataURL`, o que
  corta pela metade a memória usada.
- **Tamanho da galeria**: os botões `P` / `M` / `G` mudam a grade entre 3, 2 e 1 coluna, para
  você avaliar os frames antes de clicar.
- **Olhar para a câmera** é uma régua dura, não um chute pela pose: combina direção do olhar
  (blendshapes do MediaPipe), ângulo horizontal da cabeça, inclinação, abertura dos olhos,
  rotação e tamanho do rosto. Um rosto frontal com os olhos desviados **não** entra na aba Câmera.
- **Ordenação** por melhor pontuação ou por tempo, em qualquer aba.

## Instalar / atualizar no Chrome

1. Abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Primeira vez: **Carregar sem compactação** e escolha esta pasta.
   Já instalada: clique em **Atualizar** (↻) no card da Gumptube.
4. Abra qualquer vídeo do YouTube. O painel aparece sozinho — sem recarregar a página.

> O Arsenal da 0.3.x é migrado automaticamente na primeira vez que você abrir a solução Arsenal.
> A base antiga não é apagada.

## Estrutura

```
manifest.json         MV3: content scripts, service worker, ícones, permissões
background.js         Toda a rede (página do vídeo, RSS do canal, thumbnails) + cache + downloads
content.css           Tema do painel, com uma cor de acento por solução
icons/                Ícones 16/32/48/128 da extensão
src/core.js           Helpers, formatação pt-BR, identidade das 3 soluções, ponte com o service worker
src/db.js             IndexedDB "gumptube" + migração do Arsenal antigo + assinatura/semelhança visual
src/analysis.js       Motor de frames: qualidade, rosto (MediaPipe), hash, cenas, ranking
src/data.js           Leitura de dados públicos do vídeo/canal, com fonte e precisão declaradas
src/captions.js       Leitura da legenda em camadas (json3 → srv3 → painel de transcrição)
src/style.js          Leitura de estilo da thumbnail: cor, luz, contraste, densidade de grafismo
src/zip.js            Empacotador ZIP próprio, para baixar os frames em massa
src/thumb-search.js   Busca de thumbnails por nicho, com filtros de cor e estilo
src/player-button.js  Botão de screenshot nos controles do player
src/phrases.js        Garimpo de frases: agrupa a legenda em falas, pontua e filtra repetição do título
src/view-*.js         Uma tela por solução + o seletor inicial
src/grid-actions.js   Ações de copiar/salvar/baixar sobre as thumbnails da grade
src/panel.js          Casca do painel: cabeçalho, status, troca de solução, modais
src/content.js        Montagem e roteamento dentro da SPA do YouTube
analyzer.html/js      Iframe isolado que roda o MediaPipe FaceLandmarker
vendor/ wasm/ models/ MediaPipe (não alterados)
legacy/               Bundle React da 0.3.1, guardado para consulta
```

Sem etapa de build: os arquivos em `src/` são carregados direto pelo `manifest.json`.

## Regra de honestidade

Todo número exibido carrega **fonte** e **precisão**. Views vêm exatas da página do vídeo; likes e
inscritos são aproximados porque o YouTube só publica o valor arredondado; o outlier é relativo à
mediana dos 15 uploads recentes do feed RSS do canal (que inclui Shorts). Dado indisponível aparece
escrito como *indisponível* — nunca estimado em silêncio.

Planejamento: [PLANO-PLATAFORMA.md](PLANO-PLATAFORMA.md) (produto) e [PLANO-v0.4.md](PLANO-v0.4.md) (técnico).
