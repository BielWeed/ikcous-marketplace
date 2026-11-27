// "Exportar para o contador": escolhe o mês e o ano, lê as linhas do período (por
// `buscarLinhas`, que a aba liga ao banco) e baixa o CSV de `csv-do-contador.ts`.
//
// Componente de apresentação: não conhece o banco nem a loja. Duas regras de honestidade:
//  - período sem nada NÃO baixa arquivo (um CSV só com cabeçalho pareceria "esta loja não
//    vendeu nada"); a tela diz por quê;
//  - erro de leitura NÃO baixa arquivo parcial; a tela oferece "Tentar de novo".
// O nome do arquivo vem do gerador e não leva nome nem dado da loja.

import { Download, Loader2, RefreshCw } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";

import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { hojeEmSaoPaulo } from "@/lib/financeiro";
import {
  type EntradaDoCsvDoContador,
  type ModoDoCsv,
  montarCsvDoContador,
} from "@/lib/fiscal/csv-do-contador";
import { cn } from "@/lib/utils";

import { CLASSE_BOTAO_SECUNDARIO, CartaoSecao } from "../partes";

/** O período pedido: `AAAA-MM` no modo mensal, `AAAA` no anual (a mesma referência do gerador). */
export interface PeriodoDoCsv {
  readonly modo: ModoDoCsv;
  readonly referencia: string;
}

/** O que o gerador precisa além do período: o extrato e as guias do período. */
export type LinhasDoCsv = Pick<EntradaDoCsvDoContador, "extrato" | "guias">;

interface Props {
  /** Lê as linhas do período. Deve rejeitar (nunca devolver parcial) se a leitura falhar. */
  readonly buscarLinhas: (periodo: PeriodoDoCsv) => Promise<LinhasDoCsv>;
  /** Relógio de fora, para o mês e o ano iniciais (e para o teste). */
  readonly agora?: Date;
}

type Aviso = {
  readonly tipo: "ok" | "vazio" | "erro";
  readonly periodo: PeriodoDoCsv;
} | null;

