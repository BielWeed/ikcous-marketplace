import { AlertTriangle, CircleCheck, Info } from "lucide-react";
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
  mensagemDeErroFinanceiro,
  parseValorBR,
} from "@/lib/financeiro";
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
  Campo,
  Dinheiro,
  EstadoDeErro,
} from "./partes";

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
      <div className="flex gap-3">
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
function useEnvio() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const trava = useRef(false);
  async function enviar(acao: () => Promise<void>) {
    if (trava.current) return;
    trava.current = true;
    setEnviando(true);
    setErro(null);
    try {
      await acao();
    } catch (falha) {
      setErro(mensagemDeErroFinanceiro(falha));
    } finally {
      trava.current = false;
      setEnviando(false);
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
      aoSalvar("Caixa aberto.");
    });
  }

  const nomeDaConta = caixas.find((c) => c.id === contaId)?.nome;

  return (
    <FolhaFinanceira
      titulo="Abrir caixa"
      descricao="Conte o dinheiro que já está na gaveta antes da primeira venda."
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
          ajuda="Troco inicial: notas e moedas contadas agora."
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
          <p className="text-xs text-zinc-500">
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
  movimento,
  esperado,
  contas,
  contaDoCaixa,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly movimento: "sangria" | "suprimento";
  readonly esperado: number;
  readonly contas: readonly ContaFinanceira[];
  readonly contaDoCaixa: string | null;
  readonly aoFechar: () => void;
  readonly aoSalvar: (mensagem: string) => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const sangria = movimento === "sangria";
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [contrapartida, setContrapartida] = useState("");
  const [tentou, setTentou] = useState(false);
  const { enviando, erro, enviar } = useEnvio();

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
      await movimentarCaixa({
        tipo: movimento,
        valor: numero,
        descricao:
          descricao.trim() ||
          (sangria ? "Sangria do caixa" : "Suprimento do caixa"),
        contaContrapartida: contrapartida || null,
      });
      aoSalvar(sangria ? "Sangria registrada." : "Suprimento registrado.");
    });
  }

  return (
    <FolhaFinanceira
      titulo={sangria ? "Sangria" : "Suprimento"}
      descricao={
        sangria
          ? "Tirar dinheiro da gaveta (levar ao banco, guardar no cofre)."
          : "Colocar dinheiro na gaveta (troco que chegou)."
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
        {passaDoEsperado ? (
          <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
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
        <Campo id="fin-caixa-mov-descricao" rotulo="Descrição">
          <LocalBufferedInput
            id="fin-caixa-mov-descricao"
            value={descricao}
            maxLength={200}
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
          ajuda="Se o dinheiro foi para (ou veio de) outra conta da loja, escolha-a: o valor sai de uma e entra na outra, sem virar despesa."
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
  caixa,
  aoFechar,
  aoFechado,
  aoMudarSujo,
}: {
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
  const { enviando, erro, enviar } = useEnvio();

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
        <ComparativoDoFechamento
          esperado={caixa.esperado}
          contado={previa ? (contado ?? 0) : null}
          diferenca={previa?.diferenca ?? null}
          situacao={previa?.situacao ?? null}
        />
        <p className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-400">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Se o contado não bater com o esperado, a diferença vira um
            lançamento automático de{" "}
            <strong className="text-zinc-200">Quebra de caixa</strong> (faltou
            dinheiro) ou{" "}
            <strong className="text-zinc-200">Sobra de caixa</strong> (sobrou).
            Assim o saldo do caixa fica igual ao dinheiro que está de verdade na
            gaveta.
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
      className="grid grid-cols-3 gap-2"
      aria-label="Esperado, contado e diferença"
    >
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <dt className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
          Esperado
        </dt>
        <dd className="mt-1 text-sm font-black text-white">
          {esperado === null ? "—" : <Dinheiro valor={esperado} />}
        </dd>
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <dt className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
          Contado
        </dt>
        <dd className="mt-1 text-sm font-black text-white">
          {contado === null ? "—" : <Dinheiro valor={contado} />}
        </dd>
      </div>
      <div
        className={cn(
          "rounded-xl border p-3",
          situacao === "quebra" && "border-red-500/30 bg-red-500/10",
          situacao === "sobra" && "border-amber-500/30 bg-amber-500/10",
          situacao === "bateu" && "border-emerald-500/30 bg-emerald-500/10",
          situacao === null && "border-white/5 bg-white/[0.02]",
        )}
      >
        <dt className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
          {rotuloDiferenca}
        </dt>
        <dd
          className={cn(
            "mt-1 text-sm font-black",
            situacao === "quebra" && "text-red-300",
            situacao === "sobra" && "text-amber-200",
            situacao === "bateu" && "text-emerald-300",
          )}
        >
          {diferenca === null ? "—" : <Dinheiro valor={diferenca} comSinal />}
        </dd>
      </div>
    </dl>
  );
}
