// O cartão do CADASTRO FISCAL na aba Impostos: o regime e a atividade da loja, o
// CNPJ (de "Dados da empresa"), as últimas alterações e o botão que abre a folha.
//
// REGRA DE PERMISSÃO (plano da Gestão Fiscal, seção 4): só o DONO da loja altera.
// O banco é quem barra (`fiscal_cadastro_salvar` recusa com 42501 e, com a tabela
// `dono_da_loja` vazia, recusa todo mundo); o cartão espelha isso e escreve o caminho:
//
//   carregando        travado, sem frase
//   sou o dono        editável
//   há dono, não eu   só leitura + "Só o dono da loja altera o cadastro fiscal."
//   SEM dono          só leitura + o caminho (suporte cadastra o dono, recarregar)
//   leitura falhou    só leitura + "Não deu para confirmar quem pode alterar." +
//                     "Tentar de novo" (que RELÊ o dono)
//
// ATENÇÃO: "sem dono" aqui é TRAVADO. `usePodeTrocarCredenciais` faz o contrário
// (libera) e NÃO serve para este cartão: o banco do cadastro fiscal não libera.
// "Não consegui ler" nunca vira "sem dono": é o que `leituraFalhou` separa.
//
// A trava usa `aria-disabled` e não `disabled`: o botão continua alcançável por
// teclado e leitor de tela, com a razão ligada por `aria-describedby`; o clique
// no botão travado não faz nada. Caderno e CSV não passam por aqui e funcionam em
// todos os estados.
//
// O cadastro (`consulta`) vem da aba, que já o lê para decidir o que mostrar: o
// cartão não lê duas vezes e, ao gravar, `consulta.recarregar()` atualiza os dois.
//
// CADASTRO VELHO NUNCA ABRE A FOLHA: salvar (ou fechar a folha de uma gravação sem
// resposta) manda reler, e até a leitura nova chegar a tela ainda tem o cadastro de
// ANTES. A folha guarda os valores de quando abre; abrir nesse intervalo e salvar só
// uma data devolveria o regime antigo sem aviso. Então o botão fica travado (com
// "Atualizando o cadastro…") enquanto a consulta carrega E enquanto `dados` for o
// mesmo objeto de quando se mandou reler (a leitura nova é sempre outro objeto).
// Se a releitura falha, segue travado e "Tentar de novo" relê.

import {
  CircleCheck,
  History,
  Landmark,
  Lock,
  RefreshCw,
  Store,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import {
  type EstadoDoDono,
  limparDonoDaLoja,
  useDonoDaLoja,
} from "@/hooks/useDonoDaLoja";
import type { ConsultaFinanceira } from "@/hooks/useFinanceiro";
import {
  type LinhaDoLogFiscal,
  useLogDoCadastroFiscal,
} from "@/hooks/useImpostos";
import { formatarData, formatarHora, hojeEmSaoPaulo } from "@/lib/financeiro";
import {
  ATIVIDADES_FISCAIS,
  type CadastroFiscal as CadastroFiscalLido,
  type LeituraDoCadastroFiscal,
  REGIMES_FISCAIS,
} from "@/lib/fiscal/cadastro";
import {
  ROTULO_TENTAR_DE_NOVO,
  type SituacaoDoDono,
  fraseDaSituacaoDoDono,
  rotuloDaAtividade,
  rotuloDoRegime,
} from "@/lib/fiscal/textos";
import { identidadeLegalDaLoja } from "@/lib/identidade-legal-da-loja";
import { cn } from "@/lib/utils";
import type { DataIso } from "@/types/financeiro";

import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CASCA_DO_CARTAO,
  CartaoSecao,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
} from "../partes";
import { CadastroFiscalFolha } from "./CadastroFiscalFolha";