const MESES = [
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

// Na lista o mês abre com maiúscula ("Março"); na frase do aviso fica minúsculo
// ("março de 2026"). O valor é o `MM` do período.
const OPCOES_DO_MES: readonly OpcaoDaLista[] = MESES.map((nome, i) => ({
  valor: String(i + 1).padStart(2, "0"),
  rotulo: nome.charAt(0).toUpperCase() + nome.slice(1),
}));

const QUANTOS_ANOS_PARA_TRAS = 5;

function nomeDoPeriodo({ modo, referencia }: PeriodoDoCsv): string {
  if (modo === "anual") return referencia;
  const [ano, mes] = referencia.split("-");
  return `${MESES[Number(mes) - 1]} de ${ano}`;
}

function textoDoAviso(aviso: NonNullable<Aviso>): string {
  const nome = nomeDoPeriodo(aviso.periodo);
  switch (aviso.tipo) {
    case "ok":
      return `Arquivo de ${nome} baixado. Procure na pasta de downloads do aparelho.`;
    case "vazio":
      return `Não há vendas, devoluções ou guias em ${nome}, então nenhum arquivo foi baixado.`;
    case "erro":
      return `Não deu para ler os dados de ${nome}, então nenhum arquivo foi baixado.`;
  }
}

/** Mesma técnica da exportação de pedidos do painel (Blob + link temporário). */
function baixarCsv(nomeDoArquivo: string, texto: string) {
  const url = URL.createObjectURL(
    new Blob([texto], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Aguarda o navegador iniciar o download antes de liberar o endereço.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const CLASSE_BOTAO = cn(
  CLASSE_BOTAO_SECUNDARIO,
  "w-full aria-disabled:cursor-not-allowed aria-disabled:text-zinc-400",
);

function BotaoDeExportar({
  rotulo,
  gerando,
  ocupado,
  refDoBotao,
  aoClicar,
}: {
  readonly rotulo: string;
  readonly gerando: boolean;
  readonly ocupado: boolean;
  readonly refDoBotao: RefObject<HTMLButtonElement | null>;
  readonly aoClicar: () => void;
}) {
  // `aria-disabled` (e não `disabled`) para o foco não sumir do botão enquanto lê.
  return (
    <button
      ref={refDoBotao}
      type="button"
      aria-disabled={ocupado}
      aria-busy={gerando ? true : undefined}
      onClick={aoClicar}
      className={CLASSE_BOTAO}
    >
      {gerando ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <Download aria-hidden="true" className="size-4" />
      )}
      {gerando ? "Gerando…" : rotulo}
    </button>
  );
}

export function ExportarParaContador({ buscarLinhas, agora }: Props) {
  const idBase = useId();
  const idMes = `${idBase}-mes`;
  const idAno = `${idBase}-ano`;

  const hoje = hojeEmSaoPaulo(agora);
  const anoAtual = Number(hoje.slice(0, 4));
  const [mes, setMes] = useState(hoje.slice(5, 7));
  const [ano, setAno] = useState(String(anoAtual));
  const [emCurso, setEmCurso] = useState<ModoDoCsv | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);

  // Trava síncrona: dois cliques no mesmo instante não leem duas vezes.
  const ocupadoRef = useRef(false);
  // Tela fechada antes da resposta: não baixa arquivo que ninguém está esperando.
  const vivoRef = useRef(true);
  const botaoMesRef = useRef<HTMLButtonElement>(null);
  const botaoAnoRef = useRef<HTMLButtonElement>(null);
  const botaoNovamenteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  // Erro: o foco vai para a saída dele (o botão aparece só agora).
  const tipoDoAviso = aviso?.tipo;
  useEffect(() => {
    if (tipoDoAviso === "erro") botaoNovamenteRef.current?.focus();
  }, [tipoDoAviso]);

  async function exportar(periodo: PeriodoDoCsv) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setEmCurso(periodo.modo);
    setAviso(null);
    try {
      const linhas = await buscarLinhas(periodo);
      if (!vivoRef.current) return;
      const csv = montarCsvDoContador({ ...periodo, ...linhas });
      if (csv === null) {
        setAviso({ tipo: "vazio", periodo });
        return;
      }
      baixarCsv(csv.nomeDoArquivo, csv.texto);
      setAviso({ tipo: "ok", periodo });
    } catch {
      if (vivoRef.current) setAviso({ tipo: "erro", periodo });
    } finally {
      ocupadoRef.current = false;
      if (vivoRef.current) setEmCurso(null);
    }
  }

  function tentarDeNovo(periodo: PeriodoDoCsv) {
    // O botão do erro some ao recomeçar: o foco volta antes para o botão de origem.
    (periodo.modo === "mensal" ? botaoMesRef : botaoAnoRef).current?.focus();
    void exportar(periodo);
  }

  const opcoesDoAno: OpcaoDaLista[] = Array.from(
    { length: QUANTOS_ANOS_PARA_TRAS + 1 },
    (_, i) => {
      const a = String(anoAtual - i);
      return { valor: a, rotulo: a };
    },
  );

  return (
    <CartaoSecao
      titulo="Arquivo para o contador"
      subtitulo="Receita por dia, devoluções, guias lançadas e guias pagas, em uma planilha (CSV) que abre no Excel."
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <CampoDeEscolha
            id={idMes}
            rotulo="Mês"
            opcoes={OPCOES_DO_MES}
            valor={mes}
            aoMudar={setMes}
          />
          <CampoDeEscolha
            id={idAno}
            rotulo="Ano"
            opcoes={opcoesDoAno}
            valor={ano}
            aoMudar={setAno}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <BotaoDeExportar
            rotulo="Exportar mês"
            gerando={emCurso === "mensal"}
            ocupado={emCurso !== null}
            refDoBotao={botaoMesRef}
            aoClicar={() =>
              void exportar({ modo: "mensal", referencia: `${ano}-${mes}` })
            }
          />
          <BotaoDeExportar
            rotulo="Exportar ano"
            gerando={emCurso === "anual"}
            ocupado={emCurso !== null}
            refDoBotao={botaoAnoRef}
            aoClicar={() => void exportar({ modo: "anual", referencia: ano })}
          />
        </div>
        <p className="text-xs leading-relaxed text-zinc-400">
          “Exportar mês” usa o mês e o ano escolhidos; “Exportar ano” usa só o
          ano.
        </p>

        {/* A faixa fica sempre na tela: leitor de tela só anuncia texto que muda
            dentro de uma região que já existia. */}
        <div aria-live="polite" className="text-sm leading-relaxed">
          {aviso ? (
            <p
              className={
                aviso.tipo === "erro" ? "text-red-300" : "text-zinc-300"
              }
            >
              {textoDoAviso(aviso)}
            </p>
          ) : null}
        </div>

        {aviso?.tipo === "erro" ? (
          <button
            ref={botaoNovamenteRef}
            type="button"
            aria-disabled={emCurso !== null}
            onClick={() => tentarDeNovo(aviso.periodo)}
            className={cn(
              CLASSE_BOTAO,
              "min-[420px]:w-auto min-[420px]:self-start",
            )}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Tentar de novo
          </button>
        ) : null}
      </div>
    </CartaoSecao>
  );
}
