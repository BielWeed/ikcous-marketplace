// A folha onde o DONO configura ou altera o cadastro fiscal da loja (regime,
// atividade, abertura da empresa e mês em que começou a vender pelo IKCOUS).
//
// Quem barra de verdade é o banco (`fiscal_cadastro_salvar`: só o dono, 42501 para
// o resto, e tabela `dono_da_loja` vazia recusa todo mundo). Esta folha ESPELHA
// isso: `situacao` diz se quem olha pode gravar; fora de "sou o dono" os campos e o
// Salvar ficam travados e o Salvar NÃO chama o servidor, nem à força (clique ou
// Enter). A trava é por `aria-disabled` com a razão por escrito, ligada por
// `aria-describedby` (não só cor).
//
// Validação ESPELHANDO o banco, em português simples: `montarPayloadDoCadastro`
// (src/lib/fiscal/cadastro.ts) cobre regime, atividade, abertura no futuro e o mês
// do começo das vendas; o banco recusa também abertura antes de 1900 e começo das
// vendas antes de janeiro de 2020, e isso é conferido AQUI, para a lojista não
// levar a recusa do servidor. O mês (`yyyy-mm`, campo de mês) vira `yyyy-mm-01`.
//
// Gravar é UMA chamada e nunca repete sozinha. "Sem resposta" (rede ou prazo) pode
// ter gravado: a folha manda conferir e PARA o Salvar até a lojista fechar (o
// cartão relê o cadastro ao fechar). Folha suja pergunta antes de fechar.

import { Landmark } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import {
  ErroDoCadastroFiscal,
  salvarCadastroFiscal,
} from "@/hooks/useImpostos";
import { mensagemDeErroFinanceiro } from "@/lib/financeiro";
import {
  ATIVIDADES_FISCAIS,
  type CadastroFiscal,
  type ErrosDoCadastroFiscal,
  REGIMES_FISCAIS,
  type ResultadoDoCadastroFiscal,
  montarPayloadDoCadastro,
} from "@/lib/fiscal/cadastro";
import {
  type SituacaoDoDono,
  fraseDaSituacaoDoDono,
  rotuloDaAtividade,
  rotuloDoRegime,
} from "@/lib/fiscal/textos";
import { cn } from "@/lib/utils";
import type { DataIso } from "@/types/financeiro";

import { FolhaFinanceira } from "../FolhaFinanceira";
import { ContextoDoDescarte, type EstadoDoDescarte } from "../descarte";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_CAMPO,
  Campo,
  EstadoDeErro,
} from "../partes";

// O banco recusa antes disto (22023). Mesmas datas da migration do cadastro.
const PRIMEIRA_ABERTURA: DataIso = "1900-01-01";
const PRIMEIRO_MES_DAS_VENDAS: DataIso = "2020-01-01";

const FRASE_ABERTURA_ANTIGA = "A data de abertura não pode ser antes de 1900.";
const FRASE_VENDAS_ANTIGAS =
  "O mês em que começou a vender não pode ser antes de janeiro de 2020.";

/** O que a lojista digita. O mês vem como `yyyy-mm` (campo de mês). */
interface FormularioDaFolha {
  regime: string;
  atividade: string;
  /** `yyyy-mm-dd` ou `""`. */
  abertaEm: string;
  /** `yyyy-mm` ou `""`. */
  vendeMes: string;
}

function formularioInicial(cadastro: CadastroFiscal | null): FormularioDaFolha {
  return {
    regime: cadastro?.regime ?? "",
    atividade: cadastro?.atividade ?? "",
    abertaEm: cadastro?.abertaEm ?? "",
    vendeMes: cadastro?.vendeNoAppDesde?.slice(0, 7) ?? "",
  };
}

/**
 * As regras do cadastro + as faixas de data do banco. Com qualquer erro NÃO há
 * payload. O erro que o cadastro.ts já achou num campo nunca é trocado por outro.
 */
function validar(
  form: FormularioDaFolha,
  hoje: DataIso,
): ResultadoDoCadastroFiscal {
  const vendeTexto = form.vendeMes.trim();
  const base = montarPayloadDoCadastro(
    {
      regime: form.regime,
      atividade: form.atividade,
      abertaEm: form.abertaEm,
      // O campo de mês entrega `yyyy-mm`; o banco guarda sempre o dia 1.
      vendeNoAppDesde: vendeTexto === "" ? "" : `${vendeTexto}-01`,
    },
    hoje,
  );
  const erros: ErrosDoCadastroFiscal = base.ok ? {} : { ...base.erros };

  const aberta = form.abertaEm.trim();
  if (!erros.abertaEm && aberta !== "" && aberta < PRIMEIRA_ABERTURA) {
    erros.abertaEm = FRASE_ABERTURA_ANTIGA;
  }
  if (
    !erros.vendeNoAppDesde &&
    vendeTexto !== "" &&
    `${vendeTexto}-01` < PRIMEIRO_MES_DAS_VENDAS
  ) {
    erros.vendeNoAppDesde = FRASE_VENDAS_ANTIGAS;
  }

  if (base.ok && Object.keys(erros).length === 0) return base;
  return { ok: false, erros };
}