export interface CadastroFiscalProps {
  /** A leitura do cadastro (`useCadastroFiscal`), a mesma que a aba usa. */
  readonly consulta: ConsultaFinanceira<LeituraDoCadastroFiscal>;
  /** A aba está à vista: só então o cartão lê as últimas alterações. */
  readonly ativo: boolean;
  /** Sobe depois de uma escrita: tudo que lê o cadastro relê. */
  readonly versao: number;
  /** O dia de hoje em São Paulo (`hojeEmSaoPaulo`), como no resto do Financeiro. */
  readonly hoje: DataIso;
  /** Leva a Minha loja › Dados da empresa, onde o CNPJ se preenche. */
  readonly aoIrParaMinhaLoja: () => void;
}

const CLASSE_BOTAO_TRAVAVEL =
  "aria-disabled:cursor-not-allowed aria-disabled:text-zinc-400";

const FRASE_ATUALIZANDO = "Atualizando o cadastro…";
const FRASE_NAO_ATUALIZOU = "Não deu para atualizar o cadastro agora.";
// Quando não dá para saber quem é o autor: nunca se afirma "Outra pessoa" no escuro.
const AUTOR_NAO_CONFIRMADO = "Autor não confirmado";

/** As cinco situações da tabela da seção 4, a partir do que `useDonoDaLoja` devolve. */
function situacaoDoDono(dono: EstadoDoDono): SituacaoDoDono {
  if (dono.carregando) return "carregando";
  // Antes de tudo: "não consegui ler" nunca vira "sem dono" nem "outro é o dono".
  if (dono.leituraFalhou) return "leitura_falhou";
  if (dono.souODono) return "sou_o_dono";
  if (dono.donoId === null) return "sem_dono";
  return "outro_e_o_dono";
}

// ---------------------------------------------------------------------------
// Últimas alterações
// ---------------------------------------------------------------------------

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function rotuloDeRegimeGuardado(valor: unknown): string {
  const regime = REGIMES_FISCAIS.find((r) => r === valor);
  return regime ? rotuloDoRegime(regime) : "valor que o app não conhece";
}

function rotuloDeAtividadeGuardada(valor: unknown): string {
  const atividade = ATIVIDADES_FISCAIS.find((a) => a === valor);
  return atividade
    ? rotuloDaAtividade(atividade)
    : "valor que o app não conhece";
}

function dataGuardada(valor: unknown): string | null {
  return typeof valor === "string" && formatarData(valor) !== "—"
    ? formatarData(valor)
    : null;
}

function mesGuardado(valor: unknown): string | null {
  return typeof valor === "string" && formatarData(valor) !== "—"
    ? formatarData(valor).slice(3)
    : null;
}

/** O que mudou numa alteração, em frases curtas ("Regime: MEI → Simples Nacional"). */
function oQueMudou(antes: unknown, depois: unknown): string[] {
  const dep = comoObjeto(depois);
  if (!dep) return ["Cadastro alterado"];
  const ant = comoObjeto(antes);
  if (!ant) {
    return [
      `Cadastro criado: ${rotuloDeRegimeGuardado(dep.regime)}, ${rotuloDeAtividadeGuardada(dep.atividade)}`,
    ];
  }
  const linhas: string[] = [];
  if (ant.regime !== dep.regime) {
    linhas.push(
      `Regime: ${rotuloDeRegimeGuardado(ant.regime)} → ${rotuloDeRegimeGuardado(dep.regime)}`,
    );
  }
  if (ant.atividade !== dep.atividade) {
    linhas.push(
      `Atividade: ${rotuloDeAtividadeGuardada(ant.atividade)} → ${rotuloDeAtividadeGuardada(dep.atividade)}`,
    );
  }
  if (ant.aberta_em !== dep.aberta_em) {
    linhas.push(
      `Abertura: ${dataGuardada(ant.aberta_em) ?? "não informada"} → ${dataGuardada(dep.aberta_em) ?? "não informada"}`,
    );
  }
  if (ant.vende_no_app_desde !== dep.vende_no_app_desde) {
    linhas.push(
      `Vende pelo IKCOUS desde: ${mesGuardado(ant.vende_no_app_desde) ?? "não informado"} → ${mesGuardado(dep.vende_no_app_desde) ?? "não informado"}`,
    );
  }
  return linhas.length > 0 ? linhas : ["Cadastro salvo sem mudança"];
}

