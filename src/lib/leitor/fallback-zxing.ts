// C2.5 — o fallback REAL da zxing-wasm (decisão D10: o iPhone ler).
//
// Este é o ÚNICO arquivo do app que cita "zxing-wasm" por especificador, e
// ele só é alcançado pelo import DINÂMICO do decodificador
// (`criarDecodificador`, que carrega o fallback apenas quando o navegador
// não tem `BarcodeDetector` nativo — Safari iOS). É isso que mantém o WASM
// (~931 kB) FORA do chunk de boot e do chunk do PDV: nenhum import
// estático aponta para cá — a prova mora no teste
// zxing-wasm-so-quando-falta-o-nativo, que varre o src atrás de
// especificadores estáticos e não acha nenhum.
//
// Entrada `zxing-wasm/reader` (não a raiz): é a build só-leitora, ~566 kB
// menor que a full — escrever código de barras nunca foi requisito do
// balcão.
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
// O export de ASSET do próprio pacote (export map "./reader/
// zxing_reader.wasm"), com o sufixo `?url` que o vite exige para binário:
// emite o arquivo em dist/assets e aqui fica só a URL. Sem isto, o padrão
// da lib é baixar o WASM do CDN jsDelivr — e o balcão precisa ler OFFLINE
// (o globPatterns do workbox já precacheia *.wasm, e o app instalado não
// depende de CDN nenhum).
import urlDoWasm from "zxing-wasm/reader/zxing_reader.wasm?url";

import type { ModuloZxingReader } from "./decodificador";

// Só REGISTRA os overrides (`fireImmediately` é false por padrão): o módulo
// Emscripten — e o download do WASM — só acontecem na primeira leitura de
// verdade, não no carregamento deste chunk.
prepareZXingModule({ overrides: { locateFile: () => urlDoWasm } });

// A assinatura real aceita MAIS do que a nossa interface estreita pede
// (opções extras do `ReaderOptions`; resultados com campos além de
// `text`/`format`). Dois ajustes de conformidade, nenhum deles muda valor
// em runtime: (1) `formats` na lib é array MUTÁVEL de literais — o espalhar
// cria a cópia mutável sem tocar no array de quem chamou; (2) o cast final
// existe porque o nosso contrato tipa os nomes como `string` genérica,
// enquanto a lib os estreita em união de literais — os valores vêm do mapa
// fechado `NOSSO_PARA_ZXING` do decodificador, todos nomes canônicos que a
// lib aceita (README 3.1.4).
export const moduloZxing: ModuloZxingReader = {
  readBarcodes: (fonte, opcoes) =>
    readBarcodes(fonte, {
      ...opcoes,
      formats: opcoes?.formats ? [...opcoes.formats] : undefined,
    } as Parameters<typeof readBarcodes>[1]),
};

export default moduloZxing;
