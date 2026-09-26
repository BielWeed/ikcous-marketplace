import { AlertTriangle, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import { Switch } from "@/components/ui/switch";
import { useCategories } from "@/hooks/useCategories";
import {
  METODOS_LOCAIS,
  METODOS_NACIONAIS,
  MINIMO_ARREPENDIMENTO_DIAS,
  MINIMO_VICIO_DIAS,
  explicacaoMetodo,
  lerPolitica,
  mensagemDoErro,
  rotuloMetodo,
} from "@/lib/devolucao";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { MetodoDevolucao, PoliticaDevolucao } from "@/types/devolucao";
import { haptic } from "@/utils/haptic";

/** O formulário: prazos em texto (o campo pode ficar vazio enquanto digita). */
interface FormDaPolitica {
  prazo_arrependimento_dias: string;
  prazo_troca_dias: string;
  prazo_vicio_dias: string;
  aceita_troca: boolean;
  aceita_vale: boolean;
  exige_fotos_vicio: boolean;
  metodos_locais: MetodoDevolucao[];
  metodos_nacionais: MetodoDevolucao[];
  reembolso_momento: PoliticaDevolucao["reembolso_momento"];
  frete_troca_pago_por: PoliticaDevolucao["frete_troca_pago_por"];
  categorias_sem_troca: string[];
  texto_politica: string;
  endereco_devolucao: string;
}

/** Os padrões da migration — usados só se a linha id=1 não existir. */
const PADRAO: PoliticaDevolucao = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: null,
};

function formDe(p: PoliticaDevolucao): FormDaPolitica {
  return {
    prazo_arrependimento_dias: String(p.prazo_arrependimento_dias),
    prazo_troca_dias: String(p.prazo_troca_dias),
    prazo_vicio_dias: String(p.prazo_vicio_dias),
    aceita_troca: p.aceita_troca,
    aceita_vale: p.aceita_vale,
    exige_fotos_vicio: p.exige_fotos_vicio,
    metodos_locais: [...p.metodos_locais],
    metodos_nacionais: [...p.metodos_nacionais],
    reembolso_momento: p.reembolso_momento,
    frete_troca_pago_por: p.frete_troca_pago_por,
    categorias_sem_troca: [...p.categorias_sem_troca],
    texto_politica: p.texto_politica ?? "",
    endereco_devolucao: p.endereco_devolucao ?? "",
  };
}

const inteiro = (v: string) =>
  /^\d+$/.test(v.trim()) ? Number(v) : Number.NaN;

/** Mínimos legais explicados — o CHECK do banco recusa abaixo deles. */
export function erroDoArrependimento(v: string): string | null {
  const n = inteiro(v);
  if (!Number.isInteger(n)) return "Informe o número de dias.";
  if (n < MINIMO_ARREPENDIMENTO_DIAS) {
    return "Mínimo de 7 dias: é o prazo de arrependimento da lei para compras fora da loja física (CDC art. 49).";
  }
  if (n > 90) return "No máximo 90 dias.";
  return null;
}

export function erroDaTroca(v: string): string | null {
  const n = inteiro(v);
  if (!Number.isInteger(n)) return "Informe o número de dias.";
  if (n > 365) return "No máximo 365 dias.";
  return null;
}

export function erroDoVicio(v: string): string | null {
  const n = inteiro(v);
  if (!Number.isInteger(n)) return "Informe o número de dias.";
  if (n < MINIMO_VICIO_DIAS) {
    return "Mínimo de 30 dias: é a garantia legal de produto não durável (CDC art. 26). Para produto durável a lei dá 90.";
  }
  if (n > 365) return "No máximo 365 dias.";
  return null;
}

const CAMPO =
  "h-11 w-full rounded-xl border border-white/5 bg-zinc-950 px-3 text-sm text-white placeholder:text-zinc-600 focus:border-admin-gold focus:outline-none";
const ROTULO =
  "mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500";
const CAIXA =
  "space-y-3 rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5";

/**
 * Política de trocas e devoluções da loja (P3 do AGENTS.md: cada lojista
 * configura a sua). Grava pela RPC `salvar_politica_de_devolucao`; os
 * mínimos da lei (arrependimento ≥ 7, vício ≥ 30) são CHECK no banco e o
 * formulário explica antes de gastar a chamada.
 */