function quandoFoi(quando: string): string {
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return "Data desconhecida";
  return `${formatarData(hojeEmSaoPaulo(data))} às ${formatarHora(quando)}`;
}

function UltimasAlteracoes({
  linhas,
  quemE,
}: {
  readonly linhas: readonly LinhaDoLogFiscal[];
  readonly quemE: (quem: string | null) => string;
}) {
  return (
    <div className="mt-5 min-w-0">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
        <History aria-hidden="true" className="size-4 shrink-0 text-zinc-400" />
        Últimas alterações
      </h3>
      <ol className="mt-3 flex flex-col gap-2">
        {linhas.map((linha) => (
          <li
            key={linha.id}
            className={cn(CLASSE_CASCA_DO_CARTAO, "min-w-0 p-3")}
          >
            <p className="break-words text-xs text-zinc-400">
              {quandoFoi(linha.quando)} · {quemE(linha.quem)}
            </p>
            {oQueMudou(linha.antes, linha.depois).map((frase) => (
              <p
                key={frase}
                className="mt-1 break-words text-sm leading-relaxed text-zinc-200"
              >
                {frase}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O cartão
// ---------------------------------------------------------------------------

function LinhaDoCadastro({
  rotulo,
  children,
}: {
  readonly rotulo: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs font-semibold text-zinc-400">{rotulo}</dt>
      <dd className="min-w-0 break-words text-sm font-bold text-white">
        {children}
      </dd>
    </div>
  );
}

function DadosDoCadastro({
  cadastro,
  documento,
  aoIrParaMinhaLoja,
}: {
  readonly cadastro: CadastroFiscalLido;
  readonly documento: { tipo: "cpf" | "cnpj" | null; texto: string } | null;
  readonly aoIrParaMinhaLoja: () => void;
}) {
  return (
    <dl className="flex flex-col gap-3">
      <LinhaDoCadastro rotulo="Regime">
        {rotuloDoRegime(cadastro.regime)}
      </LinhaDoCadastro>
      <LinhaDoCadastro rotulo="Atividade">
        {rotuloDaAtividade(cadastro.atividade)}
      </LinhaDoCadastro>
      <LinhaDoCadastro rotulo={documento?.tipo === "cpf" ? "CPF" : "CNPJ"}>
        {documento ? (
          documento.texto
        ) : (
          <span className="flex flex-col items-start gap-2 font-normal">
            <span className="text-zinc-300">
              Não preenchido em Dados da empresa.
            </span>
            <button
              type="button"
              onClick={aoIrParaMinhaLoja}
              className={CLASSE_BOTAO_SECUNDARIO}
            >
              <Store aria-hidden="true" className="size-4" />
              Preencher em Minha loja
            </button>
          </span>
        )}
      </LinhaDoCadastro>
      <LinhaDoCadastro rotulo="Abertura da empresa">
        {cadastro.abertaEm ? formatarData(cadastro.abertaEm) : "Não informada"}
      </LinhaDoCadastro>
      <LinhaDoCadastro rotulo="Vende pelo IKCOUS desde">
        {cadastro.vendeNoAppDesde
          ? formatarData(cadastro.vendeNoAppDesde).slice(3)
          : "Não informado"}
      </LinhaDoCadastro>
    </dl>
  );
}

interface CartaoProps extends CadastroFiscalProps {
  /** Lê o dono de novo (a leitura que falhou). */
  readonly aoReler: () => void;
}

function CartaoDoCadastro({
  consulta,
  ativo,
  versao,
  hoje,
  aoIrParaMinhaLoja,
  aoReler,
}: CartaoProps) {
  const dono = useDonoDaLoja();
  // Quem está logado: é daqui que sai o "Você" do histórico, não da leitura do dono.
  const euId = useAuth()?.user?.id ?? null;
  const { config } = useStore();
  const ids = useId();
  const idDaFrase = `${ids}-frase`;

  const { dados, carregando, erro, recarregar } = consulta;

  // O cadastro que a tela tinha quando se mandou reler (o de ANTES da gravação).
  // Enquanto `dados` for esse mesmo objeto, a leitura nova ainda não chegou.
  const [lidoAntes, setLidoAntes] = useState<{
    readonly dados: typeof dados;
  } | null>(null);
  const dadosAgora = useRef(dados);
  useEffect(() => {
    dadosAgora.current = dados;
  });
  const cadastroVelho = lidoAntes !== null && lidoAntes.dados === dados;
  const atualizando = carregando || cadastroVelho;
  const releituraFalhou = cadastroVelho && !carregando && erro !== null;

  const situacao = situacaoDoDono(dono);
  const ehDono = situacao === "sou_o_dono";
  // A frase do dono tem a vez; "atualizando" só aparece para quem PODE alterar.
  const fraseDoAtualizando = ehDono && atualizando;
  const frase =
    fraseDaSituacaoDoDono(situacao) ??
    (fraseDoAtualizando
      ? releituraFalhou
        ? FRASE_NAO_ATUALIZOU
        : FRASE_ATUALIZANDO
      : null);
  const podeAlterar = ehDono && !atualizando;

  const [aberta, setAberta] = useState(false);
  const [salvoAgora, setSalvoAgora] = useState(false);
  // Gravação sem resposta: ao fechar a folha o cadastro é lido de novo.
  const gravouSemConfirmar = useRef(false);
  // Relê as últimas alterações depois de uma escrita (a aba também pode subir `versao`).
  const [releituraDoLog, setReleituraDoLog] = useState(0);

  const log = useLogDoCadastroFiscal(
    ativo && dados !== null,
    versao + releituraDoLog,
  );

  const identidade = identidadeLegalDaLoja(config);
  const documento = identidade?.documento
    ? { tipo: identidade.tipoDoDocumento, texto: identidade.documento }
    : null;

  function abrir() {
    // A trava vale também para o clique que chega ao botão travado (aria-disabled).
    if (!podeAlterar) return;
    setSalvoAgora(false);
    setAberta(true);
  }

  const reler = useCallback(() => {
    // Marca o cadastro de agora como "de antes": a folha não abre com ele.
    setLidoAntes({ dados: dadosAgora.current });
    recarregar();
    setReleituraDoLog((n) => n + 1);
  }, [recarregar]);

  const fechar = useCallback(() => {
    setAberta(false);
    if (gravouSemConfirmar.current) {
      gravouSemConfirmar.current = false;
      reler();
    }
  }, [reler]);

  function aoSalvar() {
    gravouSemConfirmar.current = false;
    setAberta(false);
    setSalvoAgora(true);
    reler();
  }

  // O dono só é "conhecido" com a leitura terminada, sem falha e com alguém lá.
  const donoConhecido =
    !dono.carregando && !dono.leituraFalhou && dono.donoId !== null;
  function quemE(quem: string | null): string {
    if (quem === null) return "Não registrado";
    if (euId !== null && quem === euId) return "Você";
    if (donoConhecido && quem === dono.donoId) return "O dono da loja";
    if (donoConhecido && euId !== null) return "Outra pessoa";
    return AUTOR_NAO_CONFIRMADO;
  }

  // O botão e a frase que a trava mostra (ou o botão de reler, na leitura falha).
  const rotuloDoBotao =
    dados?.estado === "com_cadastro" ? "Alterar" : "Configurar";
  const botao = (
    <button
      type="button"
      aria-disabled={podeAlterar ? undefined : true}
      aria-describedby={!podeAlterar && frase ? idDaFrase : undefined}
      onClick={abrir}
      className={cn(
        dados?.estado === "com_cadastro"
          ? CLASSE_BOTAO_SECUNDARIO
          : CLASSE_BOTAO_PRIMARIO,
        CLASSE_BOTAO_TRAVAVEL,
        "w-full sm:w-auto",
      )}
    >
      {rotuloDoBotao}
    </button>
  );
  const blocoDaFrase =
    !podeAlterar && frase ? (
      <div className="flex min-w-0 flex-col items-start gap-3">
        <p
          id={idDaFrase}
          className="flex items-start gap-2 text-sm leading-relaxed text-zinc-300"
        >
          {fraseDoAtualizando ? (
            <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          )}
          {frase}
        </p>
        {situacao === "leitura_falhou" || releituraFalhou ? (
          <button
            type="button"
            onClick={situacao === "leitura_falhou" ? aoReler : reler}
            className={CLASSE_BOTAO_SECUNDARIO}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {ROTULO_TENTAR_DE_NOVO}
          </button>
        ) : null}
      </div>
    ) : null;

  const folha = aberta ? (
    <CadastroFiscalFolha
      cadastro={dados?.estado === "com_cadastro" ? dados.cadastro : null}
      hoje={hoje}
      situacao={situacao}
      aoFechar={fechar}
      aoSalvar={aoSalvar}
      aoSemResposta={() => {
        gravouSemConfirmar.current = true;
      }}
    />
  ) : null;

  // Primeira leitura do cadastro: esqueleto, sem estado vazio nem botão.
  if (dados === null && carregando) {
    return (
      <CartaoSecao titulo="Cadastro fiscal">
        <EsqueletoDeLista linhas={3} />
      </CartaoSecao>
    );
  }
  // Sem nada para mostrar e a leitura falhou: a frase pronta e "Tentar de novo".
  if (dados === null) {
    return (
      <CartaoSecao titulo="Cadastro fiscal">
        <EstadoDeErro
          mensagem={erro ?? "Não deu para ler o cadastro fiscal agora."}
          aoTentarDeNovo={recarregar}
        />
      </CartaoSecao>
    );
  }

  if (dados.estado === "sem_cadastro") {
    return (
      <>
        <div aria-busy={carregando || undefined}>
          <EstadoVazio
            icone={Landmark}
            titulo="Configure o regime da sua empresa"
            texto={
              dados.aviso ??
              "Sem o regime, o IKCOUS não mostra estimativa nem medidor de imposto, e não chuta nenhum. É só dizer uma vez. O caderno de guias e o arquivo para o contador funcionam do mesmo jeito."
            }
            acao={
              situacao === "sem_dono" || situacao === "leitura_falhou" ? (
                blocoDaFrase
              ) : (
                <>
                  {blocoDaFrase}
                  {botao}
                </>
              )
            }
          />
        </div>
        {folha}
      </>
    );
  }

  return (
    <>
      <CartaoSecao
        titulo="Cadastro fiscal"
        subtitulo="O regime e a atividade da sua empresa. A estimativa de imposto depende deles."
        acao={botao}
      >
        <div aria-busy={carregando || undefined}>
          {salvoAgora ? (
            <p
              role="status"
              className="mb-4 flex items-center gap-2 text-sm font-bold text-emerald-300"
            >
              <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
              Cadastro fiscal salvo.
            </p>
          ) : null}
          {erro ? (
            <p role="alert" className="mb-4 text-xs text-amber-300">
              Não deu para atualizar agora; este é o último cadastro lido.{" "}
              {erro}
            </p>
          ) : null}
          {blocoDaFrase ? <div className="mb-4">{blocoDaFrase}</div> : null}
          <DadosDoCadastro
            cadastro={dados.cadastro}
            documento={documento}
            aoIrParaMinhaLoja={aoIrParaMinhaLoja}
          />
          {log.dados && log.dados.length > 0 ? (
            <UltimasAlteracoes linhas={log.dados} quemE={quemE} />
          ) : null}
          {log.erro && !log.dados ? (
            <p role="alert" className="mt-5 text-xs text-zinc-400">
              Não deu para ler as últimas alterações agora.
            </p>
          ) : null}
        </div>
      </CartaoSecao>
      {folha}
    </>
  );
}

export function CadastroFiscal(props: CadastroFiscalProps) {
  // "Tentar de novo" na leitura do dono: o hook guarda a resposta da sessão e só
  // lê quando o componente nasce; apagar o que ele guardou e remontar o cartão
  // (nova `key`) faz a leitura de verdade acontecer outra vez.
  const [leitura, setLeitura] = useState(0);
  const reler = useCallback(() => {
    limparDonoDaLoja();
    setLeitura((n) => n + 1);
  }, []);
  return <CartaoDoCadastro key={leitura} {...props} aoReler={reler} />;
}
