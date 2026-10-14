// Gumptube — leitura de estilo visual de uma thumbnail: cor dominante, luz, contraste e
// densidade de grafismo. Tudo medido localmente, na imagem; nada vem de fora.
(() => {
  const GT = (window.GT = window.GT || {});

  const FAMILIAS = [
    { id: 'vermelho', label: 'Vermelho', de: 345, ate: 15 },
    { id: 'laranja', label: 'Laranja', de: 15, ate: 45 },
    { id: 'amarelo', label: 'Amarelo', de: 45, ate: 70 },
    { id: 'verde', label: 'Verde', de: 70, ate: 165 },
    { id: 'ciano', label: 'Ciano', de: 165, ate: 195 },
    { id: 'azul', label: 'Azul', de: 195, ate: 255 },
    { id: 'roxo', label: 'Roxo', de: 255, ate: 295 },
    { id: 'rosa', label: 'Rosa', de: 295, ate: 345 }
  ];

  function familiaDe(hue) {
    for (const familia of FAMILIAS) {
      if (familia.de > familia.ate) {
        if (hue >= familia.de || hue < familia.ate) return familia;
      } else if (hue >= familia.de && hue < familia.ate) return familia;
    }
    return FAMILIAS[0];
  }

  // Analisa a imagem inteira numa grade pequena: rápido o bastante para dezenas de thumbnails.
  GT.analyzeThumb = function analyzeThumb(source) {
    const W = 64, H = 36;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    const hist = new Array(FAMILIAS.length).fill(0);
    const luma = [];
    let somaLuz = 0, somaSat = 0, somaQuad = 0, coloridos = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      const sat = max <= 0 ? 0 : delta / max;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      luma.push(l);
      somaLuz += l;
      somaQuad += l * l;
      somaSat += sat;

      if (sat > 0.22 && max > 0.12) {
        let hue = 0;
        if (delta > 0.0001) {
          if (max === r) hue = ((g - b) / delta + 6) % 6;
          else if (max === g) hue = (b - r) / delta + 2;
          else hue = (r - g) / delta + 4;
          hue *= 60;
        }
        const familia = familiaDe(hue);
        hist[FAMILIAS.indexOf(familia)] += sat;
        coloridos++;
      }
    }

    const total = luma.length || 1;
    const brilho = somaLuz / total;
    const contraste = Math.sqrt(Math.max(0, somaQuad / total - brilho * brilho));
    const saturacao = somaSat / total;

    // Densidade de grafismo (aproximação de texto): medida numa resolução maior e nos TRÊS canais.
    // Só luminância perde texto branco sobre amarelo, por exemplo — a diferença ali é de cor.
    const DW = 160, DH = 90;
    const fino = document.createElement('canvas');
    fino.width = DW; fino.height = DH;
    const fctx = fino.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(source, 0, 0, DW, DH);
    const px = fctx.getImageData(0, 0, DW, DH).data;

    let bordas = 0, amostras = 0;
    const canal = (x, y, c) => px[(y * DW + x) * 4 + c];
    for (let y = 1; y < DH - 1; y++) {
      for (let x = 1; x < DW - 1; x++) {
        let maior = 0;
        for (let c = 0; c < 3; c++) {
          const gx = Math.abs(canal(x + 1, y, c) - canal(x - 1, y, c));
          const gy = Math.abs(canal(x, y + 1, c) - canal(x, y - 1, c));
          const g = Math.max(gx, gy);
          if (g > maior) maior = g;
        }
        if (maior > 48) bordas++;
        amostras++;
      }
    }
    const densidade = bordas / Math.max(1, amostras);

    let indice = 0;
    for (let i = 1; i < hist.length; i++) if (hist[i] > hist[indice]) indice = i;
    const proporcaoColorida = coloridos / total;
    const familia = proporcaoColorida < 0.12
      ? { id: brilho > 150 ? 'claro' : brilho < 70 ? 'escuro' : 'neutro', label: brilho > 150 ? 'Claro' : brilho < 70 ? 'Escuro' : 'Neutro' }
      : FAMILIAS[indice];

    return {
      cor: familia.id,
      corLabel: familia.label,
      brilho: Math.round(brilho),
      contraste: Math.round(contraste),
      saturacao: Number(saturacao.toFixed(3)),
      densidade: Number(densidade.toFixed(3)),
      claro: brilho >= 140,
      escuro: brilho <= 75,
      altoContraste: contraste >= 62,
      muitoTexto: densidade >= 0.14   // calibrado: arte só com título fica ~0,08; com bloco de texto passa de 0,2
    };
  };

  // famílias neutras entram na mesma lista de rótulos, para os filtros mostrarem nome próprio
  GT.STYLE_FAMILIES = [
    ...FAMILIAS,
    { id: 'claro', label: 'Claro' },
    { id: 'escuro', label: 'Escuro' },
    { id: 'neutro', label: 'Neutro' }
  ];
})();
