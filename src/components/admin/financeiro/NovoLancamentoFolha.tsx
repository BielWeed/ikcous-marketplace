import { useEffect, useMemo, useRef, useState } from "react";

import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import { salvarLancamento } from "@/hooks/useFinanceiro";
import {
  FORMAS_DO_LANCAMENTO,
  type FormularioDoLancamento,
  MAXIMO_DE_PARCELAS,
  formatarBRL,
  formatarData,
  formularioInicialDoLancamento,
  mensagemDeErroFinanceiro,
  parseValorBR,
  rotuloDaForma,
  validarLancamento,
  valorDaParcela,
} from "@/lib/financeiro";
import {
  CONTA_BANCARIA,
  type CategoriaFinanceira,
  type ContaFinanceira,
  type DataIso,
  type TipoDeLancamento,
} from "@/types/financeiro";
import { FolhaFinanceira } from "./FolhaFinanceira";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CAMPO,
  Campo,
  EstadoDeErro,
  Segmentado,
} from "./partes";

const ID_FORM = "fin-novo-lancamento";

const PARCELAS = Array.from({ length: MAXIMO_DE_PARCELAS }, (_, i) => i + 1);

/** Conta sugerida: o banco para receita/despesa (o comum numa loja), senão a primeira ativa. */
function contaSugerida(contas: readonly ContaFinanceira[]): string {
  return (
    contas.find((c) => c.id === CONTA_BANCARIA)?.id ?? contas.at(0)?.id ?? ""
  );
}

const naturezaDoTipo = (tipo: TipoDeLancamento) =>
  tipo === "entrada" ? "receita" : "despesa";

/**
 * "Novo lançamento": despesa, receita ou transferência entre contas. Valida
 * TUDO antes de chamar `fin_lancamento_salvar` e mostra a recusa do servidor
 * na própria folha (a folha só fecha quando o banco confirma).
 */
