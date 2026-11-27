/**
 * A loja aceita pedido NOVO pela vitrine agora? (27/11/2026)
 *
 * O cartão "Sua assinatura" afirmava "Vendas pela loja pausadas" só com
 * `suspensa` + `pausa_em` vencido (`avisoDasVendasPausadas`), mas o banco só
 * pausa com a chave `pausa_de_vendas.vale_pela_assinatura` ligada (migration
 * 20261600000000), que nasce desligada e o front não enxerga. Quem diz a
 * verdade é `situacao_das_vendas_da_loja()` → `{aceita, motivo,
 * pausada_desde}`; este módulo lê essa resposta e decide o que o cartão diz.
 *
 * Fora de `crm.ts` de propósito: `crm.ts` mora no chunk `painel-ui`, que conta
 * no teto da VITRINE (`vite.config.ts`, `manualChunks`). Isto só serve ao
 * Início do painel e não pode engordar o que a cliente baixa (medido em
 * 27/11/2026: com isto dentro de `crm.ts` a vitrine subia 0,36 kB). Pelo mesmo
 * motivo nada aqui importa CÓDIGO de `crm.ts`, só tipo: o sinal da gestão
 * (`avisoDasVendasPausadas`) chega pronto de quem chama, e este módulo nunca
 * puxa nada para o `painel-ui`.
 */
import type { avisoDasVendasPausadas } from "@/lib/crm";
import type { AssinaturaDaLoja, SituacaoDasVendas } from "@/types/painel";

const PADRAO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Só `YYYY-MM-DD` de um dia que existe no calendário (`2027-02-30` não): a
 * mesma régua de `diaRealDoAviso` em `crm.ts`, que é privada lá.
 */
function diaReal(valor: string | null): string | null {
  if (!valor || !PADRAO_DIA.test(valor)) return null;
  const [ano, mes, dia] = valor.split("-").map(Number);
  const utc = new Date(Date.UTC(ano, mes - 1, dia));
  return utc.toISOString().slice(0, 10) === valor ? valor : null;
}

/** Só texto; vazio vira `null`. */
function comoTexto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/**
 * `situacao_das_vendas_da_loja()` → `{aceita, motivo, pausada_desde}`. Forma
 * torta, ou `aceita` que contradiz o `motivo` (o banco manda
 * `aceita = motivo IS NULL`), vira `null`: "não sei", e o cartão não afirma
 * pausa nenhuma.
 */
export function lerSituacaoDasVendas(json: unknown): SituacaoDasVendas | null {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    return null;
  const raiz = json as Record<string, unknown>;
  if (typeof raiz.aceita !== "boolean") return null;
  const motivo = comoTexto(raiz.motivo);
  if (raiz.aceita !== (motivo === null)) return null;
  return {
    aceita: raiz.aceita,
    motivo,
    pausadaDesde: comoTexto(raiz.pausada_desde),
  };
}

/** A mensalidade que deixou a loja suspensa, para a frase do vencimento. */
interface VencimentoDaSuspensa {
  venceuEm: string;
  valorMensal: number;
  doTeste: boolean;
}

/**
 * O cartão "Sua assinatura" com a loja suspensa. Quem diz se os pedidos pela
 * loja PARARAM é o banco:
 *
 * - Ele diz `vendas_pausadas`: `pausadas`, com o dia que ELE diz (pode ser
 *   depois do `pausa_em`: fim de semana passa para a segunda) e o vencimento
 *   só se o sinal da gestão for real (senão a frase do vencimento some, a
 *   pausa fica). Vale até com `pausa_em` nulo (chave ligada, gestão antiga).
 * - Ele aceita pedido, a loja está `suspensa` e o sinal completo da gestão
 *   (`sinalDaGestao`, o `avisoDasVendasPausadas` de agora) diria "pausadas":
 *   `em-aberto`, a mensalidade sem afirmar pausa.
 * - Sem resposta dele (loja sem a função, rede), manutenção (não é pausa por
 *   assinatura) ou sinal incompleto: `null`, o cartão de hoje.
 */
export function avisoDaSuspensa(
  assinatura: Pick<
    AssinaturaDaLoja,
    "valorMensal" | "proximaCobrancaEm" | "testeAte"
  >,
  situacao: SituacaoDasVendas | null | undefined,
  sinalDaGestao: ReturnType<typeof avisoDasVendasPausadas>,
):
  | {
      tipo: "pausadas";
      pausadasDesde: string | null;
      vencimento: VencimentoDaSuspensa | null;
    }
  | { tipo: "em-aberto"; vencimento: VencimentoDaSuspensa }
  | null {
  if (!situacao) return null;
  if (!situacao.aceita && situacao.motivo === "vendas_pausadas") {
    return {
      tipo: "pausadas",
      pausadasDesde: diaReal(situacao.pausadaDesde),
      vencimento: vencimentoDaSuspensa(assinatura),
    };
  }
  if (!situacao.aceita || !sinalDaGestao) return null;
  const { venceuEm, valorMensal, doTeste } = sinalDaGestao;
  return { tipo: "em-aberto", vencimento: { venceuEm, valorMensal, doTeste } };
}

/** Valor > 0 e vencimento real; `teste_ate` só vale igual ao vencimento. */
function vencimentoDaSuspensa(
  assinatura: Pick<
    AssinaturaDaLoja,
    "valorMensal" | "proximaCobrancaEm" | "testeAte"
  >,
): VencimentoDaSuspensa | null {
  const { valorMensal } = assinatura;
  if (valorMensal == null || !Number.isFinite(valorMensal) || valorMensal <= 0)
    return null;
  const venceuEm = diaReal(assinatura.proximaCobrancaEm);
  if (!venceuEm) return null;
  const doTeste = assinatura.testeAte !== null;
  if (doTeste && diaReal(assinatura.testeAte) !== venceuEm) return null;
  return { venceuEm, valorMensal, doTeste };
}
