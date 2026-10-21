import {
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleCheck,
  Info,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import {
  abrirCaixa,
  fecharCaixa,
  movimentarCaixa,
} from "@/hooks/useFinanceiro";
import {
  VALOR_MAXIMO,
  diferencaDoFechamento,
  ehDivergenciaDoCaixa,
  mensagemDeErroFinanceiro,
  parseValorBR,
} from "@/lib/financeiro";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import {
  CONTA_CAIXA_DA_LOJA,
  type CaixaAtual,
  type ContaFinanceira,
  type FechamentoDeCaixa,
} from "@/types/financeiro";
import { FolhaFinanceira } from "./FolhaFinanceira";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CAMPO,
  CLASSE_ROTULO_DO_CARTAO,
  Campo,
  Dinheiro,
  EstadoDeErro,
  useConfirmacaoFinanceira,
} from "./partes";
import {
  chaveDaTentativaDoCaixa,
  esquecerTentativaDoCaixa,
} from "./tentativasDoCaixa";

/** Contas que podem ser gaveta: as do tipo caixa (a de sistema primeiro). */
function contasDeCaixa(contas: readonly ContaFinanceira[]): ContaFinanceira[] {
  const caixas = contas.filter((c) => c.ativa && c.tipo === "caixa");
  return [
    ...caixas.filter((c) => c.id === CONTA_CAIXA_DA_LOJA),
    ...caixas.filter((c) => c.id !== CONTA_CAIXA_DA_LOJA),
  ];
}

function RodapeDeAcao({
  erro,
  rotulo,
  rotuloEnviando,
  enviando,
  aoConfirmar,
  aoVoltar,
}: {
  readonly erro: string | null;
  readonly rotulo: string;
  readonly rotuloEnviando: string;
  readonly enviando: boolean;
  readonly aoConfirmar: () => void;
  readonly aoVoltar: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {erro ? <EstadoDeErro mensagem={erro} /> : null}
      <div className="flex flex-col-reverse gap-3">
        <button
          type="button"
          onClick={aoVoltar}
          className={`${CLASSE_BOTAO_SECUNDARIO} flex-1`}
        >
          Voltar
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={aoConfirmar}
          className={`${CLASSE_BOTAO_PRIMARIO} flex-[2]`}
        >
          {enviando ? rotuloEnviando : rotulo}
        </button>
      </div>
    </div>
  );
}

/** Estado de envio com trava síncrona contra toque duplo. */
function useEnvio(
  aoMudarEnviando?: (enviando: boolean) => void,
  aoDivergir?: (erro: unknown) => Promise<void>,
) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const trava = useRef(false);
  async function enviar(acao: () => Promise<void>) {
    if (trava.current) return;
    trava.current = true;
    aoMudarEnviando?.(true);
    setEnviando(true);
    setErro(null);
    try {
      await acao();
    } catch (falha) {
      if (aoDivergir && ehDivergenciaDoCaixa(falha)) {
        try {
          await aoDivergir(falha);
        } catch (falhaDaRecarga) {
          setErro(
            `${mensagemDeErroFinanceiro(falha)} ${mensagemDeErroFinanceiro(falhaDaRecarga)}`,
          );
        }
      } else setErro(mensagemDeErroFinanceiro(falha));
    } finally {
      trava.current = false;
      setEnviando(false);
      aoMudarEnviando?.(false);
    }
  }
  return { enviando, erro, enviar };
}