// Só há uma folha de cadastro por vez, então os ids são fixos (como os do Financeiro).
const ID_REGIME = "fiscal-cadastro-regime";
const ID_ATIVIDADE = "fiscal-cadastro-atividade";
const ID_ABERTA_EM = "fiscal-cadastro-aberta-em";
const ID_VENDE_DESDE = "fiscal-cadastro-vende-desde";

/** O id do primeiro campo (na ordem da tela) que tem erro, ou `null`. */
function primeiroCampoComErro(erros: ErrosDoCadastroFiscal): string | null {
  if (erros.regime) return ID_REGIME;
  if (erros.atividade) return ID_ATIVIDADE;
  if (erros.abertaEm) return ID_ABERTA_EM;
  if (erros.vendeNoAppDesde) return ID_VENDE_DESDE;
  return null;
}

/** `aria-describedby` do campo: o alerta de erro, só enquanto há erro. */
function ligacaoDoErro(
  id: string,
  erro: string | undefined,
): string | undefined {
  return erro ? `${id}-erro` : undefined;
}

export interface CadastroFiscalFolhaProps {
  /** O cadastro de hoje; `null` = a loja ainda não configurou. */
  readonly cadastro: CadastroFiscal | null;
  readonly hoje: DataIso;
  /** A situação do dono (`useDonoDaLoja`): só "sou_o_dono" deixa gravar. */
  readonly situacao: SituacaoDoDono;
  /** Fecha de verdade (X, véu e Esc já passaram pela pergunta de descarte). */
  readonly aoFechar: () => void;
  /** O banco confirmou a gravação. */
  readonly aoSalvar: () => void;
  /** A gravação ficou sem resposta: o cartão relê o cadastro ao fechar a folha. */
  readonly aoSemResposta: () => void;
}

