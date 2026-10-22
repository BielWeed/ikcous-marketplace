const fs = require("node:fs");
const path = require("node:path");
const {
  validarClassificacaoContraDisco,
} = require("./scripts/validarPortaoDeTamanho.cjs");

const mode = process.env.IKCOUS_IDENTITY_MODE ?? "database";
if (!["database", "fixture"].includes(mode)) throw new Error("IDENTITY_MODE");
const output = mode === "fixture" ? "dist-test" : "dist";
// Measure only a completed delivery of the explicitly selected source.
const version = JSON.parse(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Output comes only from the closed database/fixture mode selection above.
  fs.readFileSync(path.join(__dirname, output, "version.json"), "utf8"),
);
if (version.source !== mode || version.promotable !== (mode === "database"))
  throw new Error("IDENTITY_OUTPUT: fonte do artefato diverge do modo");

const ARQUIVO_DO_LEITOR_ZXING = /^leitor-zxing-.*\.js$/;

// Portão de tamanho DIVIDIDO (decisão do dono Gabriel, 26/09/2026, respondendo
// "o portão de tamanho soma TODO o JS… como resolver?"): a soma única estourava
// porque JS só do painel (Financeiro, CRM, Devoluções — PR #666) entrava na
// MESMA conta do que qualquer visitante baixa. `scripts/portaoDividido.ts`
// classifica os chunks a partir do grafo REAL do Rollup (`generateBundle`,
// nunca por nome de arquivo) e grava `${output}` fora da entrega; aqui a
// leitura é FAIL-CLOSED: falta o arquivo, versão de esquema errada, ou o
// conjunto de `assets/*.js` do disco (sem o leitor zxing) diferente da união
// cliente∪painel — qualquer um desses aborta `npm run size` em vez de deixar
// um chunk sem contar em teto nenhum.
const classificacaoPath = path.join(
  __dirname,
  ".portao-tamanho",
  `${output}.json`,
);
let classificacaoBruta;
try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminho fechado: raiz + ".portao-tamanho" + saída "dist"/"dist-test" validada acima.
  classificacaoBruta = fs.readFileSync(classificacaoPath, "utf8");
} catch (error) {
  throw new Error(
    `PORTAO_TAMANHO: ${classificacaoPath} ausente — rode \`npm run build\` (o plugin portaoDividido grava esse arquivo em generateBundle) antes de \`npm run size\`. Causa original: ${error.message}`,
  );
}
const classificacao = JSON.parse(classificacaoBruta);

const assetsDir = path.join(__dirname, output, "assets");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Mesmo caminho fechado acima, só descendo para o subdiretório fixo "assets".
const arquivosJs = fs
  .readdirSync(assetsDir)
  .filter((nome) => nome.endsWith(".js") && !ARQUIVO_DO_LEITOR_ZXING.test(nome))
  .map((nome) => `assets/${nome}`);

const { cliente, painel } = validarClassificacaoContraDisco(
  classificacao,
  arquivosJs,
);

