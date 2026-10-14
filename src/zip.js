// Gumptube — empacotador ZIP mínimo (método "store", sem compressão).
// Os frames já são JPEG: comprimir de novo custaria tempo e não reduziria quase nada.
// Escrito à mão para não depender de biblioteca externa.
(() => {
  const GT = (window.GT = window.GT || {});

  const CRC_TABLE = (() => {
    const tabela = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[i] = c >>> 0;
    }
    return tabela;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // data/hora no formato MS-DOS usado pelo ZIP
  function dosDateTime(date = new Date()) {
    const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
    const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
    return { time, day };
  }

  const encoder = new TextEncoder();

  function bloco(tamanho) {
    const buffer = new ArrayBuffer(tamanho);
    return { view: new DataView(buffer), bytes: new Uint8Array(buffer) };
  }

  /**
   * entradas: [{ nome, blob }]  ·  aoProgredir: (feitos, total) => void
   * Devolve um Blob com o arquivo .zip.
   */
  GT.makeZip = async function makeZip(entradas, aoProgredir) {
    const partes = [];
    const central = [];
    let offset = 0;
    const { time, day } = dosDateTime();
    const usados = new Set();

    for (let i = 0; i < entradas.length; i++) {
      const entrada = entradas[i];
      const dados = new Uint8Array(await entrada.blob.arrayBuffer());
      const crc = crc32(dados);

      // nomes repetidos quebram o zip em alguns extratores
      let nome = entrada.nome;
      let contador = 2;
      while (usados.has(nome)) {
        const ponto = entrada.nome.lastIndexOf('.');
        nome = ponto > 0
          ? `${entrada.nome.slice(0, ponto)}-${contador}${entrada.nome.slice(ponto)}`
          : `${entrada.nome}-${contador}`;
        contador++;
      }
      usados.add(nome);
      const nomeBytes = encoder.encode(nome);

      const local = bloco(30 + nomeBytes.length);
      local.view.setUint32(0, 0x04034b50, true);   // assinatura
      local.view.setUint16(4, 20, true);           // versão necessária
      local.view.setUint16(6, 0x0800, true);       // bit 11: nome em UTF-8
      local.view.setUint16(8, 0, true);            // método 0 = store
      local.view.setUint16(10, time, true);
      local.view.setUint16(12, day, true);
      local.view.setUint32(14, crc, true);
      local.view.setUint32(18, dados.length, true);
      local.view.setUint32(22, dados.length, true);
      local.view.setUint16(26, nomeBytes.length, true);
      local.view.setUint16(28, 0, true);
      local.bytes.set(nomeBytes, 30);

      partes.push(local.bytes, dados);

      const cabecalho = bloco(46 + nomeBytes.length);
      cabecalho.view.setUint32(0, 0x02014b50, true);
      cabecalho.view.setUint16(4, 20, true);
      cabecalho.view.setUint16(6, 20, true);
      cabecalho.view.setUint16(8, 0x0800, true);
      cabecalho.view.setUint16(10, 0, true);
      cabecalho.view.setUint16(12, time, true);
      cabecalho.view.setUint16(14, day, true);
      cabecalho.view.setUint32(16, crc, true);
      cabecalho.view.setUint32(20, dados.length, true);
      cabecalho.view.setUint32(24, dados.length, true);
      cabecalho.view.setUint16(28, nomeBytes.length, true);
      cabecalho.view.setUint16(30, 0, true);
      cabecalho.view.setUint16(32, 0, true);
      cabecalho.view.setUint16(34, 0, true);
      cabecalho.view.setUint16(36, 0, true);
      cabecalho.view.setUint32(38, 0, true);
      cabecalho.view.setUint32(42, offset, true);
      cabecalho.bytes.set(nomeBytes, 46);
      central.push(cabecalho.bytes);

      offset += local.bytes.length + dados.length;
      aoProgredir?.(i + 1, entradas.length);
      if (i % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));   // não trava a aba
    }

    const tamanhoCentral = central.reduce((total, parte) => total + parte.length, 0);
    const fim = bloco(22);
    fim.view.setUint32(0, 0x06054b50, true);
    fim.view.setUint16(4, 0, true);
    fim.view.setUint16(6, 0, true);
    fim.view.setUint16(8, entradas.length, true);
    fim.view.setUint16(10, entradas.length, true);
    fim.view.setUint32(12, tamanhoCentral, true);
    fim.view.setUint32(16, offset, true);
    fim.view.setUint16(20, 0, true);

    return new Blob([...partes, ...central, fim.bytes], { type: 'application/zip' });
  };
})();