export function NovoLancamentoFolha({
  hoje,
  contas,
  categorias,
  inicial,
  aviso,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly hoje: DataIso;
  readonly contas: readonly ContaFinanceira[];
  readonly categorias: readonly CategoriaFinanceira[];
  readonly inicial?: Partial<FormularioDoLancamento>;
  /** Contas/categorias não carregaram: a folha diz por que as listas estão vazias. */
  readonly aviso?: string | null;
  readonly aoFechar: () => void;
  readonly aoSalvar: (mensagem: string) => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const contasAtivas = useMemo(() => contas.filter((c) => c.ativa), [contas]);
  const [formInicial] = useState<FormularioDoLancamento>(() =>
    formularioInicialDoLancamento(hoje, {
      contaId: contaSugerida(contasAtivas),
      ...inicial,
    }),
  );
  const [form, setForm] = useState<FormularioDoLancamento>(formInicial);
  // "Sujo" = diferente do que abriu (desfazer à mão limpa o aviso). Tocar e
  // sair de um campo sem mudar nada não conta.
  const sujo = JSON.stringify(form) !== JSON.stringify(formInicial);
  useEffect(() => {
    aoMudarSujo(sujo);
  }, [sujo, aoMudarSujo]);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const enviandoRef = useRef(false);

  const validacao = useMemo(() => validarLancamento(form, hoje), [form, hoje]);
  const erros = tentouSalvar && !validacao.ok ? validacao.erros : {};

  const transferencia = form.tipo === "transferencia";
  const previsto = !transferencia && form.situacao === "previsto";
  const receita = form.tipo === "entrada";

  const categoriasDoTipo = useMemo(
    () =>
      categorias.filter(
        (c) =>
          c.natureza === naturezaDoTipo(form.tipo) &&
          (c.ativa || c.id === form.categoriaId),
      ),
    [categorias, form.tipo, form.categoriaId],
  );

  function atualizar(parcial: Partial<FormularioDoLancamento>) {
    setForm((atual) => ({ ...atual, ...parcial }));
    setErroDoServidor(null);
  }

  function mudarTipo(tipo: TipoDeLancamento) {
    const categoria = categorias.find((c) => c.id === form.categoriaId);
    atualizar({
      tipo,
      categoriaId:
        categoria && categoria.natureza === naturezaDoTipo(tipo)
          ? form.categoriaId
          : "",
      ...(tipo === "transferencia"
        ? { situacao: "realizado", parcelas: "1", formaPagamento: "" }
        : {}),
    });
  }

  async function salvar(evento?: { preventDefault: () => void }) {
    evento?.preventDefault();
    if (enviandoRef.current) return;
    setTentouSalvar(true);
    const resultado = validarLancamento(form, hoje);
    if (!resultado.ok) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErroDoServidor(null);
    try {
      const ids = await salvarLancamento(resultado.payload);
      aoSalvar(
        ids.length > 1
          ? `${ids.length} parcelas lançadas.`
          : "Lançamento salvo.",
      );
    } catch (erro) {
      setErroDoServidor(mensagemDeErroFinanceiro(erro));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const valorDigitado = parseValorBR(form.valor);
  const parcelas = Number(form.parcelas) || 1;
  const parcela =
    valorDigitado !== null && valorDigitado > 0 && parcelas > 1
      ? valorDaParcela(valorDigitado, parcelas)
      : null;

  const rotuloSituacao = receita
    ? { feito: "Já recebido", pendente: "A receber" }
    : { feito: "Já pago", pendente: "A pagar" };

  return (
    <FolhaFinanceira
      titulo="Novo lançamento"
      descricao="Receitas e despesas que não vêm de pedido: aluguel, fornecedor, taxa, conta de luz."
      aoFechar={aoFechar}
      rodape={
        <div className="flex flex-col gap-3">
          {erroDoServidor ? <EstadoDeErro mensagem={erroDoServidor} /> : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={aoFechar}
              className={`${CLASSE_BOTAO_SECUNDARIO} flex-1`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form={ID_FORM}
              disabled={enviando}
              className={`${CLASSE_BOTAO_PRIMARIO} flex-[2]`}
            >
              {enviando ? "Salvando…" : "Salvar lançamento"}
            </button>
          </div>
        </div>
      }
    >
      <form
        id={ID_FORM}
        noValidate
        onSubmit={(evento) => {
          void salvar(evento);
        }}
        className="flex flex-col gap-4"
      >
        {aviso ? <EstadoDeErro mensagem={aviso} /> : null}
        <Segmentado<TipoDeLancamento>
          rotulo="Tipo do lançamento"
          valor={form.tipo}
          aoMudar={mudarTipo}
          opcoes={[
            { valor: "saida", rotulo: "Despesa" },
            { valor: "entrada", rotulo: "Receita" },
            { valor: "transferencia", rotulo: "Transferência" },
          ]}
        />

        <Campo
          id="fin-lanc-valor"
          rotulo={parcelas > 1 ? "Valor total (R$)" : "Valor (R$)"}
          erro={erros.valor}
        >
          <LocalBufferedInput
            id="fin-lanc-valor"
            value={form.valor}
            mask="currency"
            inputMode="numeric"
            placeholder="0,00"
            autoComplete="off"
            aria-invalid={erros.valor ? true : undefined}
            onFlush={(valor) => atualizar({ valor })}
            className={`${CLASSE_CAMPO} text-xl font-black tabular-nums`}
          />
        </Campo>

        <Campo
          id="fin-lanc-descricao"
          rotulo="Descrição"
          erro={erros.descricao}
        >
          <LocalBufferedInput
            id="fin-lanc-descricao"
            value={form.descricao}
            maxLength={200}
            placeholder={
              transferencia
                ? "Ex.: depósito do caixa no banco"
                : receita
                  ? "Ex.: aluguel da vitrine"
                  : "Ex.: aluguel de setembro"
            }
            aria-invalid={erros.descricao ? true : undefined}
            onFlush={(descricao) => atualizar({ descricao })}
            className={CLASSE_CAMPO}
          />
        </Campo>

        {transferencia ? null : (
          <Campo
            id="fin-lanc-categoria"
            rotulo="Categoria"
            erro={erros.categoriaId}
            ajuda="É a categoria que coloca o valor na linha certa da DRE."
          >
            <select
              id="fin-lanc-categoria"
              value={form.categoriaId}
              aria-invalid={erros.categoriaId ? true : undefined}
              onChange={(e) => atualizar({ categoriaId: e.target.value })}
              className={CLASSE_CAMPO}
            >
              <option value="">Escolha…</option>
              {categoriasDoTipo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <div className={transferencia ? "grid grid-cols-2 gap-3" : ""}>
          <Campo
            id="fin-lanc-conta"
            rotulo={transferencia ? "Sai de" : "Conta"}
            erro={erros.contaId}
          >
            <select
              id="fin-lanc-conta"
              value={form.contaId}
              aria-invalid={erros.contaId ? true : undefined}
              onChange={(e) => atualizar({ contaId: e.target.value })}
              className={CLASSE_CAMPO}
            >
              <option value="">Escolha…</option>
              {contasAtivas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Campo>
          {transferencia ? (
            <Campo
              id="fin-lanc-conta-destino"
              rotulo="Entra em"
              erro={erros.contaDestinoId}
            >
              <select
                id="fin-lanc-conta-destino"
                value={form.contaDestinoId}
                aria-invalid={erros.contaDestinoId ? true : undefined}
                onChange={(e) => atualizar({ contaDestinoId: e.target.value })}
                className={CLASSE_CAMPO}
              >
                <option value="">Escolha…</option>
                {contasAtivas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Campo>
          ) : null}
        </div>

        {transferencia ? null : (
          <Segmentado<"realizado" | "previsto">
            rotulo="Situação"
            valor={form.situacao}
            aoMudar={(situacao) =>
              atualizar(
                situacao === "realizado"
                  ? { situacao, parcelas: "1" }
                  : { situacao },
              )
            }
            opcoes={[
              { valor: "realizado", rotulo: rotuloSituacao.feito },
              { valor: "previsto", rotulo: rotuloSituacao.pendente },
            ]}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          {previsto ? (
            <Campo
              id="fin-lanc-vencimento"
              rotulo={parcelas > 1 ? "1º vencimento" : "Vencimento"}
              erro={erros.dataVencimento}
            >
              <input
                id="fin-lanc-vencimento"
                type="date"
                value={form.dataVencimento}
                onChange={(e) => atualizar({ dataVencimento: e.target.value })}
                className={CLASSE_CAMPO}
              />
            </Campo>
          ) : (
            <Campo
              id="fin-lanc-realizacao"
              rotulo={
                transferencia ? "Data" : receita ? "Recebido em" : "Pago em"
              }
              erro={erros.dataRealizacao}
            >
              <input
                id="fin-lanc-realizacao"
                type="date"
                value={form.dataRealizacao}
                max={hoje}
                onChange={(e) => atualizar({ dataRealizacao: e.target.value })}
                className={CLASSE_CAMPO}
              />
            </Campo>
          )}
          <Campo
            id="fin-lanc-competencia"
            rotulo="Competência"
            erro={erros.dataCompetencia}
          >
            <input
              id="fin-lanc-competencia"
              type="date"
              value={form.dataCompetencia}
              onChange={(e) => atualizar({ dataCompetencia: e.target.value })}
              className={CLASSE_CAMPO}
            />
          </Campo>
        </div>
        <p className="-mt-2 text-[11px] text-zinc-500">
          Competência é o mês a que o valor pertence (a DRE conta por ela); pode
          ser diferente do dia em que o dinheiro se mexe.
        </p>

        {previsto ? (
          <Campo
            id="fin-lanc-parcelas"
            rotulo="Parcelas"
            erro={erros.parcelas}
            ajuda={
              parcela
                ? `${parcelas}× de ${parcela.exata ? "" : "cerca de "}${formatarBRL(parcela.parcela)} — uma por mês a partir de ${formatarData(form.dataVencimento)}${parcela.exata ? "" : `; a soma fecha em ${formatarBRL(valorDigitado ?? 0)}`}.`
                : "À vista: um vencimento só."
            }
          >
            <select
              id="fin-lanc-parcelas"
              value={form.parcelas}
              onChange={(e) => atualizar({ parcelas: e.target.value })}
              className={CLASSE_CAMPO}
            >
              {PARCELAS.map((n) => (
                <option key={n} value={String(n)}>
                  {n === 1 ? "À vista (1×)" : `${n}×`}
                </option>
              ))}
            </select>
          </Campo>
        ) : null}

        {transferencia ? null : (
          <Campo id="fin-lanc-forma" rotulo="Forma de pagamento (opcional)">
            <select
              id="fin-lanc-forma"
              value={form.formaPagamento}
              onChange={(e) => atualizar({ formaPagamento: e.target.value })}
              className={CLASSE_CAMPO}
            >
              <option value="">Não informar</option>
              {FORMAS_DO_LANCAMENTO.map((forma) => (
                <option key={forma} value={forma}>
                  {rotuloDaForma(forma)}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo
          id="fin-lanc-observacao"
          rotulo="Observação (opcional)"
          erro={erros.observacao}
        >
          <LocalBufferedTextarea
            id="fin-lanc-observacao"
            value={form.observacao}
            maxLength={500}
            rows={2}
            onFlush={(observacao) => atualizar({ observacao })}
            className={`${CLASSE_CAMPO} min-h-[72px] py-2`}
          />
        </Campo>
      </form>
    </FolhaFinanceira>
  );
}