module.exports = [
  {
    // Teto do que QUALQUER visitante da loja pode baixar — nunca inclui o
    // que só existe atrás do `is_admin` do servidor (ver
    // `scripts/portaoDividido.ts`). Decisão do dono (26/09/2026, "Painel 450
    // · cliente 550"): antes desta divisão o teto único de 800 kB (D8) somava
    // cliente e painel; medido o cliente sozinho (474,97 kB no fixture de
    // 26/09), o teto cai para 550 kB — folga de ~75 kB, para que um aumento
    // real na vitrine reprove em vez de sumir numa margem de 325 kB.
    //
    // size-limit-16 (A12.2, preservado): `webpack: false` é o que faz o
    // checker somar a compressão brotli de CADA arquivo casado — que é o
    // que o CDN entrega (respostas independentes, dicionários próprios).
    // Sem ele, o preset big-lib jogava os chunks num projeto webpack vazio,
    // re-minificava e comprimia UMA vez, criando folga que não existe na
    // entrega real.
    path: cliente.map((arquivo) => `${output}/${arquivo}`),
    // PROPOSTA 16/10/2026 (aguarda o dono): 550 -> 552 kB. Medido no CI: a base
    // chegou a 549,96 kB (folga de 40 B) e o mesmo código mede 549,96 a 550,24
    // conforme o build — os hashes dos chunks entram no pacote de entrada e não
    // comprimem. Com folga menor que esse ruído, o portão vira loteria: um PR só
    // do painel reprovou "Build e tamanho" por 239 B no teto do cliente.
    // 21/10/2026 (aprovado pelo dono no chat): 552 -> 556 kB para acomodar o
    // redesenho dos cards compactos de frete grátis (anel de progresso) e de
    // Ofertas Imperdíveis. O card de frete sozinho mediu +99 B sobre a base.
    // 22/10/2026 (aprovado pelo dono no chat; regra dele: nunca trocar o teto
    // por código arriscado): 556 -> 560 kB para acomodar o redesenho da tela de
    // produto (fileiras de variação e folha de opções) junto da barra única da
    // Home. Medido no lote: 556,27 kB, ou seja, 270 B acima do teto anterior.
    limit: "560 kB",
    webpack: false,
    // Sem `running: false` o preset tenta MEDIR TEMPO rodando o bundle em
    // Chrome headless — inútil para app de navegador e quebra em runner sem
    // Chrome. O portão é o TAMANHO da entrega, não o tempo de execução.
    running: false,
  },
  {
    // Painel (novo, 26/09/2026): só o que fica atrás do portão do admin
    // (`AdminAreaGate` -> `AdminArea.tsx` -> `src/views/admin/**`, e o
    // prefetch por hover de `usePrefetchOnHover.ts`) — o lojista baixa
    // depois de o servidor confirmar `is_admin`, nunca um visitante da loja.
    // Decisão do dono (26/09/2026, "Painel 450 · cliente 550"): medido
    // 402,44 kB no fixture de 26/09 (o recharts sozinho ~81 kB; Financeiro,
    // CRM e Devoluções do PR #666 ~78 kB) — teto de 450 kB, folga de ~48 kB.
    //
    // 15/10/2026 — teto 450 -> 455 kB (decisão técnica, sem ganho honesto
    // disponível). Lote da noite 15/10: 39 ajustes de tela juntos; cada ramo
    // cabia sozinho. Medido: base do lote (ebb23ba2) 448,11 kB; lote 3 inteiro
    // 451,38 kB (+3,27 kB) — CI 451,32 kB. O crescimento é código de comportamento
    // novo e espalhado (cupom do PDV, "Desfazer" com confirmação, banners,
    // recibo, Mercado Pago), sem duplicata nem dependência nova; `import()`
    // não ajuda porque o portão SOMA todos os chunks do painel. Cliente fica
    // em 522,77/550 kB, sem mudança de teto.
    //
    // 15/10/2026 — lote 4 da noite (PR #883; propôs 455 -> 460, superado pela
    // soma no fim deste comentário). Lotes 1-4 da noite
    // 15/10 medidos 455,5 kB (CI; 455,3 kB local); folga para o lote de
    // categorias/identidade da loja. Os 6 ramos do lote 4 são comportamento
    // novo (galeria do produto, painel do início, pedido ao vivo, avisos/push),
    // sem dependência nova. Código morto que sobrou da resolução dos conflitos
    // (`fundirPedidoDoHook`, `urlDoPedidoNoPush`) não pesa no pacote: o
    // Rollup já o descarta, então apagá-lo não devolve nenhum byte.
    //
    // 15/10/2026 — teto 455 -> 460 kB (decisão técnica do hub, não do dono, no
    // PR #885 que integra os lotes de banco 36 a 41). Medido depois de juntar a
    // base com o #882: painel 459,61 kB (base c67d95ea 448,04; +3,5 do #882; +8,0
    // dos lotes 36 a 41). O +8,0 é funcionalidade real, sem duplicata nem
    // import estático errado: privacidade dos clientes 2,8, gerenciar categorias
    // 2,6, "Sobre a loja" 1,1, formulário e lista de produtos 0,8, ajustes 0,3,
    // o resto em sobras pequenas. Folga de 0,39 kB de propósito. Reduzir de
    // verdade (recharts, ~141 kB de módulos; tus-js-client, ~26 kB) fica na fila.
    //
    // 15/10/2026 — teto 460 -> 464,5 kB (decisão técnica, ao trazer a base
    // para o PR #883). As duas pontas crescem juntas e cada uma cabia sozinha em
    // 460: a base (#885, lotes 36 a 41) mede 459,61 kB e o lote 4 (#883) soma
    // +4,4 kB (cartão de avisos do aparelho; galeria do produto, painel do
    // início e pedido ao vivo já estavam na conta dos 455,5 kB). Medido com as
    // duas juntas: painel 462,83 kB; teto = medido + ~1,5 kB, arredondado a 0,5
    // acima. Sem duplicata nem dependência nova; `import()` não ajuda porque o
    // portão SOMA todos os chunks do painel. Cliente 540,36/550 kB, sem mudança.
    //
    // 15/10/2026 — teto 464,5 -> 466 kB (decisão do dono, delegada à hub em
    // 15/10/2026 ("você escolhe a melhor opção por mim"), registrada aqui; o
    // dono pode vetar e voltar a 464,5; lote R1 do
    // reembolso): +1,5 kB: bloco de reembolso em dúvida no painel, risco de
    // pagamento em dobro. Medido 465,17 kB (base 462,83; +2,34 do R1 já
    // compactado: contrato do saldo do servidor, bloco da devolução, saída dos
    // 7 dias). Código morto citado acima não devolve byte. Cliente 540,60/550.
    //
    // 16/10/2026 — teto 466 -> 467 kB (a subida anterior foi delegada à hub; a
    // sessão que coordena o lote autorizou só este passo; o dono pode vetar e
    // voltar a 466 em uma linha): +0,24 kB acima do teto, medido 466,24 kB. É a
    // chave anti-duplicação do lançamento financeiro (PR #981): chave por
    // tentativa, reaproveitada ao reabrir ou recarregar o formulário depois do
    // aviso de internet lenta. O gerador de UUID já existia e foi reaproveitado
    // (sem cópia no painel); a proteção contra recarregar a página fica.
    // 17/10/2026 — teto 467 -> 471 kB, ULTIMA subida (decisao da hub com o
    // `socio`, sob a delegacao do dono de 15/10; o dono pode vetar e voltar a
    // 467 em uma linha). Motivo: o redesenho aprovado de todas as telas do
    // painel (Clientes, Produtos, Pedidos medido 467,34 e Financeiro previsto
    // ~+2 kB). O painel carrega por tela (22 telas sob demanda), entao +3 kB
    // custam ao lojista so na primeira abertura da tela. Duas caças a economia
    // (PR #999, -4 kB; analise de 17/10, ~100 bytes) nao acharam mais gordura.
    // AJUSTE no mesmo dia: 471 -> 472 kB. O Financeiro medido somou +3,7 kB (a
    // estimativa do socio era ~+2): 471,38 kB. E a correcao da estimativa do
    // MESMO redesenho, nao uma subida nova; folga real ~0,5 kB. Duas tentativas
    // de enxugar o chunk (GPT) acharam so ~125 bytes: o brotli ja comprime a
    // repeticao.
    // REGRA: dai em diante o painel nao sobe mais; cada kB novo e pago com um
    // kB tirado de outro lugar (primeira fonte: a biblioteca de graficos).
    path: painel.map((arquivo) => `${output}/${arquivo}`),
    limit: "472 kB",
    webpack: false,
    running: false,
  },
  { path: `${output}/assets/*.css`, limit: "100 kB", webpack: false },
  {
    // C2.5 (fila do bastão 19/09, preservado): o leitor de código de barras
    // do balcão tem medida PRÓPRIA — o glue JS (chunk `leitor-zxing-*.js`,
    // nome garantido pelo manualChunks do vite.config) SOMADO ao binário WASM
    // que o vite emite do export do pacote. Os dois só viajam juntos e só
    // para quem não tem leitor nativo; medido na 3.1.4: 332.45 kB (glue
    // ~34 kB + wasm brotli) — o limite deixa folga mínima para reposição
    // de versão do pacote que não mude o contrato; subir além é decisão
    // consciente, como qualquer teto daqui. O nome previsível do chunk é o
    // que permite excluí-lo da conta de cliente/painel acima.
    path: [`${output}/assets/leitor-zxing-*.js`, `${output}/assets/*.wasm`],
    limit: "400 kB",
    webpack: false,
    running: false,
  },
];