/** "Abrir caixa": o dinheiro CONTADO na gaveta vira o valor de abertura. */
export function AbrirCaixaFolha({
  contas,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly contas: readonly ContaFinanceira[];
  readonly aoFechar: () => void;
  readonly aoSalvar: (mensagem: string) => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const confirmarVisualmente = useConfirmacaoFinanceira();
  const caixas = useMemo(() => contasDeCaixa(contas), [contas]);
  const contaPadrao = caixas.at(0)?.id ?? CONTA_CAIXA_DA_LOJA;
  const [valor, setValor] = useState("");
  const [contaId, setContaId] = useState(contaPadrao);
  const [tentou, setTentou] = useState(false);
  const { enviando, erro, enviar } = useEnvio();

  useEffect(() => {
    aoMudarSujo(valor !== "");
  }, [valor, aoMudarSujo]);

  const numero = parseValorBR(valor);
  const erroValor =
    tentou && (numero === null || numero < 0)
      ? "Conte o dinheiro da gaveta e informe o valor (pode ser 0,00)."
      : tentou && numero !== null && numero > VALOR_MAXIMO
        ? "Valor acima do limite."
        : undefined;

  function confirmar() {
    setTentou(true);
    if (numero === null || numero < 0 || numero > VALOR_MAXIMO) return;
    void enviar(async () => {
      await abrirCaixa({ valorAbertura: numero, contaId });
      confirmarVisualmente({
        titulo: "Caixa aberto.",
        descricao:
          caixas.find((c) => c.id === contaId)?.nome ?? "Caixa da loja",
        valor: numero,
        rotuloValor: "Troco inicial",
        linhas: [
          {
            rotulo: "Troco inicial",
            texto: "Notas e moedas contadas na abertura",
          },
        ],
      });
      aoSalvar("Caixa aberto.");
    });
  }

  const nomeDaConta = caixas.find((c) => c.id === contaId)?.nome;

  return (
    <FolhaFinanceira
      titulo="Abrir caixa"
      icone={Archive}
      matiz="#2DD4BF"
      descricao="Antes de vender, conte o dinheiro da gaveta."
      aoFechar={aoFechar}
      rodape={
        <RodapeDeAcao
          erro={erro}
          rotulo="Abrir caixa"
          rotuloEnviando="Abrindo…"
          enviando={enviando}
          aoConfirmar={confirmar}
          aoVoltar={aoFechar}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Campo
          id="fin-caixa-abertura"
          rotulo="Dinheiro na gaveta (R$)"
          erro={erroValor}
          ajuda="Troco inicial: notas e moedas contadas. Pode ser 0,00."
        >
          <LocalBufferedInput
            id="fin-caixa-abertura"
            value={valor}
            mask="currency"
            inputMode="numeric"
            placeholder="0,00"
            autoComplete="off"
            onFlush={setValor}
            className={`${CLASSE_CAMPO} text-xl font-black tabular-nums`}
          />
        </Campo>
        {caixas.length > 1 ? (
          <Campo id="fin-caixa-conta" rotulo="Qual caixa">
            <select
              id="fin-caixa-conta"
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              className={CLASSE_CAMPO}
            >
              {caixas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Campo>
        ) : (
          <p className="text-xs text-zinc-400">
            Conta:{" "}
            <strong className="text-zinc-300">
              {nomeDaConta ?? "Caixa da loja"}
            </strong>
          </p>
        )}
      </div>
    </FolhaFinanceira>
  );
}

/** Sangria (tira dinheiro da gaveta) ou suprimento (coloca troco). */
export function MovimentarCaixaFolha({
  autorId,
  aoReconciliar,
  aoMudarEnviando,
  sessaoId,
  movimento,
  esperado,
  contas,
  contaDoCaixa,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly autorId: string | null;
  readonly aoReconciliar: (mensagem: string) => Promise<void>;
  readonly aoMudarEnviando: (enviando: boolean) => void;
  readonly sessaoId: string;
  readonly movimento: "sangria" | "suprimento";
  readonly esperado: number;
  readonly contas: readonly ContaFinanceira[];
  readonly contaDoCaixa: string | null;
  readonly aoFechar: () => void;
  readonly aoSalvar: (mensagem: string, tom?: "sucesso" | "informacao") => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const confirmarVisualmente = useConfirmacaoFinanceira();
  const sangria = movimento === "sangria";
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [contrapartida, setContrapartida] = useState("");
  const chave = useRef<string | null>(null);
  const [tentou, setTentou] = useState(false);
  function esquecer() {
    esquecerTentativaDoCaixa(autorId, sessaoId, movimento, chave.current);
    chave.current = null;
  }
  const { enviando, erro, enviar } = useEnvio(
    aoMudarEnviando,
    async (falha) => {
      await aoReconciliar(mensagemDeErroFinanceiro(falha));
      esquecer();
    },
  );

  useEffect(() => {
    aoMudarSujo(
      valor !== "" || descricao.trim() !== "" || contrapartida !== "",
    );
  }, [valor, descricao, contrapartida, aoMudarSujo]);

  const numero = parseValorBR(valor);
  const erroValor =
    tentou && (numero === null || numero <= 0)
      ? "Informe um valor maior que zero."
      : tentou && numero !== null && numero > VALOR_MAXIMO
        ? "Valor acima do limite."
        : undefined;
  const passaDoEsperado =
    sangria &&
    numero !== null &&
    Math.round(numero * 100) > Math.round(esperado * 100);

  const outrasContas = contas.filter((c) => c.ativa && c.id !== contaDoCaixa);

  function confirmar() {
    setTentou(true);
    if (numero === null || numero <= 0 || numero > VALOR_MAXIMO) return;
    void enviar(async () => {
      // Campos podem mudar, identidade não: o servidor devolve o original
      // ou recusa a divergência, sem gravar uma segunda transferência.
      chave.current ??= chaveDaTentativaDoCaixa(autorId, sessaoId, movimento);
      const enviada = {
        sessaoId,
        chave: chave.current,
        tipo: movimento,
        valor: numero,
        descricao:
          descricao.trim() ||
          (sangria ? "Sangria do caixa" : "Suprimento do caixa"),
        contaContrapartida: contrapartida || null,
      };
      const resultado = await movimentarCaixa(enviada);
      esquecer();
      if (resultado.status !== "realizado") {
        aoSalvar(
          "Operação localizada no histórico. Confira a situação do lançamento antes de tentar de novo.",
          "informacao",
        );
        return;
      }
      if (resultado.replay) {
        aoSalvar(
          sangria
            ? "Esta sangria já estava registrada por uma tentativa anterior; nada novo foi gravado. Se esta é outra sangria, registre de novo."
            : "Este suprimento já estava registrado por uma tentativa anterior; nada novo foi gravado. Se este é outro suprimento, registre de novo.",
          "informacao",
        );
        return;
      }
      confirmarVisualmente({
        titulo: sangria ? "Sangria registrada." : "Suprimento registrado.",
        descricao: enviada.descricao,
        valor: enviada.valor,
        sentido: sangria ? -1 : 1,
        linhas: [
          {
            rotulo: sangria ? "Saiu de" : "Entrou em",
            texto:
              contas.find((c) => c.id === contaDoCaixa)?.nome ??
              "Caixa da loja",
          },
          {
            rotulo: "Contrapartida",
            texto:
              contas.find((c) => c.id === enviada.contaContrapartida)?.nome ??
              "Nenhuma conta da loja",
          },
        ],
      });
      aoSalvar(sangria ? "Sangria registrada." : "Suprimento registrado.");
    });
  }

  return (
    <FolhaFinanceira
      titulo={sangria ? "Sangria" : "Suprimento"}
      icone={sangria ? ArrowUpFromLine : ArrowDownToLine}
      matiz={sangria ? "#FF9F5A" : "#2DD4BF"}
      descricao={
        sangria
          ? "Tirar dinheiro da gaveta: banco ou cofre."
          : "Colocar troco na gaveta."
      }
      aoFechar={aoFechar}
      rodape={
        <RodapeDeAcao
          erro={erro}
          rotulo={sangria ? "Registrar sangria" : "Registrar suprimento"}
          rotuloEnviando="Registrando…"
          enviando={enviando}
          aoConfirmar={confirmar}
          aoVoltar={aoFechar}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Campo id="fin-caixa-mov-valor" rotulo="Valor (R$)" erro={erroValor}>
          <LocalBufferedInput
            id="fin-caixa-mov-valor"
            value={valor}
            mask="currency"
            inputMode="numeric"
            placeholder="0,00"
            autoComplete="off"
            onFlush={setValor}
            className={`${CLASSE_CAMPO} text-xl font-black tabular-nums`}
          />
        </Campo>
        {sangria ? (
          <dl className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <dt className="text-zinc-400">Esperado na gaveta</dt>
            <dd className="text-xl font-bold">
              <Dinheiro valor={esperado} />
            </dd>
          </dl>
        ) : null}
        {passaDoEsperado ? (
          <p
            className={cn(
              "flex items-start gap-2 rounded-xl p-3 text-xs",
              classeDoTexto("atencao"),
            )}
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span>
              É mais do que o esperado na gaveta (<Dinheiro valor={esperado} />
              ). Confira a contagem antes de registrar.
            </span>
          </p>
        ) : null}
        {passaDoEsperado ? (
          <p className="text-xs text-zinc-400">
            O aviso não impede o registro.
          </p>
        ) : null}
        <Campo id="fin-caixa-mov-descricao" rotulo="Descrição">
          <LocalBufferedInput
            id="fin-caixa-mov-descricao"
            value={descricao}
            maxLength={140}
            placeholder={
              sangria ? "Ex.: depósito no banco" : "Ex.: troco para o dia"
            }
            onFlush={setDescricao}
            className={CLASSE_CAMPO}
          />
        </Campo>
        <Campo
          id="fin-caixa-mov-conta"
          rotulo={
            sangria ? "Para onde foi (opcional)" : "De onde veio (opcional)"
          }
          ajuda="Se saiu para outra conta da loja ou veio dela, escolha-a. O valor muda de conta, sem virar despesa."
        >
          <select
            id="fin-caixa-mov-conta"
            value={contrapartida}
            onChange={(e) => setContrapartida(e.target.value)}
            className={CLASSE_CAMPO}
          >
            <option value="">Nenhuma conta da loja</option>
            {outrasContas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
      </div>
    </FolhaFinanceira>
  );
}

/**
 * "Fechar caixa": a lojista conta a gaveta, a tela compara com o esperado
 * na hora e explica o que acontece com a diferença. Depois de fechado, a
 * folha mostra o resultado que o SERVIDOR calculou (pode ter entrado venda
 * em dinheiro enquanto ela contava).
 */
export function FecharCaixaFolha({
  aoReconciliar,
  aoMudarEnviando,
  caixa,
  aoFechar,
  aoFechado,
  aoMudarSujo,
}: {
  readonly aoReconciliar: (mensagem: string) => Promise<void>;
  readonly aoMudarEnviando: (enviando: boolean) => void;
  readonly caixa: CaixaAtual;
  readonly aoFechar: () => void;
  /** Chamado assim que o servidor confirma (a tela atualiza por baixo). */
  readonly aoFechado: () => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [tentou, setTentou] = useState(false);
  const [resultado, setResultado] = useState<FechamentoDeCaixa | null>(null);
  const { enviando, erro, enviar } = useEnvio(
    aoMudarEnviando,
    async (falha) => {
      await aoReconciliar(mensagemDeErroFinanceiro(falha));
    },
  );

  useEffect(() => {
    aoMudarSujo(
      resultado === null && (valor !== "" || observacao.trim() !== ""),
    );
  }, [valor, observacao, resultado, aoMudarSujo]);

  const contado = parseValorBR(valor);
  const erroValor =
    tentou && (contado === null || contado < 0)
      ? "Conte a gaveta e informe o valor (pode ser 0,00)."
      : tentou && contado !== null && contado > VALOR_MAXIMO
        ? "Valor acima do limite."
        : undefined;
  const previa =
    contado !== null && contado >= 0
      ? diferencaDoFechamento(caixa.esperado, contado)
      : null;

  function confirmar() {
    setTentou(true);
    if (contado === null || contado < 0 || contado > VALOR_MAXIMO) return;
    void enviar(async () => {
      const fechamento = await fecharCaixa({
        sessaoId: caixa.id,
        valorContado: contado,
        observacao: observacao.trim() || null,
      });
      setResultado(fechamento);
      aoFechado();
    });
  }

  if (resultado) {
    const final = diferencaDoFechamento(resultado.esperado, resultado.contado);
    return (
      <FolhaFinanceira
        titulo="Caixa fechado"
        icone={CircleCheck}
        matiz="#2DD4BF"
        aoFechar={aoFechar}
        rodape={
          <button
            type="button"
            onClick={aoFechar}
            className={CLASSE_BOTAO_PRIMARIO}
          >
            Concluir
          </button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-emerald-300">
            <CircleCheck aria-hidden="true" className="size-5" />
            <p className="text-sm font-bold">Fechamento registrado.</p>
          </div>
          <ComparativoDoFechamento
            esperado={resultado.esperado}
            contado={resultado.contado}
            diferenca={resultado.diferenca}
            situacao={final.situacao}
          />
        </div>
      </FolhaFinanceira>
    );
  }

  return (
    <FolhaFinanceira
      titulo="Fechar caixa"
      icone={Archive}
      matiz="#2DD4BF"
      descricao={`${caixa.contaNome} — conte a gaveta e informe o total.`}
      aoFechar={aoFechar}
      rodape={
        <RodapeDeAcao
          erro={erro}
          rotulo="Fechar caixa"
          rotuloEnviando="Fechando…"
          enviando={enviando}
          aoConfirmar={confirmar}
          aoVoltar={aoFechar}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Campo
          id="fin-caixa-contado"
          rotulo="Dinheiro contado (R$)"
          erro={erroValor}
        >
          <LocalBufferedInput
            id="fin-caixa-contado"
            value={valor}
            mask="currency"
            inputMode="numeric"
            placeholder="0,00"
            autoComplete="off"
            onFlush={setValor}
            className={`${CLASSE_CAMPO} text-xl font-black tabular-nums`}
          />
        </Campo>
        <p className="text-xs leading-relaxed text-zinc-400">
          O servidor confirma os valores ao fechar. A prévia pode mudar durante
          a contagem.
        </p>
        <ComparativoDoFechamento
          esperado={caixa.esperado}
          contado={previa ? (contado ?? 0) : null}
          diferenca={previa?.diferenca ?? null}
          situacao={previa?.situacao ?? null}
        />
        <p className="flex items-start gap-2 rounded-xl border border-admin-border bg-admin-surface p-3 text-xs text-zinc-400">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            A diferença gera um lançamento automático:{" "}
            <strong className="text-zinc-200">Quebra de caixa</strong> (faltou
            dinheiro) ou{" "}
            <strong className="text-zinc-200">Sobra de caixa</strong> (sobrou).
            O saldo passa a ser o contado.
          </span>
        </p>
        <Campo id="fin-caixa-observacao" rotulo="Observação (opcional)">
          <LocalBufferedTextarea
            id="fin-caixa-observacao"
            value={observacao}
            maxLength={500}
            rows={2}
            placeholder="Ex.: troco dado a mais na venda das 15h"
            onFlush={setObservacao}
            className={`${CLASSE_CAMPO} py-2`}
          />
        </Campo>
      </div>
    </FolhaFinanceira>
  );
}

function ComparativoDoFechamento({
  esperado,
  contado,
  diferenca,
  situacao,
}: {
  readonly esperado: number | null;
  readonly contado: number | null;
  readonly diferenca: number | null;
  readonly situacao: "bateu" | "sobra" | "quebra" | null;
}) {
  const rotuloDiferenca =
    situacao === "sobra"
      ? "Sobra"
      : situacao === "quebra"
        ? "Quebra"
        : situacao === "bateu"
          ? "Bateu"
          : "Diferença";
  return (
    <dl
      className="flex flex-col gap-3 rounded-3xl border border-admin-border bg-admin-raised p-4"
      aria-label="Esperado, contado e diferença"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 py-2">
        <dt className={CLASSE_ROTULO_DO_CARTAO}>Esperado</dt>
        <dd className="text-2xl font-bold text-white">
          {esperado === null ? "—" : <Dinheiro valor={esperado} />}
        </dd>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 py-2">
        <dt className={CLASSE_ROTULO_DO_CARTAO}>Contado</dt>
        <dd className="text-2xl font-bold text-white">
          {contado === null ? "—" : <Dinheiro valor={contado} />}
        </dd>
      </div>
      <div
        className={
          situacao === null
            ? "flex flex-wrap items-baseline justify-between gap-2 border-t border-admin-border py-3"
            : cn(
                "flex flex-wrap items-baseline justify-between gap-2 border-t border-admin-border py-3",
              )
        }
      >
        <dt className={CLASSE_ROTULO_DO_CARTAO}>{rotuloDiferenca}</dt>
        <dd
          className={cn(
            "text-2xl font-bold",
            situacao === "quebra" && classeDoTexto("negativo"),
            situacao === "sobra" && classeDoTexto("atencao"),
            situacao === "bateu" && classeDoTexto("positivo"),
          )}
        >
          {diferenca === null ? "—" : <Dinheiro valor={diferenca} comSinal />}
        </dd>
      </div>
    </dl>
  );
}