export function PoliticaDeDevolucaoSection({
  isOffline = false,
  onDirtyMudou,
}: Readonly<{
  isOffline?: boolean;
  onDirtyMudou?: (sujo: boolean) => void;
}>) {
  const { categories } = useCategories();
  const [salva, setSalva] = useState<PoliticaDevolucao | null>(null);
  const [form, setForm] = useState<FormDaPolitica | null>(null);
  const [erroDeLeitura, setErroDeLeitura] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const ativoRef = useRef(true);

  const carregar = useCallback(async () => {
    setErroDeLeitura(false);
    try {
      const { data, error } = await supabase
        .from("politica_devolucao")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (!ativoRef.current) return;
      if (error) {
        setErroDeLeitura(true);
        return;
      }
      const lida = data ? lerPolitica(data) : PADRAO;
      if (!lida) {
        setErroDeLeitura(true);
        return;
      }
      setSalva(lida);
      setForm(formDe(lida));
    } catch {
      if (ativoRef.current) setErroDeLeitura(true);
    }
  }, []);

  useEffect(() => {
    ativoRef.current = true;
    void carregar();
    return () => {
      ativoRef.current = false;
    };
  }, [carregar]);

  const sujo =
    !!form && !!salva && JSON.stringify(form) !== JSON.stringify(formDe(salva));

  useEffect(() => {
    onDirtyMudou?.(sujo || salvando);
  }, [sujo, salvando, onDirtyMudou]);
  useEffect(() => () => onDirtyMudou?.(false), [onDirtyMudou]);

  const mudar = useCallback(
    <K extends keyof FormDaPolitica>(chave: K, valor: FormDaPolitica[K]) => {
      setForm((antes) => (antes ? { ...antes, [chave]: valor } : antes));
    },
    [],
  );

  if (erroDeLeitura) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-bold text-red-300">
          Não consegui carregar a política de devolução.
        </p>
        <button
          type="button"
          onClick={() => void carregar()}
          className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-[11px] font-bold text-zinc-200"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!form) {
    return (
      <p className="flex items-center gap-2 text-xs text-zinc-400">
        <Loader2 className="size-4 animate-spin" />
        Carregando política…
      </p>
    );
  }

  const erros = {
    arrependimento: erroDoArrependimento(form.prazo_arrependimento_dias),
    troca: erroDaTroca(form.prazo_troca_dias),
    vicio: erroDoVicio(form.prazo_vicio_dias),
  };
  const temErro = Object.values(erros).some((e) => e !== null);

  function alternarMetodo(
    lista: "metodos_locais" | "metodos_nacionais",
    metodo: MetodoDevolucao,
    ligado: boolean,
  ) {
    if (!form) return;
    const locais = lista === "metodos_locais";
    const atual = locais ? form.metodos_locais : form.metodos_nacionais;
    const ordem = locais ? METODOS_LOCAIS : METODOS_NACIONAIS;
    mudar(
      lista,
      ordem.filter((m) => (m === metodo ? ligado : atual.includes(m))),
    );
  }

  function alternarCategoria(nome: string) {
    if (!form) return;
    const tem = form.categorias_sem_troca.some(
      (c) => c.toLowerCase() === nome.toLowerCase(),
    );
    mudar(
      "categorias_sem_troca",
      tem
        ? form.categorias_sem_troca.filter(
            (c) => c.toLowerCase() !== nome.toLowerCase(),
          )
        : [...form.categorias_sem_troca, nome],
    );
  }

  async function salvar() {
    if (!form || salvando) return;
    if (temErro) {
      toast.error("Corrija os prazos destacados antes de salvar.");
      return;
    }
    if (isOffline) {
      toast.error("Você está offline");
      return;
    }
    setSalvando(true);
    haptic.light();
    try {
      const { data, error } = await supabase.rpc(
        "salvar_politica_de_devolucao",
        {
          p: {
            prazo_arrependimento_dias: Number(form.prazo_arrependimento_dias),
            prazo_troca_dias: Number(form.prazo_troca_dias),
            prazo_vicio_dias: Number(form.prazo_vicio_dias),
            aceita_troca: form.aceita_troca,
            aceita_vale: form.aceita_vale,
            exige_fotos_vicio: form.exige_fotos_vicio,
            metodos_locais: form.metodos_locais,
            metodos_nacionais: form.metodos_nacionais,
            reembolso_momento: form.reembolso_momento,
            frete_troca_pago_por: form.frete_troca_pago_por,
            categorias_sem_troca: form.categorias_sem_troca,
            texto_politica: form.texto_politica,
            endereco_devolucao: form.endereco_devolucao,
          },
        },
      );
      if (error) {
        toast.error(
          mensagemDoErro(error, "Não foi possível salvar a política."),
        );
        return;
      }
      const gravada = lerPolitica(data);
      if (!gravada) {
        toast.error(
          "A política foi enviada, mas a resposta veio estranha. Recarregue para conferir.",
        );
        await carregar();
        return;
      }
      setSalva(gravada);
      setForm(formDe(gravada));
      toast.success("Política de trocas e devoluções salva.");
    } catch (e) {
      toast.error(mensagemDoErro(e, "Não foi possível salvar a política."));
    } finally {
      setSalvando(false);
    }
  }

  const nomesDasCategorias = Array.from(
    new Set([
      ...categories.map((c) => c.name).filter(Boolean),
      ...form.categorias_sem_troca,
    ]),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  return (
    <div className="space-y-4" data-testid="politica-devolucao">
      <p className="text-[11px] leading-relaxed text-zinc-400">
        É isto que o cliente lê e o que o app aplica ao pedido de devolução. Os
        prazos contam da entrega; os mínimos da lei não podem ser reduzidos.
      </p>

      <div className={CAIXA}>
        <h4 className={ROTULO}>Prazos (dias após a entrega)</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="politica-arrependimento" className={ROTULO}>
              Arrependimento
            </label>
            <LocalBufferedInput
              id="politica-arrependimento"
              type="number"
              inputMode="numeric"
              min={MINIMO_ARREPENDIMENTO_DIAS}
              max={90}
              value={form.prazo_arrependimento_dias}
              onFlush={(v) => mudar("prazo_arrependimento_dias", v)}
              validate={erroDoArrependimento}
              className={cn(CAMPO, "tabular-nums")}
            />
          </div>
          <div>
            <label htmlFor="politica-troca" className={ROTULO}>
              Troca por gosto
            </label>
            <LocalBufferedInput
              id="politica-troca"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              value={form.prazo_troca_dias}
              onFlush={(v) => mudar("prazo_troca_dias", v)}
              validate={erroDaTroca}
              className={cn(CAMPO, "tabular-nums")}
            />
          </div>
          <div>
            <label htmlFor="politica-vicio" className={ROTULO}>
              Defeito
            </label>
            <LocalBufferedInput
              id="politica-vicio"
              type="number"
              inputMode="numeric"
              min={MINIMO_VICIO_DIAS}
              max={365}
              value={form.prazo_vicio_dias}
              onFlush={(v) => mudar("prazo_vicio_dias", v)}
              validate={erroDoVicio}
              className={cn(CAMPO, "tabular-nums")}
            />
          </div>
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Arrependimento: mínimo 7 dias pela lei (compra pela internet),
          devolvendo tudo o que o cliente pagou, frete de ida incluso. Defeito:
          mínimo 30 dias; produto durável tem 90 pela lei. Troca por gosto é
          cortesia da loja — 0 dia desliga.
        </p>
      </div>

      <div className={CAIXA}>
        <h4 className={ROTULO}>O que a loja aceita</h4>
        <LinhaDeInterruptor
          rotulo="Troca por tamanho ou gosto"
          ajuda="Fora do arrependimento, o cliente só pode trocar ou pedir vale."
          ligado={form.aceita_troca}
          onMudar={(v) => mudar("aceita_troca", v)}
        />
        <LinhaDeInterruptor
          rotulo="Vale-troca"
          ajuda="Crédito para o cliente usar em outra compra."
          ligado={form.aceita_vale}
          onMudar={(v) => mudar("aceita_vale", v)}
        />
        <LinhaDeInterruptor
          rotulo="Exigir fotos em caso de defeito"
          ajuda="O cliente anexa ao menos uma foto do problema."
          ligado={form.exige_fotos_vicio}
          onMudar={(v) => mudar("exige_fotos_vicio", v)}
        />
      </div>

      <div className={CAIXA}>
        <h4 className={ROTULO}>Como o produto volta</h4>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Pedidos locais (entrega da loja, retirada, balcão)
        </p>
        {METODOS_LOCAIS.map((m) => (
          <LinhaDeInterruptor
            key={m}
            rotulo={rotuloMetodo(m)}
            ajuda={explicacaoMetodo(m)}
            ligado={form.metodos_locais.includes(m)}
            onMudar={(v) => alternarMetodo("metodos_locais", m, v)}
          />
        ))}
        <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Pedidos pelos Correios ou transportadora
        </p>
        {METODOS_NACIONAIS.map((m) => (
          <LinhaDeInterruptor
            key={m}
            rotulo={rotuloMetodo(m)}
            ajuda={
              m === "etiqueta_reversa"
                ? "Só aparece quando o pedido saiu por etiqueta do Melhor Envio."
                : explicacaoMetodo(m)
            }
            ligado={form.metodos_nacionais.includes(m)}
            onMudar={(v) => alternarMetodo("metodos_nacionais", m, v)}
          />
        ))}
        {(form.metodos_locais.length === 0 ||
          form.metodos_nacionais.length === 0) && (
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Com tudo desligado, o direito do cliente continua: ele ainda pode
            entregar na loja (pedido local) ou enviar por conta própria
            (Correios).
          </p>
        )}
        <div>
          <label htmlFor="politica-endereco" className={ROTULO}>
            Endereço para devolução
          </label>
          <LocalBufferedInput
            id="politica-endereco"
            value={form.endereco_devolucao}
            maxLength={300}
            placeholder="Vazio = o endereço da loja"
            onFlush={(v) => mudar("endereco_devolucao", v)}
            className={CAMPO}
          />
        </div>
      </div>

      <div className={CAIXA}>
        <h4 className={ROTULO}>Dinheiro e frete</h4>
        <Escolha
          rotulo="Quando reembolsar"
          valor={form.reembolso_momento}
          opcoes={[
            ["ao_receber", "Ao receber o produto"],
            ["apos_inspecao", "Depois de conferir"],
          ]}
          onMudar={(v) => mudar("reembolso_momento", v)}
        />
        <Escolha
          rotulo="Frete da troca por gosto"
          valor={form.frete_troca_pago_por}
          opcoes={[
            ["cliente", "O cliente paga"],
            ["loja", "A loja paga"],
          ]}
          onMudar={(v) => mudar("frete_troca_pago_por", v)}
        />
        <p className="text-[10px] leading-relaxed text-zinc-500">
          No arrependimento e no defeito o frete de volta é sempre da loja.
        </p>
      </div>

      <div className={CAIXA}>
        <h4 className={ROTULO}>Categorias sem troca por gosto</h4>
        {nomesDasCategorias.length === 0 ? (
          <p className="text-[11px] text-zinc-500">
            Nenhuma categoria cadastrada.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {nomesDasCategorias.map((nome) => {
              const marcada = form.categorias_sem_troca.some(
                (c) => c.toLowerCase() === nome.toLowerCase(),
              );
              return (
                <button
                  key={nome}
                  type="button"
                  aria-pressed={marcada}
                  onClick={() => alternarCategoria(nome)}
                  className={cn(
                    "min-h-11 rounded-xl border px-3 text-[11px] font-bold transition-colors",
                    marcada
                      ? "border-admin-gold/50 bg-admin-gold/10 text-admin-gold"
                      : "border-white/10 text-zinc-400 hover:text-white",
                  )}
                >
                  {nome}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Ex.: roupa íntima, cosméticos abertos. Defeito e arrependimento
          continuam valendo — a lei não deixa de fora.
        </p>
      </div>

      <div className={CAIXA}>
        <label htmlFor="politica-texto" className={ROTULO}>
          Texto da política (o cliente lê antes de confirmar)
        </label>
        <LocalBufferedTextarea
          id="politica-texto"
          value={form.texto_politica}
          maxLength={4000}
          rows={5}
          onFlush={(v) => mudar("texto_politica", v)}
          placeholder="Ex.: Aceitamos trocas em até 30 dias, com etiqueta e sem uso."
          className="w-full rounded-xl border border-white/5 bg-zinc-950 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-admin-gold focus:outline-none"
        />
        <p className="text-right text-[10px] tabular-nums text-zinc-500">
          {form.texto_politica.length}/4000
        </p>
      </div>

      <button
        type="button"
        onClick={() => void salvar()}
        disabled={!sujo || salvando || temErro || isOffline}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-admin-gold px-4 text-[11px] font-black uppercase tracking-widest text-black transition-all hover:bg-admin-gold/90 active:scale-95 disabled:opacity-50"
      >
        {salvando ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Save className="size-4" />
        )}
        {sujo ? "Salvar política" : "Política salva"}
      </button>
    </div>
  );
}

function LinhaDeInterruptor({
  rotulo,
  ajuda,
  ligado,
  onMudar,
}: Readonly<{
  rotulo: string;
  ajuda: string;
  ligado: boolean;
  onMudar: (ligado: boolean) => void;
}>) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-xs font-bold text-zinc-200">{rotulo}</span>
        <span className="block text-[10px] leading-snug text-zinc-500">
          {ajuda}
        </span>
      </span>
      <Switch
        checked={ligado}
        aria-label={rotulo}
        onCheckedChange={onMudar}
        className="data-[state=checked]:bg-admin-gold"
      />
    </div>
  );
}

function Escolha<T extends string>({
  rotulo,
  valor,
  opcoes,
  onMudar,
}: Readonly<{
  rotulo: string;
  valor: T;
  opcoes: ReadonlyArray<readonly [T, string]>;
  onMudar: (v: T) => void;
}>) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-bold text-zinc-200">
        {rotulo}
      </legend>
      <div className="grid grid-cols-2 gap-1.5">
        {opcoes.map(([chave, texto]) => (
          <button
            key={chave}
            type="button"
            aria-pressed={valor === chave}
            onClick={() => onMudar(chave)}
            className={cn(
              "min-h-11 rounded-lg border px-2 text-[11px] font-bold transition-colors",
              valor === chave
                ? "border-admin-gold/60 bg-admin-gold/10 text-admin-gold"
                : "border-white/10 text-zinc-400 hover:text-white",
            )}
          >
            {texto}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
