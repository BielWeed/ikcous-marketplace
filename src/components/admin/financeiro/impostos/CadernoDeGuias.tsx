// Caderno das guias na tela (Gestão Fiscal, aba Impostos): mês a mês, o que a lojista
// LANÇOU como guia de imposto, nos três estados que ela entende: Valor da guia (o
// número que está na guia), A pagar (o que ainda falta) e Pago (o que já foi baixado).
//
// COMPONENTE DE APRESENTAÇÃO. Recebe os meses já montados (`montarCaderno`) e o
// `abrirFolha` do Financeiro; não lê nem grava nada. Lançar e pagar são as folhas que o
// Financeiro já tem ("Novo lançamento" e "Baixar"): a lojista confere e confirma lá, e
// este arquivo nunca importa módulo de escrita de lançamento.
//
// REGRA DURA (é dinheiro): o valor de uma guia NUNCA é a estimativa do app. Por isso o
// `inicial` do "Novo lançamento" sai SÓ de `guiaDoMes` (que nem recebe estimativa), e a
// estimativa recebida aqui serve apenas para a frase de comparação com a guia.
//
// Funciona para toda loja: sem cadastro fiscal o caderno aparece igual e a guia sai
// pré-preenchida sem valor. Nenhum regime é suposto.

import {
  AlertTriangle,
  Calculator,
  CircleCheck,
  CircleDashed,
  Clock,
  FileText,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";

import { formatarData } from "@/lib/financeiro";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import type { EstadoDoMes, MesDoCaderno } from "@/lib/fiscal/caderno";
import { compararEstimativaComGuia } from "@/lib/fiscal/comparacao";
import { guiaDoMes } from "@/lib/fiscal/guia-do-mes";
import { classeDoTexto } from "@/lib/tons-de-estado";
import type { TomDeEstado } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { AbrirFolha, AlvoDaBaixa } from "../navegacao";
import {
  CLASSE_BOTAO_SECUNDARIO,
  CartaoSecao,
  Dinheiro,
  EstadoVazio,
} from "../partes";
import {
  CLASSE_CARTAO_DA_LISTA,
  CLASSE_PILULA_PRIMARIA,
  CLASSE_QUADRO_INTERNO,
} from "../partesDoExtrato";

/** Um mês do caderno, com o que a aba sabe dele além do que a lojista lançou. */
export interface MesParaOCaderno {
  /** O mês montado por `montarCaderno` (valor da guia, pago, a pagar, situação). */
  readonly caderno: MesDoCaderno;
  /**
   * A estimativa do app para o mês, em reais. Só entra na frase de comparação com a
   * guia; nunca é mostrada aqui e nunca vira valor de lançamento. `null`/ausente =
   * o app não estimou o mês (loja sem conta, ou mês sem receita lida).
   */
  readonly estimativa?: number | null;
  /**
   * As vendas registradas no app no mês, menos devoluções, em reais: o MESMO número do
   * Resultado (decisão do sócio, 25/11/2026). É informação do mês, mostrada numa linha
   * discreta, nunca como um quarto valor ao lado da guia. `null`/ausente = a leitura não
   * chegou: não mostra linha (nunca "R$ 0,00" no lugar do que não se sabe).
   */
  readonly vendasDoMes?: number | null;
  /**
   * As guias do mês que ainda estão a pagar, já no formato da folha de baixa. A aba
   * monta a partir dos lançamentos que leu (o caderno só soma, não guarda o id). Sem
   * isto o mês mostra o valor a pagar, mas não oferece "Pagar".
   */
  readonly guiasAPagar?: readonly AlvoDaBaixa[];
}

const NOMES_DOS_MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "outubro de 2026". Competência fora do formato volta como veio (nunca inventa mês). */
function rotuloDoMes(competencia: string): string {
  const partes = COMPETENCIA.exec(competencia);
  if (!partes) return competencia;
  const nome = NOMES_DOS_MESES[Number(partes[2]) - 1];
  return nome ? `${nome} de ${partes[1]}` : competencia;
}

interface SeloDoEstado {
  readonly texto: string;
  readonly icone: LucideIcon;
  readonly tom: TomDeEstado;
}

// Texto + ícone + cor: a cor reforça, nunca é a única pista.
function seloDoEstado(estado: EstadoDoMes): SeloDoEstado {
  switch (estado) {
    case "sem_guia":
      return { texto: "Sem guia lançada", icone: CircleDashed, tom: "neutro" };
    case "a_pagar":
      return { texto: "Falta pagar", icone: Clock, tom: "atencao" };
    case "vencida":
      return { texto: "Vencida", icone: AlertTriangle, tom: "negativo" };
    case "paga":
      return { texto: "Paga", icone: CircleCheck, tom: "positivo" };
  }
}

function Selo({ estado }: { readonly estado: EstadoDoMes }) {
  const { texto, icone: Icone, tom } = seloDoEstado(estado);
  return (
    <span
      data-selo-do-mes=""
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-bold",
        classeDoTexto(tom),
      )}
    >
      <Icone aria-hidden="true" className="size-4 shrink-0" />
      {texto}
    </span>
  );
}

