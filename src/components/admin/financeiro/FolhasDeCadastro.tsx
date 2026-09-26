import { Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Switch } from "@/components/ui/switch";
import { salvarCategoria, salvarConta } from "@/hooks/useFinanceiro";
import {
  type FormularioDaCategoria,
  type FormularioDaConta,
  TIPOS_DE_CONTA,
  ajudaDoGrupoDre,
  gruposDaNatureza,
  mensagemDeErroFinanceiro,
  rotuloDoGrupoDre,
  rotuloDoTipoDeConta,
  validarCategoria,
  validarConta,
} from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type {
  CategoriaFinanceira,
  ContaFinanceira,
  DataIso,
  NaturezaDaCategoria,
  TipoDeConta,
} from "@/types/financeiro";
import { FolhaFinanceira } from "./FolhaFinanceira";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CAMPO,
  CLASSE_ROTULO,
  Campo,
  EstadoDeErro,
  Segmentado,
} from "./partes";

function Rodape({
  erro,
  enviando,
  aoSalvar,
  aoVoltar,
}: {
  readonly erro: string | null;
  readonly enviando: boolean;
  readonly aoSalvar: () => void;
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
          Cancelar
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={aoSalvar}
          className={`${CLASSE_BOTAO_PRIMARIO} flex-[2]`}
        >
          {enviando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function AvisoDeSistema({ texto }: { readonly texto: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-400">
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {texto}
    </p>
  );
}

function LinhaDoInterruptor({
  id,
  rotulo,
  detalhe,
  ligado,
  desabilitado,
  aoMudar,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly detalhe: string;
  readonly ligado: boolean;
  readonly desabilitado: boolean;
  readonly aoMudar: (ligado: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className={CLASSE_ROTULO}>
          {rotulo}
        </label>
        <p className="text-[11px] text-zinc-500">{detalhe}</p>
      </div>
      <Switch
        id={id}
        checked={ligado}
        disabled={desabilitado}
        onCheckedChange={aoMudar}
        className="data-[state=checked]:bg-admin-gold"
      />
    </div>
  );
}

/** Criar ou editar uma conta (onde o dinheiro mora). */
export function ContaFolha({
  conta,
  hoje,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly conta: ContaFinanceira | null;
  readonly hoje: DataIso;
  readonly aoFechar: () => void;
  readonly aoSalvar: (mensagem: string) => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const [inicial] = useState<FormularioDaConta>(() => ({
    ...(conta ? { id: conta.id } : {}),
    nome: conta?.nome ?? "",
    tipo: conta?.tipo ?? "banco",
    saldoInicial: conta ? conta.saldoInicial.toFixed(2) : "",
    saldoInicialEm: conta?.saldoInicialEm ?? hoje,
    ativa: conta?.ativa ?? true,
  }));
  const [form, setForm] = useState(inicial);
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const trava = useRef(false);
  const sistema = conta?.sistema ?? false;

  const sujo = JSON.stringify(form) !== JSON.stringify(inicial);
  useEffect(() => {
    aoMudarSujo(sujo);
  }, [sujo, aoMudarSujo]);

  const validacao = useMemo(() => validarConta(form), [form]);
  const erros = tentou && !validacao.ok ? validacao.erros : {};

  const atualizar = (parcial: Partial<FormularioDaConta>) => {
    setForm((atual) => ({ ...atual, ...parcial }));
    setErroDoServidor(null);
  };

  async function salvar() {
    if (trava.current) return;
    setTentou(true);
    const resultado = validarConta(form);
    if (!resultado.ok) return;
    trava.current = true;
    setEnviando(true);
    try {
      await salvarConta(resultado.payload);
      aoSalvar(conta ? "Conta atualizada." : "Conta criada.");
    } catch (erro) {
      setErroDoServidor(mensagemDeErroFinanceiro(erro));
    } finally {
      trava.current = false;
      setEnviando(false);
    }
  }

  return (
    <FolhaFinanceira
      titulo={conta ? "Editar conta" : "Nova conta"}
      descricao="Onde o dinheiro da loja mora: gaveta, banco, Mercado Pago, cofre."
      aoFechar={aoFechar}
      rodape={
        <Rodape
          erro={erroDoServidor}
          enviando={enviando}
          aoSalvar={() => void salvar()}
          aoVoltar={aoFechar}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {sistema ? (
          <AvisoDeSistema texto="Conta do sistema: as vendas caem nela sozinhas, então o tipo é fixo e ela não pode ser desativada. O nome e o saldo inicial você ajusta." />
        ) : null}
        <Campo id="fin-conta-nome" rotulo="Nome" erro={erros.nome}>
          <LocalBufferedInput
            id="fin-conta-nome"
            value={form.nome}
            maxLength={60}
            placeholder="Ex.: Banco do Brasil"
            onFlush={(nome) => atualizar({ nome })}
            className={CLASSE_CAMPO}
          />
        </Campo>
        <Campo id="fin-conta-tipo" rotulo="Tipo">
          <select
            id="fin-conta-tipo"
            value={form.tipo}
            disabled={sistema}
            onChange={(e) => atualizar({ tipo: e.target.value as TipoDeConta })}
            className={CLASSE_CAMPO}
          >
            {TIPOS_DE_CONTA.map((tipo) => (
              <option key={tipo} value={tipo}>
                {rotuloDoTipoDeConta(tipo)}
              </option>
            ))}
          </select>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo
            id="fin-conta-saldo"
            rotulo="Saldo inicial (R$)"
            erro={erros.saldoInicial}
          >
            <LocalBufferedInput
              id="fin-conta-saldo"
              value={form.saldoInicial}
              mask="currency"
              inputMode="numeric"
              placeholder="0,00"
              onFlush={(saldoInicial) => atualizar({ saldoInicial })}
              className={`${CLASSE_CAMPO} tabular-nums`}
            />
          </Campo>
          <Campo
            id="fin-conta-data"
            rotulo="Na data"
            erro={erros.saldoInicialEm}
          >
            <input
              id="fin-conta-data"
              type="date"
              value={form.saldoInicialEm}
              onChange={(e) => atualizar({ saldoInicialEm: e.target.value })}
              className={CLASSE_CAMPO}
            />
          </Campo>
        </div>
        <p className="-mt-2 text-[11px] text-zinc-500">
          Quanto havia na conta nesse dia. O saldo de hoje é o saldo inicial
          mais tudo o que entrou e menos tudo o que saiu depois dessa data.
        </p>
        <LinhaDoInterruptor
          id="fin-conta-ativa"
          rotulo="Conta ativa"
          detalhe="Desativada, some das escolhas de novos lançamentos."
          ligado={form.ativa}
          desabilitado={sistema}
          aoMudar={(ativa) => atualizar({ ativa })}
        />
      </div>
    </FolhaFinanceira>
  );
}

/** Criar ou editar uma categoria (a linha da DRE onde o valor cai). */
export function CategoriaFolha({
  categoria,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly categoria: CategoriaFinanceira | null;
  readonly aoFechar: () => void;
  readonly aoSalvar: (mensagem: string) => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const [inicial] = useState<FormularioDaCategoria>(() => ({
    ...(categoria ? { id: categoria.id } : {}),
    nome: categoria?.nome ?? "",
    natureza: categoria?.natureza ?? "despesa",
    grupoDre: categoria?.grupoDre ?? "despesa_fixa",
    ativa: categoria?.ativa ?? true,
  }));
  const [form, setForm] = useState(inicial);
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const trava = useRef(false);
  const sistema = categoria?.sistema ?? false;

  const sujo = JSON.stringify(form) !== JSON.stringify(inicial);
  useEffect(() => {
    aoMudarSujo(sujo);
  }, [sujo, aoMudarSujo]);

  const validacao = useMemo(() => validarCategoria(form), [form]);
  const erros = tentou && !validacao.ok ? validacao.erros : {};
  const grupos = gruposDaNatureza(form.natureza);

  const atualizar = (parcial: Partial<FormularioDaCategoria>) => {
    setForm((atual) => ({ ...atual, ...parcial }));
    setErroDoServidor(null);
  };

  function mudarNatureza(natureza: NaturezaDaCategoria) {
    const permitidos = gruposDaNatureza(natureza);
    atualizar({
      natureza,
      grupoDre: permitidos.includes(form.grupoDre)
        ? form.grupoDre
        : (permitidos.at(0) ?? "fora_dre"),
    });
  }

  async function salvar() {
    if (trava.current) return;
    setTentou(true);
    const resultado = validarCategoria(form);
    if (!resultado.ok) return;
    trava.current = true;
    setEnviando(true);
    try {
      await salvarCategoria(resultado.payload);
      aoSalvar(categoria ? "Categoria atualizada." : "Categoria criada.");
    } catch (erro) {
      setErroDoServidor(mensagemDeErroFinanceiro(erro));
    } finally {
      trava.current = false;
      setEnviando(false);
    }
  }

  return (
    <FolhaFinanceira
      titulo={categoria ? "Editar categoria" : "Nova categoria"}
      descricao="A categoria diz em que linha da DRE o valor aparece."
      aoFechar={aoFechar}
      rodape={
        <Rodape
          erro={erroDoServidor}
          enviando={enviando}
          aoSalvar={() => void salvar()}
          aoVoltar={aoFechar}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {sistema ? (
          <AvisoDeSistema texto="Categoria do sistema: a natureza é fixa e ela não pode ser desativada — o app usa esta categoria sozinho." />
        ) : null}
        <Campo id="fin-categoria-nome" rotulo="Nome" erro={erros.nome}>
          <LocalBufferedInput
            id="fin-categoria-nome"
            value={form.nome}
            maxLength={60}
            placeholder="Ex.: Energia elétrica"
            onFlush={(nome) => atualizar({ nome })}
            className={CLASSE_CAMPO}
          />
        </Campo>
        <div className="flex flex-col gap-1.5">
          <span className={CLASSE_ROTULO}>Natureza</span>
          <Segmentado<NaturezaDaCategoria>
            rotulo="Natureza"
            valor={form.natureza}
            aoMudar={mudarNatureza}
            opcoes={[
              { valor: "despesa", rotulo: "Despesa", desabilitada: sistema },
              { valor: "receita", rotulo: "Receita", desabilitada: sistema },
            ]}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className={`${CLASSE_ROTULO} mb-1.5`}>Grupo da DRE</legend>
          {grupos.map((grupo) => {
            const escolhido = form.grupoDre === grupo;
            return (
              <label
                key={grupo}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                  escolhido
                    ? "border-admin-gold/50 bg-admin-gold/10"
                    : "border-white/5 bg-white/[0.02] hover:bg-white/5",
                )}
              >
                <input
                  type="radio"
                  name="fin-categoria-grupo"
                  value={grupo}
                  checked={escolhido}
                  onChange={() => atualizar({ grupoDre: grupo })}
                  className="mt-1 size-4 accent-[hsl(var(--admin-gold))]"
                />
                <span className="min-w-0 text-sm font-bold text-white">
                  {rotuloDoGrupoDre(grupo)}
                  <span className="block text-[11px] font-normal text-zinc-400">
                    {ajudaDoGrupoDre(grupo)}
                  </span>
                </span>
              </label>
            );
          })}
          {erros.grupoDre ? (
            <p role="alert" className="text-[11px] font-bold text-red-400">
              {erros.grupoDre}
            </p>
          ) : null}
        </fieldset>
        <LinhaDoInterruptor
          id="fin-categoria-ativa"
          rotulo="Categoria ativa"
          detalhe="Desativada, some das escolhas de novos lançamentos."
          ligado={form.ativa}
          desabilitado={sistema}
          aoMudar={(ativa) => atualizar({ ativa })}
        />
      </div>
    </FolhaFinanceira>
  );
}
