import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { formatarCep, useBuscaCep } from "@/hooks/useBuscaCep";
import { cn } from "@/lib/utils";
import type { Address } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowUpRight,
  Briefcase,
  Check,
  CheckCircle2,
  Home,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Tag,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";

const addressSchema = z.object({
  name: z.string().min(1, "Nome/Apelido é obrigatório"),
  // A máscara devolve "12345-67" para 7 dígitos — 8 CARACTERES contando o
  // hífen, o que passava num min(8) e gravava CEP incompleto como endereço
  // de entrega. O que valida CEP é a contagem de DÍGITOS: sempre 8.
  cep: z
    .string()
    .refine((v) => v.replace(/\D/g, "").length === 8, "CEP inválido"),
  street: z.string().min(1, "Logradouro é obrigatório"),
  number: z.string().min(1, "Número é obrigatório"),
  complement: z.string().optional().or(z.literal("")),
  neighborhood: z.string().min(1, "Bairro é obrigatório"),
  city: z.string().min(1, "Cidade é obrigatória"),
  state: z.string().min(1, "Estado é obrigatório"),
  reference: z.string().optional().or(z.literal("")),
  recipient_name: z.string().min(1, "Nome do destinatário é obrigatório"),
  is_default: z.boolean(),
});

type AddressFormValues = z.infer<typeof addressSchema>;

interface AddressFormProps {
  initialData?: Address;
  onSubmit: (address: Omit<Address, "id" | "user_id">) => Promise<void>;
  onCancel: () => void;
  /**
   * Nome da conta de quem está comprando: já vem em "Quem vai receber" num
   * endereço novo (a pessoa só troca se for presente). Opcional — sem ele o
   * campo nasce vazio, como antes.
   */
  nomeDaConta?: string;
}

// Apelidos que viram botão. O valor gravado é o MESMO texto que a pessoa
// digitava antes ("Casa", "Trabalho"); qualquer outro apelido é "Outro".
const APELIDO_CASA = "Casa";
const APELIDO_TRABALHO = "Trabalho";
type EscolhaDeApelido = "Casa" | "Trabalho" | "Outro";

function escolhaDoApelido(
  nome: string,
  outroTravado: boolean,
): EscolhaDeApelido {
  if (outroTravado) return "Outro";
  const normalizado = nome.trim().toLowerCase();
  if (normalizado === "casa") return "Casa";
  if (normalizado === "trabalho") return "Trabalho";
  return normalizado === "" ? "Casa" : "Outro";
}

// "Sem número" grava a convenção que o resto da casa já lê (etiqueta do
// Melhor Envio usa 'S/N' quando o número falta).
const SEM_NUMERO = "S/N";

// Busca de CEP dos Correios para quem não sabe o próprio CEP. É só um link:
// nenhum dado da pessoa sai do aparelho.
const URL_DESCOBRIR_CEP =
  "https://buscacepinter.correios.com.br/app/endereco/index.php";

// Classes de campo — tokens do tema (claro/escuro e a cor da loja), nunca cor
// fixa. Os estados de erro e de "achado" usam vermelho/esmeralda com variante
// escura, o mesmo par que o resto do app já usa.
const CAMPO =
  "h-[52px] w-full rounded-2xl border-[1.5px] border-input bg-muted/40 px-3.5 text-[15px] font-medium text-foreground outline-none transition-all placeholder:text-muted-foreground/60 focus:border-ring focus:bg-background focus:ring-4 focus:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-60";
const CAMPO_COM_ERRO =
  "border-red-300 bg-background ring-4 ring-red-500/10 dark:border-red-500/60";
const ROTULO =
  "mb-1.5 ml-0.5 flex items-baseline justify-between text-xs font-semibold text-muted-foreground";

function MensagemDeErro({
  id,
  children,
}: Readonly<{ id: string; children: React.ReactNode }>) {
  return (
    <p
      id={id}
      className="ml-0.5 mt-1.5 text-xs font-medium text-red-600 dark:text-red-400"
    >
      {children}
    </p>
  );
}

