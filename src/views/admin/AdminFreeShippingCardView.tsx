import { Button } from "@/components/ui/button";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { StoreConfig } from "@/types";
import { Truck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Estilo = StoreConfig["freeShippingCardStyle"];
interface AdminFreeShippingCardViewProps {
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

function Previa({ compacto }: { compacto: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl bg-zinc-950 p-3.5 text-left text-white"
    >
      {!compacto && (
        <p className="text-[11px] text-zinc-400">Entrega grátis na cidade</p>
      )}
      <p className="text-[13px] font-bold leading-[18px]">
        {compacto ? (
          <>
            Faltam <span className="text-emerald-400">R$ 20,10</span> p/ frete
            grátis na cidade
          </>
        ) : (
          <>
            Falta pouquinho pro{" "}
            <span className="text-emerald-400">Frete Grátis!</span>
          </>
        )}
      </p>
      {!compacto && (
        <p className="mt-2 text-xs text-zinc-300">
          Adicione mais R$ 20,10 para garantir.
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 min-w-0 flex-1 rounded-full bg-zinc-800">
          <div className="h-full w-[86.6%] rounded-full bg-emerald-500" />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-300">
          129,90 / 150,00
        </span>
      </div>
    </div>
  );
}

export function AdminFreeShippingCardView({
  active = true,
  onSetDirty,
}: AdminFreeShippingCardViewProps) {
  const { config, isLoaded: configLoaded, updateConfig } = useStore();
  const offline = useOnlineStatus();
  const estilo = config.freeShippingCardStyle ?? "completo";
  const [edicao, setEdicao] = useState({
    origem: estilo,
    base: estilo,
    valor: estilo,
  });
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const trava = useRef(false);
  // Uma leitura tardia acompanha a loja sem apagar uma escolha ainda não salva.
  if (edicao.origem !== estilo) {
    setEdicao({
      origem: estilo,
      base: estilo,
      valor: edicao.valor === edicao.base ? estilo : edicao.valor,
    });
  }
  const dirty = edicao.valor !== edicao.base;
  useEffect(() => {
    if (active) onSetDirty?.(dirty);
  }, [active, dirty, onSetDirty]);

  async function salvar() {
    if (trava.current || offline || !active || !configLoaded || !dirty) return;
    trava.current = true;
    setSalvando(true);
    const valor = edicao.valor;
    try {
      const ok = await updateConfig(
        { freeShippingCardStyle: valor },
        { silent: true },
      );
      if (!ok) throw new Error("Gravação não confirmada");
      setEdicao((atual) => ({ ...atual, base: valor }));
      setSalvo(true);
      toast.success("Card de frete grátis salvo.");
    } catch {
      toast.error(
        "Não foi possível salvar o card. Confira a conexão e tente novamente.",
      );
    } finally {
      trava.current = false;
      setSalvando(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-8 pt-4 text-zinc-50">
      <header>
        <h1 className="text-[22px] font-bold leading-7">
          Card de frete grátis
        </h1>
        <p className="mt-1 text-[13px] leading-[18px] text-zinc-400">
          Escolha como o aviso aparece na página inicial da loja.
        </p>
      </header>
      <fieldset
        className="space-y-3"
        disabled={!active || !configLoaded || salvando}
      >
        <legend className="sr-only">Estilo do card de frete grátis</legend>
        {(["completo", "compacto"] as const).map((opcao) => (
          <label
            key={opcao}
            className={`block cursor-pointer space-y-3 rounded-[20px] border bg-admin-card p-4 focus-within:ring-2 focus-within:ring-zinc-400 ${edicao.valor === opcao ? "border-zinc-50" : "border-admin-border"}`}
          >
            <span className="flex min-h-11 flex-wrap items-center gap-2">
              <input
                type="radio"
                name="estilo-card-frete"
                value={opcao}
                checked={edicao.valor === opcao}
                className="size-5 accent-zinc-900"
                onChange={() => {
                  setEdicao((atual) => ({ ...atual, valor: opcao as Estilo }));
                  setSalvo(false);
                }}
              />
              <span className="text-[15px] font-bold">
                {opcao === "completo" ? "Completo" : "Compacto"}
              </span>
              <span className="text-xs text-zinc-400">
                {opcao === "completo"
                  ? "O atual, com título e explicação"
                  : "Uma faixa só, ocupa menos espaço"}
              </span>
            </span>
            <Previa compacto={opcao === "compacto"} />
          </label>
        ))}
      </fieldset>
      {offline && (
        <p role="alert" className="text-sm text-red-400">
          Sem conexão com a internet. Você pode ver a prévia, mas precisa estar
          online para salvar.
        </p>
      )}
      {!configLoaded && (
        <p role="status" className="text-sm text-zinc-400">
          Carregando a escolha da loja…
        </p>
      )}
      <Button
        disabled={offline || !active || !configLoaded || salvando || !dirty}
        onClick={() => void salvar()}
        className="h-[52px] w-full rounded-full bg-zinc-50 font-bold text-zinc-950 hover:bg-zinc-200"
      >
        <Truck aria-hidden="true" className="size-4" />
        {salvando ? "Salvando…" : "Salvar"}
      </Button>
      <p role="status" className="text-center text-xs text-zinc-400">
        {dirty ? "Ainda não salvo" : salvo ? "Salvo" : "Sem alterações"}
      </p>
      <p className="text-center text-xs text-zinc-400">
        A escolha vale para esta loja, no celular de todos os clientes. Só muda
        a aparência do card, não a regra do frete grátis.
      </p>
    </div>
  );
}