export function CadastroFiscalFolha({
  cadastro,
  hoje,
  situacao,
  aoFechar,
  aoSalvar,
  aoSemResposta,
}: CadastroFiscalFolhaProps) {
  const ids = useId();
  const idDaRazao = `${ids}-razao`;
  const idDoAviso = `${ids}-aviso`;
  const permitido = situacao === "sou_o_dono";
  const razaoDaTrava = fraseDaSituacaoDoDono(situacao);

  const [inicial] = useState(() => formularioInicial(cadastro));
  const [form, setForm] = useState(inicial);
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  // Sem resposta pode ter gravado: o Salvar fica parado até fechar e conferir.
  const [semResposta, setSemResposta] = useState(false);
  const [perguntando, setPerguntando] = useState(false);
  // Trava síncrona (o estado só chega no próximo render): dois cliques seguidos
  // não mandam duas gravações, e enquanto grava nada fecha a folha.
  const gravando = useRef(false);

  // Depois de "sem resposta" o rascunho pode já estar gravado: fechar não pergunta.
  const sujo = !semResposta && JSON.stringify(form) !== JSON.stringify(inicial);

  const validacao = useMemo(() => validar(form, hoje), [form, hoje]);
  const erros: ErrosDoCadastroFiscal =
    tentou && !validacao.ok ? validacao.erros : {};

  function atualizar(parcial: Partial<FormularioDaFolha>) {
    setForm((atual) => ({ ...atual, ...parcial }));
    // A frase de "sem resposta" fica: ela manda conferir antes de repetir.
    if (!semResposta) setErroDoServidor(null);
  }

  function pedirParaFechar() {
    if (gravando.current) return;
    if (perguntando) {
      setPerguntando(false);
      return;
    }
    if (sujo) {
      setPerguntando(true);
      return;
    }
    aoFechar();
  }

  async function salvar() {
    // A trava do dono vale ANTES de qualquer outra coisa: nem à força vai ao servidor.
    if (!permitido || gravando.current || semResposta) return;
    setTentou(true);
    const resultado = validar(form, hoje);
    if (!resultado.ok) {
      // O foco vai ao primeiro campo errado (os campos já estão na tela).
      const primeiro = primeiroCampoComErro(resultado.erros);
      if (primeiro) document.getElementById(primeiro)?.focus();
      return;
    }
    gravando.current = true;
    setEnviando(true);
    setErroDoServidor(null);
    try {
      await salvarCadastroFiscal(resultado.payload);
      aoSalvar();
    } catch (erro) {
      if (erro instanceof ErroDoCadastroFiscal) {
        if (erro.semResposta) {
          setSemResposta(true);
          aoSemResposta();
        }
        setErroDoServidor(erro.message);
      } else {
        setErroDoServidor(mensagemDeErroFinanceiro(erro));
      }
    } finally {
      gravando.current = false;
      setEnviando(false);
    }
  }

  const descarte: EstadoDoDescarte = useMemo(
    () => ({
      sujo,
      perguntando,
      aoContinuar: () => setPerguntando(false),
      aoDescartar: aoFechar,
    }),
    [sujo, perguntando, aoFechar],
  );

  // Campos travados: gravando, ou quem olha não é o dono.
  const parado = enviando || !permitido;
  const salvarTravado = !permitido || semResposta;

  return (
    <ContextoDoDescarte.Provider value={descarte}>
      <FolhaFinanceira
        titulo={
          cadastro ? "Alterar cadastro fiscal" : "Configurar cadastro fiscal"
        }
        icone={Landmark}
        descricao="Diga o regime e a atividade da sua empresa. É por eles que o IKCOUS sabe se pode mostrar o medidor do MEI ou a estimativa do Simples."
        aoFechar={pedirParaFechar}
        fecharBloqueado={enviando}
        rodape={
          <div className="flex flex-col gap-3">
            {razaoDaTrava ? (
              <p
                id={idDaRazao}
                className="text-sm leading-relaxed text-zinc-300"
              >
                {razaoDaTrava}
              </p>
            ) : null}
            {erroDoServidor ? (
              <div id={idDoAviso}>
                <EstadoDeErro mensagem={erroDoServidor} />
              </div>
            ) : null}
            <button
              type="button"
              disabled={enviando}
              aria-disabled={salvarTravado ? true : undefined}
              aria-describedby={
                !permitido && razaoDaTrava
                  ? idDaRazao
                  : semResposta && erroDoServidor
                    ? idDoAviso
                    : undefined
              }
              onClick={() => void salvar()}
              className={cn(
                CLASSE_BOTAO_PRIMARIO,
                "aria-disabled:cursor-not-allowed aria-disabled:bg-admin-hover aria-disabled:text-zinc-400",
              )}
            >
              {enviando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        }
      >
        <form
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            void salvar();
          }}
          className="flex flex-col gap-4"
        >
          <Campo id={ID_REGIME} rotulo="Regime da empresa" erro={erros.regime}>
            <select
              id={ID_REGIME}
              value={form.regime}
              disabled={parado}
              aria-invalid={erros.regime ? true : undefined}
              aria-describedby={ligacaoDoErro(ID_REGIME, erros.regime)}
              onChange={(e) => atualizar({ regime: e.target.value })}
              className={CLASSE_CAMPO}
            >
              <option value="">Escolha…</option>
              {REGIMES_FISCAIS.map((regime) => (
                <option key={regime} value={regime}>
                  {rotuloDoRegime(regime)}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id={ID_ATIVIDADE}
            rotulo="O que a empresa faz"
            erro={erros.atividade}
            ajuda="Só comércio: vende apenas produtos. Tem serviço: também presta algum serviço."
          >
            <select
              id={ID_ATIVIDADE}
              value={form.atividade}
              disabled={parado}
              aria-invalid={erros.atividade ? true : undefined}
              aria-describedby={ligacaoDoErro(ID_ATIVIDADE, erros.atividade)}
              onChange={(e) => atualizar({ atividade: e.target.value })}
              className={CLASSE_CAMPO}
            >
              <option value="">Escolha…</option>
              {ATIVIDADES_FISCAIS.map((atividade) => (
                <option key={atividade} value={atividade}>
                  {rotuloDaAtividade(atividade)}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id={ID_ABERTA_EM}
            rotulo="Data de abertura da empresa (opcional)"
            erro={erros.abertaEm}
            ajuda="Se não souber, deixe em branco."
          >
            <input
              id={ID_ABERTA_EM}
              type="date"
              min={PRIMEIRA_ABERTURA}
              max={hoje}
              value={form.abertaEm}
              disabled={parado}
              aria-invalid={erros.abertaEm ? true : undefined}
              aria-describedby={ligacaoDoErro(ID_ABERTA_EM, erros.abertaEm)}
              onChange={(e) => atualizar({ abertaEm: e.target.value })}
              className={CLASSE_CAMPO}
            />
          </Campo>
          <Campo
            id={ID_VENDE_DESDE}
            rotulo="Vende pelo IKCOUS desde (opcional)"
            erro={erros.vendeNoAppDesde}
            ajuda="Escolha só o mês e o ano (formato AAAA-MM)."
          >
            <input
              id={ID_VENDE_DESDE}
              type="month"
              min={PRIMEIRO_MES_DAS_VENDAS.slice(0, 7)}
              max={hoje.slice(0, 7)}
              placeholder="AAAA-MM"
              value={form.vendeMes}
              disabled={parado}
              aria-invalid={erros.vendeNoAppDesde ? true : undefined}
              aria-describedby={ligacaoDoErro(
                ID_VENDE_DESDE,
                erros.vendeNoAppDesde,
              )}
              onChange={(e) => atualizar({ vendeMes: e.target.value })}
              className={CLASSE_CAMPO}
            />
          </Campo>
        </form>
      </FolhaFinanceira>
    </ContextoDoDescarte.Provider>
  );
}
