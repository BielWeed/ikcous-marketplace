import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { type EnderecoDoCep, useBuscaCep } from "@/hooks/useBuscaCep";
import {
  type EnderecoGravado,
  type PartesDoEndereco,
  divergenciaDoEndereco,
  formatarCepDaLoja,
  lerEnderecoConferido,
  montarEnderecoDaLoja,
  motivoDoEnderecoIncompleto,
} from "@/lib/endereco-da-loja";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Bloco "Endereço da loja" de Minha loja (painel simples §4): a FONTE ÚNICA do
// endereço. A lojista digita o CEP, a tela preenche rua, bairro, cidade e UF, e
// falta só o número. O componente guarda as PARTES e devolve, a cada mudança,
// as quatro colunas que já existem (`originCep`, `storeAddress`, `storeCity`,
// `storeState`) — quem salva é a tela (um Salvar, uma chamada).
//
// O que ele NÃO faz: gravar. E o CEP só se edita aqui — o Frete passa a ler.

/** Os quatro valores que o endereço grava (ver `montarEnderecoDaLoja`). */
export type ValoresDoEndereco = EnderecoGravado;

export interface MudancaDoEndereco {
  /** As 4 colunas prontas para gravar; `null` enquanto faltar algo. */
  readonly valores: ValoresDoEndereco | null;
  /** Por que ainda não dá para gravar (texto da lojista); `null` = pode. */
  readonly motivo: string | null;
  /** Difere do que está salvo? Sem isto a tela mandaria o endereço de graça. */
  readonly alterado: boolean;
}

interface EnderecoDaLojaProps {
  /** O que está salvo (`config.originCep` etc.). */
  readonly originCep: string | null | undefined;
  readonly storeAddress: string | null | undefined;
  readonly storeCity: string | null | undefined;
  readonly storeState: string | null | undefined;
  readonly onMudou: (mudanca: MudancaDoEndereco) => void;
  readonly disabled?: boolean;
}

const CAMPO =
  "h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60 disabled:opacity-50";
const ROTULO = "text-sm text-zinc-300";

const PARTES_VAZIAS: PartesDoEndereco = {
  cep: "",
  rua: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
};

function digitosDoCep(cep: string): string {
  return cep.replace(/\D/g, "");
}

/** Mesmo endereço, ignorando espaço sobrando, hífen do CEP e caixa da UF. */
function mesmasPartes(a: PartesDoEndereco, b: PartesDoEndereco): boolean {
  const limpa = (texto: string) => texto.replace(/\s+/g, " ").trim();
  return (
    digitosDoCep(a.cep) === digitosDoCep(b.cep) &&
    limpa(a.rua) === limpa(b.rua) &&
    limpa(a.numero) === limpa(b.numero) &&
    limpa(a.complemento) === limpa(b.complemento) &&
    limpa(a.bairro) === limpa(b.bairro) &&
    limpa(a.cidade) === limpa(b.cidade) &&
    limpa(a.uf).toUpperCase() === limpa(b.uf).toUpperCase()
  );
}

interface Salvo {
  readonly partes: PartesDoEndereco;
  /** O texto antigo, quando existe e NÃO se lê no formato novo. */
  readonly textoAntigo: string | null;
}

/** O que está salvo, em partes. Texto antigo ilegível não vira partes: a
 * cidade e o CEP salvos ficam, o resto fica em branco e o texto vai à vista. */
function lerSalvo(
  originCep: string | null | undefined,
  storeAddress: string | null | undefined,
  storeCity: string | null | undefined,
  storeState: string | null | undefined,
): Salvo {
  const lido = lerEnderecoConferido(storeAddress, originCep);
  if (lido) return { partes: lido, textoAntigo: null };
  const texto = (storeAddress ?? "").trim();
  return {
    partes: {
      ...PARTES_VAZIAS,
      cep: formatarCepDaLoja(originCep),
      cidade: (storeCity ?? "").trim(),
      uf: (storeState ?? "").trim().toUpperCase(),
    },
    textoAntigo: texto || null,
  };
}

type ModoDaBusca = "preencher" | "conferir";

