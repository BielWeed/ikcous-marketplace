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
import { aguardarComPrazo } from "@/lib/prazo-da-requisicao";
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
  Dinheiro,
  EstadoDeErro,
  Segmentado,
  useConfirmacaoFinanceira,
} from "./partes";
import {
  chaveEmAbertoDoConteudo,
  esquecerChaveEmAberto,
  guardarChaveEmAberto,
} from "./tentativasEmAberto";

const ID_FORM = "fin-novo-lancamento";

/** Em HTTP local, randomUUID pode faltar; getRandomValues ainda gera UUID v4. */
function gerarChaveDaTentativa(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
  aoMudarEnviando,
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
  readonly aoMudarEnviando?: (enviando: boolean) => void;
}) {
  const confirmarVisualmente = useConfirmacaoFinanceira();
  const contasAtivas = useMemo(() => contas.filter((c) => c.ativa), [contas]);
  const [formInicial] = useState<FormularioDoLancamento>(() =>
    formularioInicialDoLancamento(hoje, {
      contaId: contaSugerida(contasAtivas),
      ...inicial,
    }),
  );
  const [form, setForm] = useState<FormularioDoLancamento>(formInicial);
  const formRef = useRef(formInicial);
  const [chaveInicial] = useState(gerarChaveDaTentativa);
  const chaveDaTentativa = useRef(chaveInicial);
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
    const proximo = { ...formRef.current, ...parcial };
    // Blur/debounce sem mudança não cria outra tentativa. A ref muda no evento,
    // antes de um submit no mesmo tique; nenhum efeito/updater regenera a chave.
    if (JSON.stringify(proximo) !== JSON.stringify(formRef.current)) {
      chaveDaTentativa.current = gerarChaveDaTentativa();
      formRef.current = proximo;
      setForm(proximo);
    }
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

  function fechar() {
    if (!enviandoRef.current) aoFechar();
  }

  async function salvar(evento?: { preventDefault: () => void }) {
    evento?.preventDefault();
    if (enviandoRef.current) return;
    setTentouSalvar(true);
    const resultado = validarLancamento(formRef.current, hoje);
    if (!resultado.ok) return;
    enviandoRef.current = true;
    aoMudarEnviando?.(true);
    setEnviando(true);
    setErroDoServidor(null);
    const erroDePrazo = new Error(
      "A internet demorou demais. O lançamento pode ter sido salvo; se salvar de novo sem mudar os campos, não duplica.",
    );
    // Mesmo conteúdo de uma tentativa que não deu resposta (mesmo em outra
    // abertura do formulário) reaproveita a chave dela: se aquela gravação ainda
    // estiver viva no servidor, esta devolve o mesmo lançamento em vez de somar.
    const conteudo = JSON.stringify(resultado.payload);
    const chave = chaveEmAbertoDoConteudo(conteudo) ?? chaveDaTentativa.current;
    guardarChaveEmAberto(conteudo, chave);
    try {
      // O prazo solta a tela, mas não cancela a gravação no servidor.
      const ids = await aguardarComPrazo(
        salvarLancamento({
          ...resultado.payload,
          chave_idempotencia: chave,
        }),
        30_000,
        () => erroDePrazo,
      );
      esquecerChaveEmAberto(conteudo);
      confirmarVisualmente({
        titulo:
          ids.length > 1
            ? `${ids.length} parcelas lançadas.`
            : "Lançamento salvo.",
        descricao: resultado.payload.descricao,
        valor: resultado.payload.valor,
        sentido:
          resultado.payload.tipo === "transferencia"
            ? 0
            : resultado.payload.tipo === "entrada"
              ? 1
              : -1,
        linhas: [
          {
            rotulo: transferencia ? "Sai de" : "Conta",
            texto:
              contas.find((c) => c.id === resultado.payload.conta_id)?.nome ??
              "—",
          },
          ...(transferencia
            ? [
                {
                  rotulo: "Entra em",
                  texto:
                    contas.find(
                      (c) => c.id === resultado.payload.conta_destino_id,
                    )?.nome ?? "—",
                },
              ]
            : []),
          {
            rotulo: previsto ? "Vencimento" : "Data",
            texto: formatarData(
              resultado.payload.data_realizacao ??
                resultado.payload.data_vencimento ??
                "",
            ),
          },
          {
            rotulo: "Mês de referência",
            texto: formatarData(resultado.payload.data_competencia),
          },
        ],
        ...(transferencia
          ? {
              nota: "O dinheiro muda de conta. O saldo total da loja continua o mesmo; esta transferência fica fora do resultado.",
            }
          : {}),
      });
      aoSalvar(
        ids.length > 1
          ? `${ids.length} parcelas lançadas.`
          : "Lançamento salvo.",
      );
    } catch (erro) {
      setErroDoServidor(
        erro === erroDePrazo
          ? erroDePrazo.message
          : mensagemDeErroFinanceiro(erro),
      );
    } finally {
      enviandoRef.current = false;
      aoMudarEnviando?.(false);
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
      aoFechar={fechar}
      rodape={
        <div className="flex flex-col gap-3">
          {erroDoServidor ? <EstadoDeErro mensagem={erroDoServidor} /> : null}
          <div className="flex flex-col-reverse gap-3">
            <button
              type="button"
              onClick={fechar}
              disabled={enviando}
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
            { valor: "saida", rotulo: "Despesa", desabilitada: enviando },
            { valor: "entrada", rotulo: "Receita", desabilitada: enviando },
            {
              valor: "transferencia",
              rotulo: "Transferência",
              desabilitada: enviando,
            },
          ]}
        />

        <Campo
          id="fin-lanc-valor"
          rotulo={parcelas > 1 ? "Valor total (R$)" : "Valor (R$)"}
          erro={erros.valor}
        >
          <LocalBufferedInput
            id="fin-lanc-valor"
            disabled={enviando}
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
            disabled={enviando}
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
            ajuda="É a categoria que coloca o valor na linha certa do resultado."
          >
            <select
              id="fin-lanc-categoria"
              disabled={enviando}
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

        <div className={transferencia ? "grid grid-cols-1 gap-5" : ""}>
          <Campo
            id="fin-lanc-conta"
            rotulo={transferencia ? "Sai de" : "Conta"}
            erro={erros.contaId}
          >
            <select
              id="fin-lanc-conta"
              disabled={enviando}
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
                disabled={enviando}
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
              {
                valor: "realizado",
                rotulo: rotuloSituacao.feito,
                desabilitada: enviando,
              },
              {
                valor: "previsto",
                rotulo: rotuloSituacao.pendente,
                desabilitada: enviando,
              },
            ]}
          />
        )}

        <div className="grid grid-cols-1 gap-5">
          {previsto ? (
            <Campo
              id="fin-lanc-vencimento"
              rotulo={parcelas > 1 ? "1º vencimento" : "Vencimento"}
              erro={erros.dataVencimento}
            >
              <input
                id="fin-lanc-vencimento"
                disabled={enviando}
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
                disabled={enviando}
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
            rotulo="Mês de referência"
            erro={erros.dataCompetencia}
          >
            <input
              id="fin-lanc-competencia"
              disabled={enviando}
              type="date"
              value={form.dataCompetencia}
              onChange={(e) => atualizar({ dataCompetencia: e.target.value })}
              className={CLASSE_CAMPO}
            />
          </Campo>
        </div>
        {transferencia ? (
          <p className="-mt-2 text-xs leading-relaxed text-zinc-400">
            Referência do registro. Transferências entre contas ficam fora do
            resultado; não alteram o lucro.
          </p>
        ) : (
          <p className="-mt-2 text-xs leading-relaxed text-zinc-400">
            Mês de referência é o mês a que o valor pertence (o resultado conta
            por ele); pode ser diferente do dia em que o dinheiro se mexe.
            Qualquer dia do mês serve; nos filtros por dia, vale a data
            escolhida.
          </p>
        )}

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
              disabled={enviando}
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
              disabled={enviando}
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
            disabled={enviando}
            value={form.observacao}
            maxLength={500}
            rows={2}
            onFlush={(observacao) => atualizar({ observacao })}
            className={`${CLASSE_CAMPO} min-h-[72px] py-2`}
          />
        </Campo>
        <section
          aria-label="Confira antes de salvar"
          className="mt-3 rounded-3xl border border-white/10 bg-[#17171C] p-4"
        >
          <h3 className="text-base font-bold text-white">
            Confira antes de salvar
          </h3>
          <dl className="mt-4 flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-zinc-400">Valor total</dt>
              <dd className="text-2xl font-bold">
                {valorDigitado === null ? (
                  "—"
                ) : (
                  <Dinheiro valor={valorDigitado} />
                )}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-zinc-400">
                {previsto
                  ? parcelas > 1
                    ? "1º vencimento"
                    : "Vencimento"
                  : transferencia
                    ? "Data"
                    : receita
                      ? "Recebido em"
                      : "Pago em"}
              </dt>
              <dd className="font-bold">
                {formatarData(
                  previsto ? form.dataVencimento : form.dataRealizacao,
                )}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-zinc-400">Mês de referência</dt>
              <dd className="font-bold">
                {formatarData(form.dataCompetencia)}
              </dd>
            </div>
            {transferencia ? (
              <>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-zinc-400">Sai de</dt>
                  <dd className="break-words font-bold">
                    {contas.find((c) => c.id === form.contaId)?.nome ?? "—"}
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-zinc-400">Entra em</dt>
                  <dd className="break-words font-bold">
                    {contas.find((c) => c.id === form.contaDestinoId)?.nome ??
                      "—"}
                  </dd>
                </div>
              </>
            ) : null}
            {previsto ? (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-400">Parcelas</dt>
                <dd className="font-bold">{parcelas}×</dd>
              </div>
            ) : null}
          </dl>
        </section>
        {transferencia ? (
          <p className="rounded-2xl bg-violet-400/5 p-3 text-xs leading-relaxed text-zinc-400">
            Sempre realizada, entre contas da loja. Não muda o total da loja e
            fica fora do resultado. Sem categoria, forma ou parcelas.
          </p>
        ) : null}
        {enviando ? (
          <p
            role="status"
            className="rounded-2xl bg-sky-400/5 p-3 text-xs leading-relaxed text-zinc-300"
          >
            Salvando… Os campos e o fechamento estão bloqueados durante o envio.
          </p>
        ) : null}
      </form>
    </FolhaFinanceira>
  );
}