// Junta ["a rua", "o bairro"] em "a rua e o bairro" / "a rua, o bairro e a cidade".
function juntarComE(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function AddressForm({
  initialData,
  onSubmit,
  onCancel,
  nomeDaConta,
}: Readonly<AddressFormProps>) {
  // `config` não decide mais a busca de CEP (vale para toda loja): a cobertura
  // de entrega decide para onde a loja entrega, nunca onde o cliente mora.
  const { isLoaded } = useStore();
  const [loading, setLoading] = useState(false);

  const nomePadrao = nomeDaConta?.trim() ?? "";

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      name: initialData?.name || APELIDO_CASA,
      cep: initialData?.cep || "",
      street: initialData?.street || "",
      number: initialData?.number || "",
      complement: initialData?.complement || "",
      neighborhood: initialData?.neighborhood || "",
      city: initialData?.city || "",
      state: initialData?.state || "",
      reference: initialData?.reference || "",
      recipient_name: initialData?.recipient_name || nomePadrao,
      is_default: !!initialData?.is_default,
    },
  });

  const hasInitializedRef = useRef(false);
  // Guarda o endereço já aplicado ao formulário. A EDIÇÃO pode chegar
  // DEPOIS do mount: sem cache local de endereços, o fetch do pai ainda
  // corria quando isLoaded subiu, o reset único travou os campos vazios e o
  // "Editar Endereço" nascia em branco — salvar por cima redigitado
  // sobrescrevia o endereço real. Chegou endereço DIFERENTE do aplicado,
  // o formulário se preenche.
  const initialDataAplicadoRef = useRef<Address | undefined>(undefined);

  // A quem os campos de endereço ATUALMENTE pertencem: o CEP do
  // `initialData` (edição) ou o último CEP cuja busca foi aplicada — mesmo
  // em cadastro novo, depois da primeira busca bem-sucedida. `null` só
  // antes de qualquer busca aplicada num cadastro novo: aí não existe outro
  // CEP "dono" do que a pessoa já digitou à mão, e um campo que o ViaCEP não
  // determina fica como está (CARRINHO-03 não cobre esse caso — só a
  // divergência entre o CEP dono do valor atual e o CEP que acabou de
  // responder).
  const cepAssociadoRef = useRef<string | null>(
    initialData?.cep ? formatarCep(initialData.cep).limpo : null,
  );
  // CEP da busca que está em voo agora, gravado pelo `onChange` do campo
  // ANTES de chamar `buscarCep` — é com ele que o callback abaixo sabe qual
  // CEP a resposta corrente descreve (o hook já garante, pela guarda de
  // sequência de #184, que só a busca mais nova chama este callback).
  const cepEmBuscaRef = useRef<string>("");

  // Escolha "Outro" do apelido, travada: a pessoa que escolheu Outro e digita
  // "Casa" no campo não pode ver a escolha pular sozinha para o botão Casa.
  const [apelidoOutro, setApelidoOutro] = useState(false);
  // Os campos de rua/bairro/cidade/UF ficam abertos (e abertos ficam enquanto
  // a pessoa os preenche): sem a trava, completar o último campo faltante
  // trocava os campos pelo cartão no meio da digitação.
  const [camposAbertos, setCamposAbertos] = useState(false);
  // O selo "Achado pelo CEP" só vale se o CEP trouxe rua E bairro: num CEP de
  // cidade inteira a rua é da própria pessoa, e o selo mentiria.
  const [cepTrouxeRuaEBairro, setCepTrouxeRuaEBairro] = useState(false);
  const [referenciaAberta, setReferenciaAberta] = useState(
    !!initialData?.reference,
  );

  // Corrida, timeout e abort no desmonte ficam por conta do hook (#184,
  // #185, #186). Aqui: campo que o ViaCEP devolveu, escreve o valor dele;
  // campo que o ViaCEP NÃO devolveu (string vazia, CEP de localidade única)
  // só é limpo se ele pertencia a um CEP DIFERENTE do que acabou de
  // responder — um campo digitado à mão para o CEP que continua o mesmo não
  // se apaga. O aviso do desfecho mora na tela (`avisarPorToast: false`).
  const {
    buscando: buscandoCep,
    buscar: buscarCep,
    resultado: resultadoCep,
    limpar: limparResultadoCep,
  } = useBuscaCep(
    (endereco) => {
      const cepDaResposta = cepEmBuscaRef.current;
      const eraDeOutroCep =
        cepAssociadoRef.current !== null &&
        cepAssociadoRef.current !== cepDaResposta;

      if (endereco.logradouro) {
        form.setValue("street", endereco.logradouro, {
          shouldValidate: true,
        });
      } else if (eraDeOutroCep) {
        form.setValue("street", "", { shouldValidate: true });
      }
      if (endereco.bairro) {
        form.setValue("neighborhood", endereco.bairro, {
          shouldValidate: true,
        });
      } else if (eraDeOutroCep) {
        form.setValue("neighborhood", "", { shouldValidate: true });
      }
      if (endereco.localidade)
        form.setValue("city", endereco.localidade, { shouldValidate: true });
      if (endereco.uf)
        form.setValue("state", endereco.uf, { shouldValidate: true });

      cepAssociadoRef.current = cepDaResposta;
      setCepTrouxeRuaEBairro(!!(endereco.logradouro && endereco.bairro));
    },
    { avisarPorToast: false },
  );

  useEffect(() => {
    if (isLoaded && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      initialDataAplicadoRef.current = initialData;
      cepAssociadoRef.current = initialData?.cep
        ? formatarCep(initialData.cep).limpo
        : null;
      if (initialData) {
        form.reset({
          name: initialData.name || "",
          cep: initialData.cep || "",
          street: initialData.street || "",
          number: initialData.number || "",
          complement: initialData.complement || "",
          neighborhood: initialData.neighborhood || "",
          city: initialData.city || "",
          state: initialData.state || "",
          reference: initialData.reference || "",
          recipient_name: initialData.recipient_name || "",
          is_default: !!initialData.is_default,
        });
      } else {
        // A cobertura de entrega da loja decide para onde ela entrega,
        // nunca onde o cliente mora — por isso o `isNational` que existia
        // aqui saiu dos três campos de endereço do cliente.
        form.reset({
          name: APELIDO_CASA,
          cep: "",
          street: "",
          number: "",
          complement: "",
          neighborhood: "",
          city: "",
          state: "",
          reference: "",
          recipient_name: nomePadrao,
          is_default: false,
        });
      }
      return;
    }
    if (
      hasInitializedRef.current &&
      initialData &&
      initialData.id !== initialDataAplicadoRef.current?.id
    ) {
      initialDataAplicadoRef.current = initialData;
      cepAssociadoRef.current = initialData.cep
        ? formatarCep(initialData.cep).limpo
        : null;
      setReferenciaAberta(!!initialData.reference);
      setApelidoOutro(false);
      form.reset({
        name: initialData.name || "",
        cep: initialData.cep || "",
        street: initialData.street || "",
        number: initialData.number || "",
        complement: initialData.complement || "",
        neighborhood: initialData.neighborhood || "",
        city: initialData.city || "",
        state: initialData.state || "",
        reference: initialData.reference || "",
        recipient_name: initialData.recipient_name || "",
        is_default: !!initialData.is_default,
      });
    }
  }, [isLoaded, initialData, form, nomePadrao]);

  // O nome da conta pode chegar DEPOIS do mount (perfil ainda carregando):
  // só preenche se "Quem vai receber" ainda estiver vazio — nunca por cima do
  // que a pessoa digitou nem do destinatário de um endereço salvo.
  useEffect(() => {
    if (nomePadrao && !form.getValues("recipient_name")) {
      form.setValue("recipient_name", nomePadrao);
    }
  }, [nomePadrao, form]);

  const [
    cepAtual,
    rua,
    bairro,
    cidade,
    uf,
    apelido,
    numero,
    referencia,
    recebedor,
  ] = form.watch([
    "cep",
    "street",
    "neighborhood",
    "city",
    "state",
    "name",
    "number",
    "reference",
    "recipient_name",
  ]);
  const erros = form.formState.errors;

  const cepPronto = cepAtual.replace(/\D/g, "").length === 8;
  const enderecoCompleto = !!(rua && bairro && cidade && uf);
  const temErroNoEndereco = !!(
    erros.street ||
    erros.neighborhood ||
    erros.city ||
    erros.state
  );
  const buscaDeuCerto = resultadoCep === null || resultadoCep.tipo === "achou";

  // Quatro momentos da tela. Antes do 8º dígito só existe o CEP; com o
  // endereço completo (achado, ou já salvo numa edição) ele vira cartão; em
  // qualquer outro caso — CEP que a busca não achou, CEP de cidade inteira
  // sem rua, "Editar" — os campos abrem. A pessoa nunca fica sem caminho.
  const mostrarCartao =
    cepPronto &&
    !buscandoCep &&
    enderecoCompleto &&
    buscaDeuCerto &&
    !camposAbertos &&
    !temErroNoEndereco;
  const mostrarCampos = cepPronto && !buscandoCep && !mostrarCartao;
  const mostrarResto = cepPronto && !buscandoCep;

  // Trava os campos abertos assim que eles abrem por falta de dado (ver
  // `camposAbertos`). Não fecha sozinho: só uma busca nova (abaixo) fecha.
  useEffect(() => {
    if (mostrarCampos) setCamposAbertos(true);
  }, [mostrarCampos]);

  // A busca não achou o CEP: o que estava nos campos pertencia a OUTRO CEP
  // (o da busca anterior, ou o do endereço em edição) e não pode seguir
  // misturado com o CEP novo. Cadastro novo sem busca aplicada (`null`): o
  // que a pessoa digitou à mão fica — o mesmo critério do callback acima.
  useEffect(() => {
    if (!resultadoCep || resultadoCep.tipo === "achou") return;
    const cepDaBusca = cepEmBuscaRef.current;
    if (
      cepAssociadoRef.current !== null &&
      cepAssociadoRef.current !== cepDaBusca
    ) {
      for (const campo of [
        "street",
        "neighborhood",
        "city",
        "state",
      ] as const) {
        form.setValue(campo, "");
      }
      cepAssociadoRef.current = null;
    }
  }, [resultadoCep, form]);

  // Achou: a pessoa só tem um campo para preencher — leva o cursor até ele.
  // CEP achado mas incompleto: leva ao primeiro campo que falta.
  const jaFocouNaBuscaRef = useRef<unknown>(null);
  useEffect(() => {
    if (resultadoCep?.tipo !== "achou" || !mostrarResto) return;
    if (jaFocouNaBuscaRef.current === resultadoCep) return;
    jaFocouNaBuscaRef.current = resultadoCep;
    if (mostrarCartao) form.setFocus("number");
    else if (!rua) form.setFocus("street");
    else if (!bairro) form.setFocus("neighborhood");
  }, [resultadoCep, mostrarResto, mostrarCartao, rua, bairro, form]);

  const handleSubmit = async (values: AddressFormValues) => {
    setLoading(true);
    try {
      const cleanData: Omit<Address, "id" | "user_id"> = {
        name: values.name,
        cep: values.cep,
        street: values.street,
        number: values.number,
        complement: values.complement || "",
        neighborhood: values.neighborhood,
        city: values.city,
        state: values.state,
        is_default: values.is_default,
        reference: values.reference || "",
        recipient_name: values.recipient_name,
      };
      await onSubmit(cleanData);
    } catch (error) {
      console.error("Submit error:", error);
    } finally {
      setLoading(false);
    }
  };

  // Aviso do CEP, dentro da tela (era toast). Uma frase por situação, e o que
  // falta quando o CEP veio sem rua/bairro.
  const faltaNoCep = [
    !rua && "a rua",
    !bairro && "o bairro",
    !cidade && "a cidade",
    !uf && "o estado",
  ].filter((x): x is string => typeof x === "string");
  let avisoDoCep: { tom: "mudo" | "erro" | "atencao"; texto: string } | null =
    null;
  if (buscandoCep) {
    avisoDoCep = { tom: "mudo", texto: "Procurando o endereço deste CEP…" };
  } else if (erros.cep) {
    avisoDoCep = { tom: "erro", texto: erros.cep.message ?? "CEP inválido" };
  } else if (resultadoCep?.tipo === "naoEncontrado") {
    avisoDoCep = {
      tom: "erro",
      texto:
        "Não achamos este CEP. Confira os números ou preencha o endereço abaixo.",
    };
  } else if (resultadoCep?.tipo === "demorou") {
    avisoDoCep = {
      tom: "erro",
      texto:
        "A busca demorou demais. Confira o CEP ou preencha o endereço abaixo.",
    };
  } else if (resultadoCep?.tipo === "indisponivel") {
    avisoDoCep = {
      tom: "erro",
      texto: "Não deu para buscar o CEP agora. Preencha o endereço abaixo.",
    };
  } else if (resultadoCep?.tipo === "achou" && faltaNoCep.length > 0) {
    avisoDoCep = {
      tom: "atencao",
      texto: `Este CEP não informa ${juntarComE(faltaNoCep)}. Preencha abaixo.`,
    };
  }
  const cepComProblema =
    avisoDoCep?.tom === "erro" ||
    (resultadoCep !== null && resultadoCep.tipo !== "achou");
  const cepAchado = resultadoCep?.tipo === "achou" && !cepComProblema;

  const escolhaApelido = escolhaDoApelido(apelido, apelidoOutro);
  const semNumero = numero.trim().toUpperCase() === SEM_NUMERO;
  const nomeVemDaConta = !!nomePadrao && recebedor.trim() === nomePadrao;

  return (
    <form
      onSubmit={form.handleSubmit(handleSubmit)}
      className="flex flex-1 flex-col gap-4"
      noValidate
    >
      {/* CEP — grande, primeiro, o único campo à vista no começo */}
      <div>
        <label htmlFor="cep" className={ROTULO}>
          CEP
        </label>
        <Controller
          control={form.control}
          name="cep"
          render={({ field }) => {
            const handleCepChange = (
              e: React.ChangeEvent<HTMLInputElement>,
            ) => {
              const { limpo, formatado } = formatarCep(e.target.value);
              field.onChange(formatado);

              // `limpo.length === 8` é portante, não só filtro de busca:
              // um CEP incompleto (7 dígitos) gravaria em `cepEmBuscaRef` um
              // dono que a busca nunca respondeu, e a limpeza de
              // `eraDeOutroCep` dispararia sozinha depois.
              if (limpo.length === 8) {
                cepEmBuscaRef.current = limpo;
                setCamposAbertos(false);
                void buscarCep(limpo);
              } else {
                limparResultadoCep();
              }
            };

            return (
              <div className="relative">
                <input
                  id="cep"
                  name="cep"
                  value={field.value}
                  onChange={handleCepChange}
                  onBlur={field.onBlur}
                  placeholder="00000-000"
                  maxLength={9}
                  inputMode="numeric"
                  disabled={loading || buscandoCep}
                  aria-invalid={cepComProblema || !!erros.cep}
                  aria-describedby="aviso-cep"
                  className={cn(
                    CAMPO,
                    "h-16 rounded-[20px] px-4 pr-12 text-[22px] font-bold tracking-[0.04em] tabular-nums placeholder:font-bold placeholder:text-muted-foreground/40",
                    cepAchado &&
                      "border-emerald-200 bg-background dark:border-emerald-500/40",
                    (cepComProblema || !!erros.cep) && CAMPO_COM_ERRO,
                  )}
                  autoComplete="postal-code"
                />
                <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                  {buscandoCep && (
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  )}
                  {!buscandoCep && cepAchado && (
                    <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {!buscandoCep && (cepComProblema || !!erros.cep) && (
                    <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
                  )}
                </div>
              </div>
            );
          }}
        />
        {/* Sempre montado: leitor de tela anuncia a mudança de situação. */}
        <div id="aviso-cep" role="status" aria-live="polite">
          {avisoDoCep && (
            <p
              className={cn(
                "ml-0.5 mt-2 flex items-start gap-1.5 text-xs font-medium leading-snug",
                avisoDoCep.tom === "mudo" && "text-muted-foreground",
                avisoDoCep.tom === "erro" && "text-red-600 dark:text-red-400",
                avisoDoCep.tom === "atencao" &&
                  "text-amber-700 dark:text-amber-400",
              )}
            >
              {avisoDoCep.tom !== "mudo" && (
                <AlertCircle className="mt-px size-3.5 shrink-0" />
              )}
              {avisoDoCep.texto}
            </p>
          )}
        </div>
        {(!cepPronto || cepComProblema) && !buscandoCep && (
          <a
            href={URL_DESCOBRIR_CEP}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-0.5 mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-foreground underline decoration-border underline-offset-4"
          >
            Não sei meu CEP
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
      </div>

      {/* Cartão fantasma (antes do CEP) e cartão carregando (durante a busca) */}
      {!cepPronto && !buscandoCep && (
        <div className="flex gap-3 rounded-[20px] border-[1.5px] border-dashed border-border bg-muted/30 p-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-muted text-muted-foreground/50">
            <MapPin className="size-[18px]" />
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-[13px] font-semibold text-muted-foreground/70">
              Rua, bairro e cidade aparecem aqui
            </p>
            <div className="mt-2.5 h-3 w-[70%] rounded-md bg-muted" />
            <div className="mt-2 h-3 w-[45%] rounded-md bg-muted" />
          </div>
        </div>
      )}
      {buscandoCep && (
        <div
          className="flex gap-3 rounded-[20px] border border-border bg-card p-3.5"
          aria-hidden="true"
        >
          <div className="size-10 shrink-0 animate-pulse rounded-[13px] bg-muted" />
          <div className="flex-1 pt-1">
            <div className="h-3.5 w-3/4 animate-pulse rounded-md bg-muted" />
            <div className="mt-2.5 h-3 w-1/2 animate-pulse rounded-md bg-muted" />
            <div className="mt-3 h-[18px] w-[30%] animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      )}

      {mostrarResto && (
        <>
          {/* Endereço achado (ou já salvo): cartão. Senão: os campos. */}
          {mostrarCartao ? (
            <div
              data-testid="cartao-do-endereco"
              className="flex gap-3 rounded-[20px] border border-border bg-card p-3.5 shadow-sm"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-primary text-primary-foreground">
                <MapPin className="size-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold tracking-tight text-foreground">
                  {rua}
                </p>
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {bairro} · {cidade} – {uf}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  {resultadoCep?.tipo === "achou" && cepTrouxeRuaEBairro ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      <Check className="size-3" strokeWidth={2.5} />
                      Achado pelo CEP
                    </span>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setCamposAbertos(true);
                      requestAnimationFrame(() => form.setFocus("street"));
                    }}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-[10px] bg-muted px-2.5 py-1.5 text-[12.5px] font-semibold text-foreground"
                  >
                    <Pencil className="size-3.5" />
                    Editar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="street" className={ROTULO}>
                Rua ou avenida
              </label>
              <input
                id="street"
                {...form.register("street")}
                placeholder="Ex: Rua Tiradentes"
                disabled={loading}
                aria-invalid={!!erros.street}
                aria-describedby={erros.street ? "erro-street" : undefined}
                className={cn(CAMPO, erros.street && CAMPO_COM_ERRO)}
                autoComplete="address-line1"
              />
              {erros.street && (
                <MensagemDeErro id="erro-street">
                  {erros.street.message}
                </MensagemDeErro>
              )}
            </div>
          )}

          {/* Número e complemento */}
          <div>
            <div className="grid grid-cols-[118px_1fr] gap-2.5">
              <div>
                <label htmlFor="number" className={ROTULO}>
                  Número
                </label>
                <input
                  id="number"
                  {...form.register("number")}
                  placeholder="123"
                  disabled={loading}
                  aria-invalid={!!erros.number}
                  aria-describedby={erros.number ? "erro-number" : undefined}
                  className={cn(CAMPO, erros.number && CAMPO_COM_ERRO)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="complement" className={ROTULO}>
                  Complemento
                  <i className="font-medium not-italic text-muted-foreground/70">
                    opcional
                  </i>
                </label>
                <input
                  id="complement"
                  {...form.register("complement")}
                  placeholder="Apto, bloco, fundos"
                  disabled={loading}
                  className={CAMPO}
                  autoComplete="address-line2"
                />
              </div>
            </div>
            {erros.number && (
              <MensagemDeErro id="erro-number">
                {erros.number.message}
              </MensagemDeErro>
            )}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-pressed={semNumero}
                disabled={loading}
                onClick={() =>
                  form.setValue("number", semNumero ? "" : SEM_NUMERO, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
                  semNumero
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground",
                )}
              >
                Sem número
              </button>
              {!referenciaAberta && !referencia && (
                <button
                  type="button"
                  onClick={() => setReferenciaAberta(true)}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground"
                >
                  <Plus className="size-[15px]" />
                  Ponto de referência
                </button>
              )}
            </div>
          </div>

          {(referenciaAberta || !!referencia) && (
            <div>
              <label htmlFor="reference" className={ROTULO}>
                Ponto de referência
                <i className="font-medium not-italic text-muted-foreground/70">
                  opcional
                </i>
              </label>
              <input
                id="reference"
                {...form.register("reference")}
                placeholder="Ex: Próximo ao mercado principal"
                disabled={loading}
                className={CAMPO}
                autoComplete="off"
              />
            </div>
          )}

          {mostrarCampos && (
            <>
              <div>
                <label htmlFor="neighborhood" className={ROTULO}>
                  Bairro
                </label>
                <input
                  id="neighborhood"
                  {...form.register("neighborhood")}
                  placeholder="Seu bairro"
                  disabled={loading}
                  aria-invalid={!!erros.neighborhood}
                  aria-describedby={
                    erros.neighborhood ? "erro-neighborhood" : undefined
                  }
                  className={cn(CAMPO, erros.neighborhood && CAMPO_COM_ERRO)}
                  autoComplete="address-level3"
                />
                {erros.neighborhood && (
                  <MensagemDeErro id="erro-neighborhood">
                    {erros.neighborhood.message}
                  </MensagemDeErro>
                )}
              </div>

              <div className="grid grid-cols-[1fr_84px] gap-2.5">
                <div>
                  <label htmlFor="city" className={ROTULO}>
                    Cidade
                  </label>
                  <input
                    id="city"
                    {...form.register("city")}
                    placeholder="Cidade"
                    disabled={loading}
                    aria-invalid={!!erros.city}
                    aria-describedby={erros.city ? "erro-city" : undefined}
                    className={cn(CAMPO, erros.city && CAMPO_COM_ERRO)}
                    autoComplete="address-level2"
                  />
                  {erros.city && (
                    <MensagemDeErro id="erro-city">
                      {erros.city.message}
                    </MensagemDeErro>
                  )}
                </div>
                <div>
                  <label htmlFor="state" className={ROTULO}>
                    UF
                  </label>
                  <input
                    id="state"
                    {...form.register("state")}
                    placeholder="UF"
                    disabled={loading}
                    maxLength={2}
                    aria-invalid={!!erros.state}
                    aria-describedby={erros.state ? "erro-state" : undefined}
                    className={cn(
                      CAMPO,
                      "px-2 text-center uppercase",
                      erros.state && CAMPO_COM_ERRO,
                    )}
                    autoComplete="address-level1"
                  />
                  {erros.state && (
                    <MensagemDeErro id="erro-state">
                      {erros.state.message}
                    </MensagemDeErro>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Quem vai receber — já com o nome da conta */}
          <div>
            <label htmlFor="recipient_name" className={ROTULO}>
              Quem vai receber
              {nomeVemDaConta && (
                <span className="text-[11px] font-semibold text-muted-foreground">
                  da sua conta
                </span>
              )}
            </label>
            <input
              id="recipient_name"
              {...form.register("recipient_name")}
              placeholder="Quem irá receber?"
              disabled={loading}
              aria-invalid={!!erros.recipient_name}
              aria-describedby={
                erros.recipient_name ? "erro-recipient_name" : undefined
              }
              className={cn(CAMPO, erros.recipient_name && CAMPO_COM_ERRO)}
              autoComplete="name"
            />
            {erros.recipient_name && (
              <MensagemDeErro id="erro-recipient_name">
                {erros.recipient_name.message}
              </MensagemDeErro>
            )}
          </div>

          {/* Salvar como — botões; "Outro" abre o campo de texto */}
          <div>
            <p id="rotulo-apelido" className={ROTULO}>
              Salvar como
            </p>
            <div
              role="group"
              aria-labelledby="rotulo-apelido"
              className="flex flex-wrap gap-2"
            >
              {(
                [
                  { escolha: "Casa", Icone: Home },
                  { escolha: "Trabalho", Icone: Briefcase },
                  { escolha: "Outro", Icone: Tag },
                ] as const
              ).map(({ escolha, Icone }) => {
                const ligado = escolhaApelido === escolha;
                return (
                  <button
                    key={escolha}
                    type="button"
                    aria-pressed={ligado}
                    disabled={loading}
                    onClick={() => {
                      if (escolha === "Outro") {
                        setApelidoOutro(true);
                        // Não deixa "Casa"/"Trabalho" pré-preencher o campo
                        // de texto de quem escolheu escrever o próprio nome.
                        if (escolhaApelido !== "Outro") {
                          form.setValue("name", "", { shouldDirty: true });
                        }
                        requestAnimationFrame(() => form.setFocus("name"));
                        return;
                      }
                      setApelidoOutro(false);
                      form.setValue(
                        "name",
                        escolha === "Casa" ? APELIDO_CASA : APELIDO_TRABALHO,
                        { shouldValidate: true, shouldDirty: true },
                      );
                    }}
                    className={cn(
                      "inline-flex h-[42px] items-center gap-1.5 rounded-[14px] border-[1.5px] px-3.5 text-sm font-semibold transition-colors",
                      ligado
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground/80",
                    )}
                  >
                    <Icone className="size-4" />
                    {escolha}
                  </button>
                );
              })}
            </div>
            {escolhaApelido === "Outro" && (
              <div className="mt-2.5">
                <label htmlFor="name" className="sr-only">
                  Nome deste endereço
                </label>
                <input
                  id="name"
                  {...form.register("name")}
                  placeholder="Ex: Casa da vó, Escritório"
                  disabled={loading}
                  aria-invalid={!!erros.name}
                  aria-describedby={erros.name ? "erro-name" : undefined}
                  className={cn(CAMPO, erros.name && CAMPO_COM_ERRO)}
                  autoComplete="off"
                />
              </div>
            )}
            {erros.name && (
              <MensagemDeErro id="erro-name">
                {erros.name.message}
              </MensagemDeErro>
            )}
          </div>

          {/* Endereço principal */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <label
              htmlFor="is_default"
              className="min-w-0 flex-1 cursor-pointer"
            >
              <span className="block text-sm font-semibold text-foreground">
                Endereço principal
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Já vem escolhido no carrinho
              </span>
            </label>
            <Controller
              control={form.control}
              name="is_default"
              render={({ field }) => (
                <Switch
                  id="is_default"
                  name="is_default"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={loading}
                />
              )}
            />
          </div>

          <div className="flex justify-center">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={loading}
              className="h-10 rounded-xl px-5 text-xs font-semibold text-muted-foreground"
            >
              Cancelar
            </Button>
          </div>
        </>
      )}

      {/* Barra de salvar: fixa embaixo, acima da navegação inferior */}
      <div className="bottom-docked-navigation sticky z-20 -mx-1 mt-auto md:bottom-[104px] border-t border-border bg-background/95 px-1 pb-2.5 pt-3 backdrop-blur">
        <Button
          type="submit"
          disabled={loading || buscandoCep}
          className={cn(
            "h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/20 transition-all active:scale-[0.98]",
            // Antes de haver um CEP completo o botão se mostra apagado, mas
            // continua tocável: tocar nele mostra o que falta (CEP inválido)
            // em vez de não responder.
            !cepPronto &&
              "bg-muted text-muted-foreground shadow-none hover:bg-muted",
          )}
        >
          {loading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            "Salvar endereço"
          )}
        </Button>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
          <Lock className="size-3" />
          Usado só para a entrega do seu pedido.
        </p>
      </div>
    </form>
  );
}
