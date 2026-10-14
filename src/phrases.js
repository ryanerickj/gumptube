// Gumptube — garimpo de frases para thumbnail a partir do que foi dito no vídeo.
// Nada é inventado: cada frase é um trecho real da legenda, com o minuto em que foi dita.
(() => {
  const GT = (window.GT = window.GT || {});

  const STOPWORDS = new Set(('a o e é de da do das dos em no na nos nas um uma uns umas para pra por com sem sobre que se ao aos à às ou mas como mais menos muito muita muitos muitas eu você vocês ele ela eles elas nós me te lhe meu minha seu sua isso isto aquilo aqui ali lá já ainda também só até quando onde qual quais quem porque pois então tipo assim né cara tá ta vai vou foi ser são está estão tem têm ter fazer faz fez seu sua').split(' '));

  const MULETAS = new Set('né tipo assim então cara tá ta aí ah eh hum ó olha beleza sabe entendeu certo poxa nossa gente galera pessoal'.split(' '));

  const IMPACTO = new Set(('segredo segredos erro erros verdade mentira ninguém nunca sempre nada tudo jamais proibido escondido descobri descobrimos mudou mudei perdi ganhei quebrei falência milhão milhões bilhão bilhões grana dinheiro lucro prejuízo risco medo culpa vergonha fracasso sucesso rápido simples difícil fácil caro barato grátis primeiro última último melhor pior maior menor único regra regras jogo virada choque real verdadeiro provei prova teste testei funciona funcionou falhou parei comecei mudança chave truque atalho armadilha cilada absurdo insano surreal brutal chocante inacreditável impossível dobrei tripliquei zero sozinho ignorado subestimado copiado copiei arrisquei apostei desisti recomecei aprendi ensina ensinou doeu doí sangue sonho pesadelo').split(' '));

  const NEGACAO = new Set('não nunca ninguém nada jamais nem sem'.split(' '));

  const normalize = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s%$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const significantWords = (text) => normalize(text).split(' ').filter((word) => word && !STOPWORDS.has(word));

  /* ------------------------------------------------- falas contínuas */

  // Junta tudo num fluxo e corta onde a fala realmente termina: pontuação ou pausa.
  // As quebras de linha da legenda são arbitrárias (cabem na tela), então não servem de corte.
  function sentences(words, { maxGap = 0.8, maxWords = 26 } = {}) {
    const out = [];
    let current = null;
    let lastTime = null;

    for (const word of words) {
      const gap = lastTime === null ? 0 : word.t - lastTime;
      if (!current || gap > maxGap || current.words.length >= maxWords) {
        current = { words: [] };
        out.push(current);
      }
      current.words.push(word);
      lastTime = word.t;
      if (/[.!?…]$/.test(word.text)) current = null;
    }
    return out.filter((item) => item.words.length).map((item) => ({ start: item.words[0].t, words: item.words }));
  }

  // compatibilidade com quem ainda chama groupLines
  const groupLines = sentences;

  /* --------------------------------------------------- pontuação */

  // Frase de thumbnail não pode começar nem terminar no meio de uma ideia.
  // Artigos podem abrir uma frase de thumbnail ("O RESULTADO FOI ABSURDO"); conjunções e
  // preposições, não — essas indicam que o recorte começou no meio da ideia.
  const NAO_INICIAR = new Set(('que e ou mas se de da do das dos em no na nos nas com sem por pelo pela para pra ao aos até como quando porque entao então ai aí num numa nosso nossa pro pros mais menos já ainda também só').split(' '));
  // Terminar em pronome ou possessivo também é corte: "alfredo justos eu" pede a continuação.
  const NAO_TERMINAR = new Set([...NAO_INICIAR, ...('eu voce você ele ela nos nós eles elas me te lhe se meu minha seu sua teu tua dele dela deles delas esse essa este esta isso isto aquele aquela muito').split(' ')]);
  const NUMERAIS = new Set(('um dois duas tres três quatro cinco seis sete oito nove dez onze doze treze quatorze catorze quinze dezesseis dezessete dezoito dezenove vinte trinta quarenta cinquenta sessenta setenta oitenta noventa cem cento duzentos trezentos quatrocentos quinhentos seiscentos setecentos oitocentos novecentos mil milhao milhão milhoes milhões bilhao bilhão').split(' '));

  function scorePhrase(words, titleWords, boundary = {}) {
    const text = words.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim();
    const clean = text.replace(/^[,;:\-–—.]+/, '').replace(/[,;:\-–—.]+$/, '').trim();
    const tokens = normalize(clean).split(' ').filter(Boolean);
    const count = tokens.length;
    const reasons = [];

    if (count < 2 || count > 7) return null;
    if (clean.length > 38 || clean.length < 6) return null;

    const first = tokens[0], last = tokens[count - 1];
    if (NAO_INICIAR.has(first) || NAO_TERMINAR.has(last)) return null;
    if (NUMERAIS.has(last) || /^\d+$/.test(last)) return null;

    let score = 30;
    score += count === 3 || count === 4 ? 20 : count === 2 || count === 5 ? 14 : 4;
    score += clean.length <= 18 ? 10 : clean.length <= 26 ? 6 : 0;

    const completa = !!(boundary.atStart && boundary.atEnd);
    if (boundary.atStart) score += 14;
    if (boundary.atEnd) score += 14;
    if (completa) { score += 12; reasons.push('fala inteira'); }

    const hasNumber = /\d/.test(clean) || /%|r\$/i.test(clean) || tokens.some((token) => NUMERAIS.has(token));
    if (hasNumber) { score += 16; reasons.push('número'); }

    let impacto = 0;
    let negacao = false;
    for (const token of tokens) {
      if (IMPACTO.has(token)) impacto++;
      if (NEGACAO.has(token)) { negacao = true; score += 9; }
      if (MULETAS.has(token)) score -= 16;
    }
    if (negacao) reasons.push('negação');
    if (impacto) { score += Math.min(26, impacto * 13); reasons.push('palavra de impacto'); }

    // Precisa ter um motivo para existir: ou carrega peso, ou é uma fala completa.
    // Sem isso, o que sai são pedaços arbitrários de frase.
    if (!hasNumber && !impacto && !negacao && !completa) return null;

    const repeated = tokens.filter((token) => !STOPWORDS.has(token) && titleWords.has(token));
    const meaningful = tokens.filter((token) => !STOPWORDS.has(token)).length || 1;
    const overlap = repeated.length / meaningful;
    score -= Math.round(overlap * 55);
    if (overlap === 0) reasons.push('não repete o título');
    else if (overlap >= 0.5) reasons.push('repete o título');

    return { text: clean, tokens, score: Math.max(0, Math.round(score)), reasons, hasNumber, overlap, words: count, completa };
  }

  // Só recortes ancorados: a fala inteira, um começo de fala ou um fim de fala.
  // Janela solta no meio da frase é o que produzia resultado arbitrário.
  function bestWindows(line, titleWords) {
    const out = [];
    const total = line.words.length;
    const push = (slice, boundary) => {
      const scored = scorePhrase(slice, titleWords, boundary);
      if (scored) out.push({ ...scored, time: slice[0].t, endTime: slice[slice.length - 1].t });
    };

    if (total <= 7) push(line.words, { atStart: true, atEnd: true });
    for (let size = 2; size <= Math.min(7, total - 1); size++) {
      push(line.words.slice(0, size), { atStart: true, atEnd: false });
      push(line.words.slice(total - size), { atStart: false, atEnd: true });
    }
    return out;
  }

  function dedupe(candidates) {
    const seen = new Map();
    for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
      const key = normalize(candidate.text);
      let duplicate = false;
      for (const existing of seen.keys()) {
        if (existing.includes(key) || key.includes(existing)) { duplicate = true; break; }
      }
      if (!duplicate) seen.set(key, candidate);
    }
    return [...seen.values()];
  }

  function extract(words, title, { limit = 60 } = {}) {
    return extractFromLines(sentences(words), title, { limit, alreadySentences: true });
  }

  // As linhas da legenda são quebras de tela, não de fala: juntamos tudo e cortamos de novo.
  function extractFromLines(lines, title, { limit = 60, alreadySentences = false } = {}) {
    const titleWords = new Set(significantWords(title));
    const source = alreadySentences ? lines : sentences(lines.flatMap((line) => line.words));
    const candidates = [];
    for (const line of source) candidates.push(...bestWindows(line, titleWords));
    return dedupe(candidates).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /* ------------------------------------------- moldes a partir do título */

  // Moldes são padrões com lacuna — quem preenche é você. A Gumptube não inventa afirmação.
  const MOLDES = [
    'O ERRO DE ___', 'NINGUÉM FALA DISSO', '___ EM 30 DIAS', 'ANTES vs DEPOIS',
    'O QUE MUDOU', 'CUSTOU R$ ___', '___ SEM ___', 'A PARTE QUE DOEU',
    'TENTEI ___ VEZES', 'FUNCIONA MESMO?', 'O LADO RUIM', 'FIZ ERRADO'
  ];

  function templates(title) {
    const used = new Set(significantWords(title));
    return MOLDES.filter((molde) => !significantWords(molde).some((word) => used.has(word)));
  }

  GT.phrases = { normalize, significantWords, sentences, groupLines, scorePhrase, bestWindows, dedupe, extract, extractFromLines, templates };
})();