function Estado({
  rotulo,
  valor,
}: {
  readonly rotulo: string;
  readonly valor: number;
}) {
  return (
    <div className={CLASSE_QUADRO_INTERNO}>
      <dt className="text-xs font-semibold text-zinc-300">{rotulo}</dt>
      <dd className="mt-1 text-lg font-bold text-white">
        <Dinheiro valor={valor} />
      </dd>
    </div>
  );
}

function CartaoDoMes({
  item,
  cadastro,
  abrirFolha,
}: {
  readonly item: MesParaOCaderno;
  readonly cadastro: Pick<CadastroFiscal, "regime" | "atividade"> | null;
  readonly abrirFolha: AbrirFolha;
}) {
  const { caderno } = item;
  const rotulo = rotuloDoMes(caderno.mes);
  const semGuia = caderno.estado === "sem_guia";
  const aPagar = caderno.estado === "a_pagar" || caderno.estado === "vencida";
  const alvos = item.guiasAPagar ?? [];
  // Número que não é um número de verdade (ou que a leitura não trouxe) não vira "R$ 0,00".
  const vendasDoMes =
    typeof item.vendasDoMes === "number" && Number.isFinite(item.vendasDoMes)
      ? item.vendasDoMes
      : null;
  // O ano da lei é o do mês das vendas. `null` = competência inválida: sem botão, em
  // vez de abrir o formulário com uma data inventada.
  const inicial = semGuia
    ? guiaDoMes(cadastro, caderno.mes, Number(caderno.mes.slice(0, 4)))
    : null;

  return (
    <li
      data-mes={caderno.mes}
      className={cn(CLASSE_CARTAO_DA_LISTA, "flex flex-col gap-4 p-4")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* `first-letter`, não `capitalize`: "Outubro de 2026", nunca "Outubro De 2026". */}
        <h3 className="text-base font-bold text-white first-letter:uppercase">
          {rotulo}
        </h3>
        <Selo estado={caderno.estado} />
      </div>

      {vendasDoMes === null ? null : (
        <p
          data-vendas-do-mes=""
          className="text-xs leading-relaxed text-zinc-400"
        >
          Vendas registradas no app (menos devoluções):{" "}
          <Dinheiro valor={vendasDoMes} />
        </p>
      )}

      {semGuia ? (
        <p className="text-sm leading-relaxed text-zinc-400">
          Nenhuma guia lançada para as vendas deste mês.
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Estado rotulo="Valor da guia" valor={caderno.guia} />
          <Estado rotulo="A pagar" valor={caderno.aPagar} />
          <Estado rotulo="Pago" valor={caderno.pago} />
        </dl>
      )}

      {inicial ? (
        <button
          type="button"
          aria-label={`Lançar a guia deste mês (${rotulo})`}
          onClick={() => abrirFolha({ tipo: "novo-lancamento", inicial })}
          className={cn(CLASSE_BOTAO_SECUNDARIO, "w-full")}
        >
          <Plus aria-hidden="true" className="size-4" />
          Lançar a guia deste mês
        </button>
      ) : null}

      {aPagar && alvos.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {alvos.map((alvo) => (
            <li
              key={alvo.id}
              className="flex flex-col gap-2 border-t border-admin-border pt-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 break-words text-sm font-medium text-white">
                  {alvo.descricao}
                </p>
                <Dinheiro
                  valor={alvo.valor}
                  className="text-sm font-bold text-white"
                />
              </div>
              <p className="text-xs text-zinc-400">
                {alvo.vencimento
                  ? `Vence em ${formatarData(alvo.vencimento)}`
                  : "Sem vencimento"}
              </p>
              <button
                type="button"
                aria-label={`Pagar ${alvo.descricao}`}
                onClick={() => abrirFolha({ tipo: "baixar", alvo })}
                className={cn(CLASSE_PILULA_PRIMARIA, "w-full")}
              >
                Pagar
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {aPagar && alvos.length === 0 ? (
        <p className="text-sm leading-relaxed text-zinc-400">
          Para dar baixa nesta guia, abra a aba Pagar e receber.
        </p>
      ) : null}
    </li>
  );
}

/**
 * @param meses os meses a mostrar, um item por mês (o caderno já traz um por mês do
 *   período). O componente os mostra do mais recente para o mais antigo.
 * @param cadastro o cadastro fiscal da loja; `null` = sem cadastro (o caderno funciona
 *   igual; a guia sai pré-preenchida sem valor).
 * @param abrirFolha o `abrirFolha` do Financeiro: é o único caminho para lançar ou pagar.
 */
export function CadernoDeGuias({
  meses,
  cadastro,
  abrirFolha,
}: {
  readonly meses: readonly MesParaOCaderno[];
  readonly cadastro: Pick<CadastroFiscal, "regime" | "atividade"> | null;
  readonly abrirFolha: AbrirFolha;
}) {
  const maisRecentePrimeiro = useMemo(
    () =>
      [...meses].sort((a, b) =>
        a.caderno.mes < b.caderno.mes
          ? 1
          : a.caderno.mes > b.caderno.mes
            ? -1
            : 0,
      ),
    [meses],
  );
  const comparacao = useMemo(
    () =>
      compararEstimativaComGuia(
        meses.map((m) => ({
          mes: m.caderno.mes,
          estimativa: m.estimativa ?? null,
          guia: m.caderno.guia,
        })),
      ),
    [meses],
  );
  const nenhumaGuia = meses.every((m) => m.caderno.estado === "sem_guia");

  if (meses.length === 0) {
    return (
      <EstadoVazio
        icone={FileText}
        titulo="Nenhum mês para mostrar"
        texto="Escolha um período para ver as guias de imposto que você lançou."
      />
    );
  }

  return (
    <CartaoSecao
      titulo="Caderno das guias"
      subtitulo="Mês das vendas, com o valor que está na guia. O app não calcula a guia: quem lança o valor é você, a partir da guia que recebeu."
    >
      <div className="flex flex-col gap-4">
        {comparacao ? (
          <p
            data-comparacao-da-estimativa=""
            className={cn(
              "flex items-start gap-2 rounded-2xl border border-admin-border bg-admin-raised p-3 text-sm leading-relaxed",
              classeDoTexto("neutro"),
            )}
          >
            <Calculator aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{comparacao.frase}</span>
          </p>
        ) : null}

        {nenhumaGuia ? (
          <p className="text-sm leading-relaxed text-zinc-400">
            Nenhuma guia lançada neste período. Quando receber a guia do
            imposto, lance aqui o valor que está nela.
          </p>
        ) : null}

        <ul
          aria-label="Guias por mês"
          className="grid grid-cols-1 gap-3 xl:grid-cols-2"
        >
          {maisRecentePrimeiro.map((item) => (
            <CartaoDoMes
              key={item.caderno.mes}
              item={item}
              cadastro={cadastro}
              abrirFolha={abrirFolha}
            />
          ))}
        </ul>
      </div>
    </CartaoSecao>
  );
}