export const EnderecoDaLoja = memo(function EnderecoDaLoja({
  originCep,
  storeAddress,
  storeCity,
  storeState,
  onMudou,
  disabled = false,
}: EnderecoDaLojaProps) {
  const salvo = useMemo(
    () => lerSalvo(originCep, storeAddress, storeCity, storeState),
    [originCep, storeAddress, storeCity, storeState],
  );
  const [partes, setPartes] = useState<PartesDoEndereco>(salvo.partes);

  // Dado que chega do banco (hidratação, outro ator, o próprio save) só
  // substitui a tela se a lojista NÃO tinha mexido desde o salvo anterior.
  const salvoAnterior = useRef(salvo.partes);
  useEffect(() => {
    const anterior = salvoAnterior.current;
    salvoAnterior.current = salvo.partes;
    if (mesmasPartes(anterior, salvo.partes)) return;
    setPartes((atual) =>
      mesmasPartes(atual, anterior) ? salvo.partes : atual,
    );
  }, [salvo.partes]);

  // ── Busca do CEP ──────────────────────────────────────────────────────
  // "preencher": a lojista digitou o CEP — rua/bairro/cidade/UF vêm dele.
  // "conferir": o CEP já estava salvo — só descobre a cidade dele para o
  // aviso de divergência, sem tocar nos campos.
  const buscaAtual = useRef<{ modo: ModoDaBusca; cep: string }>({
    modo: "preencher",
    cep: "",
  });
  const [modoDoResultado, setModoDoResultado] =
    useState<ModoDaBusca>("preencher");
  // CEPs cuja cidade já foi descoberta nesta tela: não pergunta de novo.
  const cepsConsultados = useRef(new Set<string>());
  const [cidadeDoCep, setCidadeDoCep] = useState<{
    cep: string;
    cidade: string;
    uf: string;
  } | null>(null);

  const aoEncontrar = (endereco: EnderecoDoCep) => {
    const { modo, cep } = buscaAtual.current;
    cepsConsultados.current.add(cep);
    setCidadeDoCep({
      cep,
      cidade: endereco.localidade ?? "",
      uf: endereco.uf ?? "",
    });
    if (modo !== "preencher") return;
    // O CEP novo troca rua/bairro/cidade/UF (os de antes eram de outro CEP);
    // número e complemento ficam — foi ela quem digitou.
    setPartes((atual) => ({
      ...atual,
      rua: endereco.logradouro ?? "",
      bairro: endereco.bairro ?? "",
      cidade: endereco.localidade ?? "",
      uf: endereco.uf ?? "",
    }));
  };
  const { buscando, buscar, resultado, limpar } = useBuscaCep(aoEncontrar, {
    avisarPorToast: false,
  });

  const iniciarBusca = useCallback(
    (modo: ModoDaBusca, cepLimpo: string) => {
      buscaAtual.current = { modo, cep: cepLimpo };
      setModoDoResultado(modo);
      void buscar(cepLimpo);
    },
    [buscar],
  );

  // Ao abrir a tela com CEP e cidade salvos, confere uma vez se o CEP é dessa
  // cidade. Rede fora ou CEP desconhecido: fica quieto (não é o que ela veio
  // fazer aqui).
  const cepSalvo = digitosDoCep(salvo.partes.cep);
  const temCidadeSalva = salvo.partes.cidade.trim() !== "";
  useEffect(() => {
    if (cepSalvo.length !== 8 || !temCidadeSalva) return;
    if (cepsConsultados.current.has(cepSalvo)) return;
    iniciarBusca("conferir", cepSalvo);
  }, [cepSalvo, temCidadeSalva, iniciarBusca]);

  const mudarCep = (bruto: string) => {
    const formatado = formatarCepDaLoja(bruto);
    const limpo = digitosDoCep(formatado);
    const jaBuscado =
      cidadeDoCep?.cep === limpo && buscaAtual.current.modo === "preencher";
    setPartes((atual) => ({ ...atual, cep: formatado }));
    if (limpo.length !== 8) {
      limpar();
      return;
    }
    if (!jaBuscado || (resultado && resultado.tipo !== "achou")) {
      iniciarBusca("preencher", limpo);
    }
  };

  const mudar = (campo: keyof PartesDoEndereco) => (valor: string) =>
    setPartes((atual) => ({
      ...atual,
      [campo]: campo === "uf" ? valor.toUpperCase().slice(0, 2) : valor,
    }));

  // ── O que a tela de cima recebe ───────────────────────────────────────
  const motivo = motivoDoEnderecoIncompleto(partes);
  const valores = useMemo(
    () => (motivo ? null : montarEnderecoDaLoja(partes)),
    [motivo, partes],
  );
  const alterado = !mesmasPartes(partes, salvo.partes);

  // Quem chama pode passar uma função nova a cada render; ela fica numa ref
  // (atualizada antes do aviso) para o aviso sair só quando algo MUDA.
  const onMudouRef = useRef(onMudou);
  useLayoutEffect(() => {
    onMudouRef.current = onMudou;
  });
  useEffect(() => {
    onMudouRef.current({ valores, motivo, alterado });
  }, [valores, motivo, alterado]);

  const aviso =
    cidadeDoCep && cidadeDoCep.cep === digitosDoCep(partes.cep)
      ? divergenciaDoEndereco(
          cidadeDoCep.cidade,
          cidadeDoCep.uf,
          partes.cidade,
          partes.uf,
        )
      : null;

  const mensagemDaBusca =
    modoDoResultado !== "preencher" || !resultado
      ? null
      : resultado.tipo === "naoEncontrado"
        ? "CEP não encontrado. Confira os números; o que estava preenchido foi mantido."
        : resultado.tipo === "achou"
          ? null
          : "Não foi possível buscar o CEP agora. Preencha o endereço à mão.";

  return (
    <div className="space-y-4">
      {salvo.textoAntigo && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3.5 text-sm text-zinc-200">
          <p className="text-xs text-zinc-400">Endereço salvo até agora</p>
          <p className="mt-1 break-words">{salvo.textoAntigo}</p>
          <p className="mt-2 text-amber-300">
            Confirme pelo CEP: digite o CEP e o número abaixo para guardar o
            endereço no formato novo.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label htmlFor="endereco-cep" className={ROTULO}>
            CEP da loja
          </label>
          <div className="mt-2">
            <LocalBufferedInput
              id="endereco-cep"
              value={partes.cep}
              onFlush={mudarCep}
              disabled={disabled}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={9}
              placeholder="00000-000"
              className={CAMPO}
            />
          </div>
          {buscando && (
            <p
              role="status"
              className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-400"
            >
              <Loader2 className="size-3.5 animate-spin" />
              Buscando o CEP…
            </p>
          )}
        </div>
      </div>

      {mensagemDaBusca && (
        <p role="status" className="text-sm text-amber-300">
          {mensagemDaBusca}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="endereco-rua" className={ROTULO}>
            Rua
          </label>
          <div className="mt-2">
            <LocalBufferedInput
              id="endereco-rua"
              value={partes.rua}
              onFlush={mudar("rua")}
              disabled={disabled}
              autoComplete="address-line1"
              className={CAMPO}
            />
          </div>
        </div>
        <div>
          <label htmlFor="endereco-numero" className={ROTULO}>
            Número
          </label>
          <div className="mt-2">
            <LocalBufferedInput
              id="endereco-numero"
              value={partes.numero}
              onFlush={mudar("numero")}
              disabled={disabled}
              placeholder="Ex.: 1578"
              className={CAMPO}
            />
          </div>
        </div>
        <div>
          <label htmlFor="endereco-complemento" className={ROTULO}>
            Complemento <span className="text-zinc-500">(opcional)</span>
          </label>
          <div className="mt-2">
            <LocalBufferedInput
              id="endereco-complemento"
              value={partes.complemento}
              onFlush={mudar("complemento")}
              disabled={disabled}
              className={CAMPO}
            />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="endereco-bairro" className={ROTULO}>
            Bairro
          </label>
          <div className="mt-2">
            <LocalBufferedInput
              id="endereco-bairro"
              value={partes.bairro}
              onFlush={mudar("bairro")}
              disabled={disabled}
              className={CAMPO}
            />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="endereco-cidade" className={ROTULO}>
            Cidade
          </label>
          <div className="mt-2">
            <LocalBufferedInput
              id="endereco-cidade"
              value={partes.cidade}
              onFlush={mudar("cidade")}
              disabled={disabled}
              autoComplete="address-level2"
              className={CAMPO}
            />
          </div>
        </div>
        <div>
          <label htmlFor="endereco-uf" className={ROTULO}>
            UF
          </label>
          <div className="mt-2">
            <LocalBufferedInput
              id="endereco-uf"
              value={partes.uf}
              onFlush={mudar("uf")}
              disabled={disabled}
              autoComplete="address-level1"
              maxLength={2}
              placeholder="SP"
              className={CAMPO}
            />
          </div>
        </div>
      </div>

      {aviso && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3.5 text-sm text-amber-200"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <span>{aviso}</span>
        </p>
      )}

      {motivo && (
        <p role="status" className="text-sm text-zinc-300">
          Para salvar o endereço: {motivo}
        </p>
      )}

      <p className="text-xs leading-relaxed text-zinc-400">
        Este é também o endereço de onde saem as entregas. Se você usa o Melhor
        Envio, as etiquetas saem com o endereço da sua conta Melhor Envio —
        confira se é este mesmo.
      </p>
    </div>
  );
});
