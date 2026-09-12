/**
 * Leitura da CONFIGURAÇÃO PÚBLICA da loja — os 4 valores por loja que até a
 * etapa 3 da escala (11/09/2026) eram ASSADOS no build (`import.meta.env`):
 * chave pública do Mercado Pago, chave pública VAPID, e as flags
 * `pagamentoOnline`/`manutencao`. Com um build único servindo N lojas, esses
 * 4 valores viajam na FICHA DA LOJA (`./fichaDaLojaContract.ts`,
 * `configuracao`), escrita pelo porteiro (`middleware.ts`) a partir do banco
 * da própria loja.
 *
 * PRECEDÊNCIA: ficha PRESENTE → `ficha.configuracao`, sempre — mesmo que
 * algum campo esteja `null`/`false` (recurso desligado NESTA loja, não erro
 * de leitura). Ficha AUSENTE (build de loja única, ou arquivo estático
 * servido cru fora do matcher do porteiro: `/index.html`, `/404.html`,
 * `/offline.html`) só cai no `import.meta.env` assado quando
 * `import.meta.env.DEV` é verdadeiro — é o mesmo ambiente de build local que
 * hoje não tem porteiro na frente.
 *
 * FALHA FECHADA (ADENDO A.2, dinheiro): em PRODUÇÃO, ficha ausente devolve
 * `{ mpPublicKey: null, vapidPublicKey: null, pagamentoOnline: false,
 * manutencao: false }` — NUNCA o valor assado do `import.meta.env`, mesmo
 * que ele esteja preenchido no build. Num build compartilhado por N lojas, o
 * assado pode ser (ou nem existir mais como) o valor de OUTRA loja; abrir
 * cobrança ou push com a chave errada é pior que não abrir. Ficha PRESENTE e
 * INVÁLIDA (fora do contrato) não é tratada aqui: `lerFichaDaLoja()` já
 * lança `IDENTITY_FICHA_INVALID` antes deste módulo decidir qualquer coisa —
 * este módulo não engole essa exceção.
 */
import { lerFichaDaLoja } from "./fichaDaLoja";
import type { ConfiguracaoDaLoja } from "./fichaDaLojaContract";

const CONFIGURACAO_FECHADA: ConfiguracaoDaLoja = {
  mpPublicKey: null,
  vapidPublicKey: null,
  pagamentoOnline: false,
  manutencao: false,
};

/** Env DEFINIDA e vazia ("") atravessa `?? null` sem virar `null` — viola o
 * contrato (string não vazia ou `null`). Normaliza: vazia (depois de trim) →
 * `null`, valor com conteúdo → o valor trimado. */
function stringNaoVaziaOuNull(valor: string | undefined): string | null {
  const normalizado = valor?.trim();
  return normalizado ? normalizado : null;
}

function configuracaoDoAmbienteDeBuild(): ConfiguracaoDaLoja {
  return {
    mpPublicKey: stringNaoVaziaOuNull(import.meta.env.VITE_MP_PUBLIC_KEY),
    vapidPublicKey: stringNaoVaziaOuNull(import.meta.env.VITE_VAPID_PUBLIC_KEY),
    // Duplica `=== "true"` em vez de importar `lerFlagPagamentoOnline` de
    // `@/lib/flags`: `flags.ts` reexporta `pagamentoOnlineLigado` DESTE
    // módulo, e importar `flags.ts` aqui fecharia um ciclo. A regra-mãe
    // continua sendo `lerFlagPagamentoOnline` (`src/lib/flags.ts:11`).
    pagamentoOnline: import.meta.env.VITE_PAGAMENTO_ONLINE === "true",
    manutencao: import.meta.env.VITE_MAINTENANCE_MODE === "true",
  };
}

export function lerConfiguracaoDaLoja(): ConfiguracaoDaLoja {
  const ficha = lerFichaDaLoja();
  if (ficha) return ficha.configuracao;

  // Sem ficha: só em DEV (build local, sem porteiro na frente) o valor
  // assado do ambiente é aceito. Em produção, falha fechada.
  return import.meta.env.DEV
    ? configuracaoDoAmbienteDeBuild()
    : CONFIGURACAO_FECHADA;
}

/** Falha fechada por desenho: só `true` liga o checkout online. */
export function pagamentoOnlineLigado(): boolean {
  return lerConfiguracaoDaLoja().pagamentoOnline === true;
}

export function chavePublicaMercadoPago(): string | null {
  return lerConfiguracaoDaLoja().mpPublicKey;
}

export function chavePublicaVapid(): string | null {
  return lerConfiguracaoDaLoja().vapidPublicKey;
}

export function modoManutencao(): boolean {
  return lerConfiguracaoDaLoja().manutencao;
}
