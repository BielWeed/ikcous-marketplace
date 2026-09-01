import { hexToTailwindHsl } from "@/config/branding";
import { useAuth } from "@/hooks/useAuth";
import { useSyncListener } from "@/hooks/useDataVault";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { DataVault } from "@/lib/dataVault";
import { mapProductFromDB } from "@/lib/mappers";
import { mesclarProdutoNaLista } from "@/lib/mescla-de-produtos";
import { precoVendido } from "@/lib/preco-vendido";
import { RealtimeSyncEngine } from "@/lib/realtimeSyncEngine";
import { supabase } from "@/lib/supabase";
import type { CartItem, Product, ShippingOption, StoreConfig } from "@/types";
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";

// Exportado porque a regra de cor efetiva (abaixo) é o dono único do contrato:
// quem precisa decidir "cor do banco x semente do build" pergunta aqui —
// App.tsx (meta theme-color) e o efeito de --primary deste arquivo.
// (definição movida para src/config/cor-da-loja.ts — ver motivo lá)
import { corPrimariaEfetiva, defaultStoreConfig } from "@/config/cor-da-loja";
export { corPrimariaEfetiva, defaultStoreConfig } from "@/config/cor-da-loja";

interface StoreContextType {
  config: StoreConfig;
  isLoaded: boolean;
  products: Product[];
  loadingProducts: boolean;
  /**
   * Devolve `true` se a configuração foi mesmo gravada, `false` se não.
   *
   * Era `Promise<void>` e engolia qualquer falha — RLS, sessão expirada, rede —
   * devolvendo normalmente. Todo chamador seguia para `onSetDirty(false)`,
   * fechava modal e mostrava toast de sucesso em cima de uma gravação que não
   * aconteceu (ADMIN-010, #94).
   *
   * Quem chama TEM de olhar o retorno. O toast de erro já sai daqui de dentro;
   * o chamador só precisa não seguir em frente.
   */
  updateConfig: (updates: Partial<StoreConfig>) => Promise<boolean>;
  refresh: (options?: { onlyConfig?: boolean }) => Promise<void>;
  fetchProducts: () => Promise<void>;
  calculateShipping: (
    cart: CartItem[],
    selectedOption?: ShippingOption | null,
  ) => number;
}

// ── Conferência do retorno de upsert_store_config (ADMIN-010 / #94, parte 2) ──
//
// A RPC tem lista fixa de colunas no INSERT e no ON CONFLICT DO UPDATE:
// qualquer chave de `config_json` fora dela é descartada em silêncio, e a
// função ainda faz `updated_at = now()` e devolve sucesso -- foi assim que
// `home_sections` nunca gravou. O conserto de #94 já garantia "só declara
// sucesso se a RPC não devolveu erro", mas isso confia no STATUS de quem
// grava, não no que foi gravado. A RPC termina com
// `RETURNING to_jsonb(public.store_config.*) INTO result`, ou seja, já
// devolve a linha inteira como ficou -- e é isso que passamos a conferir.
//
// Tipo de cada coluna que a RPC aceita, para decidir COMO comparar o valor
// enviado (JS) contra o valor devolvido (Postgres -> JSON -> JS). A
// comparação atravessa essa fronteira, então igualdade estrita ingênua dá
// falso positivo (numeric pode ter sido mandado como string; array e jsonb
// não são `===`) -- e falso positivo aqui é pior que o defeito original: a
// lojista grava certo e a tela diz que deu erro.
type TipoColunaStoreConfig =
  | "numeric"
  | "boolean"
  | "texto"
  | "texto_array"
  | "home_sections";

// `Map`, não `Record` -- `chave` vem do banco (nome de coluna que a RPC
// devolveu) e indexar objeto com string vinda de fora é exatamente o que
// `security/detect-object-injection` aponta (o `in`/`[]` de baixo enxergam
// o PROTÓTIPO do objeto, não só as chaves próprias). `Map.get` não confunde
// chave com propriedade herdada.
export const TIPO_DAS_COLUNAS_STORE_CONFIG = new Map<
  string,
  TipoColunaStoreConfig
>([
  ["free_shipping_min", "numeric"],
  ["shipping_fee", "numeric"],
  ["local_delivery_fee", "numeric"],
  ["whatsapp_number", "texto"],
  ["share_text", "texto"],
  ["business_hours", "texto"],
  ["enable_reviews", "boolean"],
  ["enable_coupons", "boolean"],
  ["logo_url", "texto"],
  ["primary_color", "texto"],
  ["theme_mode", "texto"],
  ["real_time_sales_alerts", "boolean"],
  ["push_marketing_enabled", "boolean"],
  ["min_app_version", "texto"],
  ["store_name", "texto"],
  ["store_city", "texto"],
  ["store_state", "texto"],
  ["origin_cep", "texto"],
  ["shipping_provider", "texto"],
  ["enabled_shipping_methods", "texto_array"],
  ["shipping_coverage", "texto"],
  ["local_cep_range", "texto"],
  ["home_sections", "home_sections"],
]);

// Normaliza um valor de `home_sections` para comparação POR VALOR: ordena
// as chaves de OBJETO (o round-trip por `jsonb` pode reordenar objeto --
// medido: enviou {id, title, active, type, maxItems, productIds, isCustom}
// e voltou {id, type, title, active, isCustom, maxItems, productIds}) e
// preserva a ORDEM de ARRAY (é a ordem das vitrines na home, e ela
// importa). `Object.entries`/`Object.fromEntries` em vez de indexar com
// `chave` -- mesmo motivo do Map acima.
function normalizarHomeSections(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizarHomeSections);
  if (v && typeof v === "object") {
    const entradasOrdenadas = Object.entries(v as Record<string, unknown>)
      .sort(([chaveA], [chaveB]) =>
        chaveA < chaveB ? -1 : chaveA > chaveB ? 1 : 0,
      )
      .map(([chave, valor]) => [chave, normalizarHomeSections(valor)] as const);
    return Object.fromEntries(entradasOrdenadas);
  }
  return v;
}

// `home_sections` carrega `productIds`, um ARRAY -- comparar por `===`
// campo a campo compara REFERÊNCIA, e o array que a RPC devolve (saído do
// JSON.parse da resposta) nunca é `===` ao array da tela, mesmo com o
// mesmo conteúdo. `[] === []` é sempre `false`. Por isso a comparação
// serializa o valor NORMALIZADO -- por valor, recursiva.
function homeSectionsForamGravadas(
  enviado: unknown,
  gravado: unknown,
): boolean {
  if (!Array.isArray(enviado) || !Array.isArray(gravado)) return false;
  if (enviado.length !== gravado.length) return false;
  return (
    JSON.stringify(normalizarHomeSections(enviado)) ===
    JSON.stringify(normalizarHomeSections(gravado))
  );
}

// DECISÃO — o caso do COALESCE no ramo INSERT (linha nova) da RPC:
//
// upsert_store_config aplica COALESCE(..., default) em várias colunas só no
// ramo de INSERT (primeira gravação, quando a linha id=1 ainda não existe).
// Se alguém mandasse `null` explícito para uma dessas colunas nesse ramo, o
// banco gravaria o default, não o `null` pedido -- e o comparador abaixo
// trata isso como FALHA de propósito, porque o pedido não foi honrado.
//
// Hoje isso é inalcançável pelo app: (1) toda chave que algum ponto da UI
// manda como `null` explícito hoje -- storeCity, storeState em
// AdminSettingsView -- é coluna SEM COALESCE (grava null de verdade, sem
// substituição); nenhum chamador de updateConfig() (AdminShippingView,
// AdminWhatsAppConfigView, AdminCouponsView, AdminReviewsView, AdminPushView,
// AdminCarouselsView) manda `null` para whatsapp_number, share_text,
// business_hours, primary_color, theme_mode, enable_reviews, enable_coupons,
// real_time_sales_alerts, push_marketing_enabled, shipping_provider,
// shipping_coverage, free_shipping_min ou local_delivery_fee -- que são as
// colunas com COALESCE. E (2) a linha id=1 já existe antes de qualquer save
// ser alcançável: `fetchConfig` cria essa linha automaticamente (para admin)
// assim que a tela carrega, então `updateConfig` nunca bate no ramo INSERT
// na prática. Se isso um dia mudar, o comparador não finge sucesso.
function valorFoiGravado(
  tipo: TipoColunaStoreConfig,
  enviado: unknown,
  gravado: unknown,
): boolean {
  // `null` explícito ("a loja não disse" / "limpar campo") tem de continuar
  // `null` -- exceto no caso do COALESCE-no-INSERT acima, que é um "não",
  // de propósito, não um "sim" disfarçado.
  if (enviado === null) return gravado === null;

  switch (tipo) {
    case "numeric": {
      // `Number(null) === 0` e `Number("") === 0` -- coagir os DOIS lados
      // pelo `Number(...)` abaixo faria o banco devolver `null` (= não
      // gravou) ou a tela mandar string vazia (input limpo) passarem como
      // confirmação de um `0` pedido/gravado. A assimetria é proposital:
      // o que o banco devolveu é o FATO (nunca coagido); só o que a tela
      // mandou pode vir em formato frouxo.
      if (gravado === null || gravado === undefined) return false;
      if (typeof enviado === "string" && enviado.trim() === "") return false;
      // O front às vezes manda number, às vezes string (input não
      // parseado); o banco sempre devolve number. Comparar pelo valor, não
      // pelo tipo do JS.
      const numEnviado = Number(enviado);
      return !Number.isNaN(numEnviado) && Number(gravado) === numEnviado;
    }
    case "boolean":
      // Comparação estrita: só bate se o valor gravado for exatamente o
      // booleano pedido -- string "false" ou 0 não contam como confirmação.
      return typeof gravado === "boolean" && gravado === enviado;
    case "texto":
      return gravado === enviado;
    case "texto_array":
      // Comparação por valor da lista inteira, em vez de indexar os dois
      // arrays por `i` -- mesmo motivo do Map acima (evita
      // `security/detect-object-injection`) e continua sensível a ORDEM
      // (é como a comparação elemento a elemento original se comportava).
      return (
        Array.isArray(gravado) &&
        Array.isArray(enviado) &&
        gravado.length === enviado.length &&
        JSON.stringify(gravado) === JSON.stringify(enviado)
      );
    case "home_sections":
      return homeSectionsForamGravadas(enviado, gravado);
    default:
      // Coluna que este mapa não conhece: dúvida, nunca sucesso.
      return false;
  }
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

// Contrato de identidade do shareText (só na LEITURA, não é migration): o
// texto default histórico ("Olha que achei na IKCOUS!", nunca customizado
// pela loja) cita o nome da loja QUANDO o banco tem um (store_name). Sem
// store_name, o texto volta cru: a igualdade byte a byte com o default é o
// que impede o mount de gravar config "nova" no DataVault sem nada ter
// mudado (medido: compor com branding.appName quebrava essa igualdade e
// disparava um put a cada primeiro carregamento). Texto customizado nunca
// é sobrescrito; o default gravado NO BANCO (dbInsert) segue o histórico.
function componhaShareText(
  bruto: string | undefined,
  storeName: string | undefined,
): string {
  const texto = bruto ?? defaultStoreConfig.shareText;
  if (texto !== defaultStoreConfig.shareText) return texto;
  if (!storeName) return texto;
  return `Olha que achei na ${storeName}!`;
}

export function StoreProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { isAdmin, loading, user } = useAuth();
  const { isLeader } = useLeaderElection();
  const vaultRef = useRef<DataVault | null>(null);
  const [config, setConfig] = useState<StoreConfig>(defaultStoreConfig);
  const [isLoaded, setIsLoaded] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // ── DataVault: Load config from IDB on mount (instant, <5ms) ──
  useEffect(() => {
    let cancelled = false;
    const loadFromVault = async () => {
      try {
        const vault = await DataVault.init();
        vaultRef.current = vault;

        // Load config from IDB
        const cachedConfig = await vault.getById<any>(
          "store_config",
          "singleton",
        );
        if (cachedConfig && !cancelled) {
          const { id: _id, ...configData } = cachedConfig;
          const merged = { ...defaultStoreConfig, ...configData };
          // shareText com nome efetivo — mesmo contrato do mapConfig (o
          // cache pode ter texto cru gravado pelo realtimeSyncEngine).
          merged.shareText = componhaShareText(
            merged.shareText,
            merged.storeName,
          );
          setConfig(merged);
          setIsLoaded(true);
          // Apply branding immediately — também pela REGRA (dono único): o
          // cache pode carregar config sem cor (ou o lojista escolheu preto,
          // que é real e passa). Nada aplica valor cru por fora daqui.
          const corCache = corPrimariaEfetiva(merged);
          if (corCache) {
            document.documentElement.style.setProperty(
              "--primary",
              hexToTailwindHsl(corCache),
            );
          }
          // ADMIN-100 (#102): a classe `dark` (e o atributo `data-theme-mode`)
          // NÃO é mexida aqui. App.tsx é o único dono — ele decide com base em
          // `currentView` (admin força escuro) e `config.themeMode` (loja
          // segue o que o lojista configurou). Duas mãos na mesma classe era
          // exatamente o que fazia o admin virar tema claro no meio da
          // sessão ao salvar a cor primária: este efeito disparava (a
          // primaryColor mudou), recalculava com base só no themeMode e
          // desfazia o "dark" que o App já tinha colocado por estar em rota
          // de admin.
        }

        // Load products from IDB
        const cachedProducts = await vault.getAll<Product>("products");
        if (cachedProducts.length > 0 && !cancelled) {
          setProducts(cachedProducts);
          setLoadingProducts(false);
        }
      } catch (err) {
        console.error(
          "[StoreContext] DataVault load failed, purging cache stores and fetching from network:",
          err,
        );
        try {
          const vault = await DataVault.init();
          if (vault) {
            const stores: import("@/lib/dataVault").StoreName[] = [
              "products",
              "categories",
              "banners",
              "store_config",
              "coupons",
              "product_variants",
              "_meta",
            ];
            await Promise.all(
              stores.map((s) => vault.clear(s).catch(() => {})),
            );
          }
        } catch (clearErr) {
          console.error(
            "[StoreContext] Failed to clear DataVault stores:",
            clearErr,
          );
        }
        // Fallback to let UI load from network instead of hanging on loader
        setIsLoaded(true);
        setLoadingProducts(true);
      }
    };
    loadFromVault();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyBranding = useCallback((primaryColor?: string | null) => {
    if (primaryColor) {
      document.documentElement.style.setProperty(
        "--primary",
        hexToTailwindHsl(primaryColor),
      );
    }
  }, []);

  // ADMIN-100 (#102): só a cor primária é aplicada aqui. A classe `dark` e o
  // atributo `data-theme-mode` são dono único do App.tsx (ver comentário no
  // efeito de loadFromVault acima) — App.tsx já reage a `config.themeMode`
  // pelo mesmo contexto, então remover a duplicata aqui não deixa nenhum
  // dos três valores de themeMode (light/dark/glass) sem quem aplique.
  //
  // CONTRATO DE COR — precedência: o branding do build (applyBranding em
  // main.tsx) é a semente anti-flash no :root; o primary_color do BANCO vence
  // quando a config chega OU muda — e vence SEMPRE pela regra de
  // corPrimariaEfetiva, em TODOS os caminhos (cache, fetch, updateConfig,
  // realtime). Sentinela de "sem valor" é AUSÊNCIA: sem primary_color nem no
  // default nem gravado pelo app, ausente = fica a semente do build; um valor
  // presente é sempre real, inclusive #000000 (preto é escolha legítima).
  // Este efeito garante a re-aplicação em qualquer mudança posterior.
  useEffect(() => {
    // Regra mora em corPrimariaEfetiva — dono único (o meta theme-color do
    // App.tsx consulta o mesmo lugar).
    const cor = corPrimariaEfetiva(config);
    if (cor) applyBranding(cor);
    // `config` inteiro não entra de propósito: a única entrada reativa da
    // regra é `config.primaryColor` (a comparação com o default é contra
    // constante estável). A regra não enxerga dentro da helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.primaryColor, applyBranding]);

  const mapConfig = useCallback((data: any): StoreConfig => {
    const getVal = (snake: string, camel: string, fallback: any) => {
      if (data[snake] !== undefined && data[snake] !== null) return data[snake];
      if (data[camel] !== undefined && data[camel] !== null) return data[camel];
      return fallback;
    };

    const freeMin = getVal(
      "free_shipping_min",
      "freeShippingMin",
      defaultStoreConfig.freeShippingMin,
    );
    const shipFee = getVal(
      "shipping_fee",
      "shippingFee",
      defaultStoreConfig.shippingFee,
    );
    const localFee = getVal(
      "local_delivery_fee",
      "localDeliveryFee",
      defaultStoreConfig.localDeliveryFee,
    );
    const storeName = getVal("store_name", "storeName", undefined);

    return {
      freeShippingMin: Number(freeMin),
      shippingFee: Number(shipFee),
      whatsappNumber: getVal(
        "whatsapp_number",
        "whatsappNumber",
        defaultStoreConfig.whatsappNumber,
      ),
      shareText: componhaShareText(
        getVal("share_text", "shareText", defaultStoreConfig.shareText),
        storeName,
      ),
      businessHours: getVal(
        "business_hours",
        "businessHours",
        defaultStoreConfig.businessHours,
      ),
      enableReviews: getVal(
        "enable_reviews",
        "enableReviews",
        defaultStoreConfig.enableReviews,
      ),
      enableCoupons: getVal(
        "enable_coupons",
        "enableCoupons",
        defaultStoreConfig.enableCoupons,
      ),
      logoUrl: getVal("logo_url", "logoUrl", undefined),
      primaryColor: getVal("primary_color", "primaryColor", undefined),
      themeMode: getVal(
        "theme_mode",
        "themeMode",
        defaultStoreConfig.themeMode,
      ),
      realTimeSalesAlerts: getVal(
        "real_time_sales_alerts",
        "realTimeSalesAlerts",
        defaultStoreConfig.realTimeSalesAlerts,
      ),
      pushMarketingEnabled: getVal(
        "push_marketing_enabled",
        "pushMarketingEnabled",
        defaultStoreConfig.pushMarketingEnabled,
      ),
      minAppVersion: getVal("min_app_version", "minAppVersion", undefined),
      storeName,
      storeCity: getVal("store_city", "storeCity", undefined),
      storeState: getVal("store_state", "storeState", undefined),
      originCep: getVal("origin_cep", "originCep", undefined),
      shippingProvider: getVal(
        "shipping_provider",
        "shippingProvider",
        defaultStoreConfig.shippingProvider,
      ),
      enabledShippingMethods: getVal(
        "enabled_shipping_methods",
        "enabledShippingMethods",
        defaultStoreConfig.enabledShippingMethods,
      ),
      shippingCoverage: getVal(
        "shipping_coverage",
        "shippingCoverage",
        defaultStoreConfig.shippingCoverage,
      ),
      localDeliveryFee: Number(localFee),
      localCepRange: getVal(
        "local_cep_range",
        "localCepRange",
        defaultStoreConfig.localCepRange,
      ),
      homeSections: getVal(
        "home_sections",
        "homeSections",
        defaultStoreConfig.homeSections,
      ),
    };
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const tableSource = isAdmin ? "store_config" : "v_store_config";
      const { data, error } = await supabase
        .from(tableSource as any)
        .select("*")
        .single();

      if (error) {
        console.error("[StoreContext] Config fetch error:", error);
        if (isAdmin && error.code === "PGRST116") {
          // Initialize if missing (admin only)
          const dbInsert = {
            id: 1,
            free_shipping_min: 350,
            shipping_fee: 15,
            // Laudo 31/08 (menor E): a semente gravava "" (o default do
            // front) em whatsapp_number/business_hours — uma SEGUNDA
            // representação de "a loja não disse", ao lado do NULL que a
            // 20261033000000 plantou no banco. NULL aqui: nasce sem número
            // e sem horário de verdade, do jeito que a leitura já entende.
            whatsapp_number: defaultStoreConfig.whatsappNumber || null,
            share_text: defaultStoreConfig.shareText,
            business_hours: defaultStoreConfig.businessHours || null,
            enable_reviews: defaultStoreConfig.enableReviews,
            enable_coupons: defaultStoreConfig.enableCoupons,
            // NULL EXPLÍCITO: a coluna tem DEFAULT '#000000' no banco
            // (baseline_do_schema_vivo, seção store_config) — omitir o campo
            // fazia o POSTGRES gravar preto calado, e na regra nova preto é
            // preto de verdade: a loja de marca colorida renderizaria PRETA
            // por cima da cor do build. NULL vence o DEFAULT da coluna: a
            // linha nasce SEM cor, e ausente quer dizer ausente.
            primary_color: null,
            theme_mode: defaultStoreConfig.themeMode,
            real_time_sales_alerts: defaultStoreConfig.realTimeSalesAlerts,
            push_marketing_enabled: defaultStoreConfig.pushMarketingEnabled,
            shipping_provider: defaultStoreConfig.shippingProvider,
            enabled_shipping_methods: defaultStoreConfig.enabledShippingMethods,
            shipping_coverage: defaultStoreConfig.shippingCoverage,
            local_delivery_fee: defaultStoreConfig.localDeliveryFee,
            local_cep_range: defaultStoreConfig.localCepRange,
            home_sections: defaultStoreConfig.homeSections,
          };

          const { data: newData, error: insertError } = (await supabase
            .from("store_config")
            .insert([dbInsert as any])
            .select()
            .single()) as any;

          if (!insertError && newData) {
            const mapped = mapConfig(newData);
            setConfig((prev) => {
              const isIdentical = Object.keys(mapped).every((k) => {
                if (k === "enabledShippingMethods") {
                  const arrA = mapped[k] || [];
                  const arrB = prev[k] || [];
                  if (arrA.length !== arrB.length) return false;
                  return arrA.every((v, i) => v === arrB[i]);
                }
                return (mapped as any)[k] === (prev as any)[k];
              });
              if (isIdentical) return prev;
              vaultRef.current
                ?.put("store_config", { id: "singleton", ...mapped })
                .catch(() => {});
              return mapped;
            });
            applyBranding(corPrimariaEfetiva(mapped));
          }
        }
      } else if (data) {
        const mapped = mapConfig(data);
        setConfig((prev) => {
          const isIdentical = Object.keys(mapped).every((k) => {
            if (k === "enabledShippingMethods") {
              const arrA = mapped[k] || [];
              const arrB = prev[k] || [];
              if (arrA.length !== arrB.length) return false;
              return arrA.every((v, i) => v === arrB[i]);
            }
            return (mapped as any)[k] === (prev as any)[k];
          });
          if (isIdentical) return prev;
          // Sempre pelo singleton: após um onversionchange (outra aba subiu a
          // versão) a conexão que vaultRef segurava está FECHADA — init()
          // devolve a viva/reaberta. Erro LOGADO: escrita engolida calada é
          // como o cache offline morreu invisível (defeito confirmado na
          // revisão cruzada 20260825-1050).
          DataVault.init()
            .then((vault) =>
              vault.put("store_config", { id: "singleton", ...mapped }),
            )
            .catch((err) =>
              console.warn(
                "[StoreContext] config não gravada no cache offline:",
                err,
              ),
            );
          return mapped;
        });
        applyBranding(corPrimariaEfetiva(mapped));
      }
    } catch (err) {
      console.error("[StoreContext] Config error:", err);
    } finally {
      setIsLoaded(true);
    }
  }, [isAdmin, mapConfig, applyBranding]);

  const fetchProducts = useCallback(async () => {
    // Stale-While-Revalidate: IDB data already loaded in mount effect.
    // This function always fetches fresh data from Supabase (background revalidation).

    try {
      let data: any[] | null = null;
      let error: any = null;

      // Only query admin view if admin is verified and auth is not loading
      if (isAdmin && !loading) {
        const res = await supabase
          .from("vw_produtos_admin")
          .select("*, product_variants(*)")
          .is("deleted_at", null)
          .limit(200)
          .order("data_cadastro", { ascending: false });
        data = res.data;
        error = res.error;
      }

      // Fallback to public view if not admin or if admin query failed (e.g., PGRST205 or unauthenticated)
      if (!isAdmin || loading || error) {
        const publicRes = await supabase
          .from("vw_produtos_public")
          .select("*, product_variants(*)")
          .limit(200)
          .order("data_cadastro", { ascending: false });

        if (publicRes.error && error) {
          throw error;
        }

        if (publicRes.data) {
          data = publicRes.data;
          error = null;
        }
      }

      if (error) throw error;

      if (data && data.length > 0) {
        const mapped = (data as any[]).map((item: any) =>
          mapProductFromDB(item),
        );

        setProducts((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(mapped)) return prev;
          // Persist to DataVault (non-blocking)
          // Pelo singleton e com erro logado — mesma regra dos puts de config
          // (revisão 20260825-1050): conexão fechada por upgrade de outra aba
          // reabre no init(), e falha de escrita não pode ser silêncio.
          DataVault.init()
            .then(async (vault) => {
              await vault.replaceAll("products", mapped);
              await vault.setLastSync("products");
            })
            .catch((err) =>
              console.warn(
                "[StoreContext] produtos não gravados no cache offline:",
                err,
              ),
            );
          return mapped;
        });
      } else {
        setProducts((prev) => (prev.length === 0 ? prev : []));
      }
    } catch (err) {
      console.error("[StoreContext] Products fetch error:", err);
    } finally {
      setLoadingProducts(false);
    }
  }, [isAdmin, loading]);

  const updateConfig = useCallback(
    async (updates: Partial<StoreConfig>): Promise<boolean> => {
      try {
        if (!isAdmin) {
          toast.error("Acesso negado");
          return false;
        }

        const dbUpdates: any = {};
        if (updates.freeShippingMin !== undefined)
          dbUpdates.free_shipping_min = updates.freeShippingMin;
        if (updates.shippingFee !== undefined)
          dbUpdates.shipping_fee = updates.shippingFee;
        if (updates.whatsappNumber !== undefined)
          // Laudo 31/08 (menor E): limpar o campo no painel não replanta a
          // sentinela "" que a 20261033000000 apagou do banco — vazio é NULL.
          dbUpdates.whatsapp_number = updates.whatsappNumber || null;
        if (updates.shareText !== undefined)
          dbUpdates.share_text = updates.shareText;
        if (updates.businessHours !== undefined)
          dbUpdates.business_hours = updates.businessHours || null;
        if (updates.enableReviews !== undefined)
          dbUpdates.enable_reviews = updates.enableReviews;
        if (updates.enableCoupons !== undefined)
          dbUpdates.enable_coupons = updates.enableCoupons;
        if (updates.logoUrl !== undefined) dbUpdates.logo_url = updates.logoUrl;
        if (updates.primaryColor !== undefined)
          dbUpdates.primary_color = updates.primaryColor;
        if (updates.themeMode !== undefined)
          dbUpdates.theme_mode = updates.themeMode;
        if (updates.realTimeSalesAlerts !== undefined)
          dbUpdates.real_time_sales_alerts = updates.realTimeSalesAlerts;
        if (updates.pushMarketingEnabled !== undefined)
          dbUpdates.push_marketing_enabled = updates.pushMarketingEnabled;
        if (updates.minAppVersion !== undefined)
          dbUpdates.min_app_version = updates.minAppVersion;
        if (updates.storeName !== undefined)
          dbUpdates.store_name = updates.storeName;
        if (updates.storeCity !== undefined)
          dbUpdates.store_city = updates.storeCity;
        if (updates.storeState !== undefined)
          dbUpdates.store_state = updates.storeState;
        if (updates.originCep !== undefined)
          dbUpdates.origin_cep = updates.originCep;
        if (updates.shippingProvider !== undefined)
          dbUpdates.shipping_provider = updates.shippingProvider;
        if (updates.enabledShippingMethods !== undefined)
          dbUpdates.enabled_shipping_methods = updates.enabledShippingMethods;
        if (updates.shippingCoverage !== undefined)
          dbUpdates.shipping_coverage = updates.shippingCoverage;
        if (updates.localDeliveryFee !== undefined)
          dbUpdates.local_delivery_fee = updates.localDeliveryFee;
        if (updates.localCepRange !== undefined)
          dbUpdates.local_cep_range = updates.localCepRange;
        if (updates.homeSections !== undefined)
          dbUpdates.home_sections = updates.homeSections;

        const { data, error } = await (supabase.rpc as any)(
          "upsert_store_config",
          { config_json: dbUpdates },
        );

        if (error) throw error;

        // A RPC não errou, mas "não errou" não é "gravou o que pedimos" --
        // ela tem lista fixa de colunas e descarta em silêncio o que não
        // conhece. Falha fechado: retorno vazio, nulo ou de formato que não
        // dá para avaliar é falha, nunca sucesso.
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          console.error(
            "[StoreContext] Update retornou em formato inesperado:",
            data,
          );
          toast.error(
            "Não foi possível confirmar que as configurações foram salvas. Tente novamente.",
          );
          return false;
        }

        const gravado = data as Record<string, unknown>;
        // `Map`, não indexação de `gravado` por `chave` -- o operador `in`
        // enxerga o PROTÓTIPO do objeto (`"constructor" in gravado` é
        // `true` mesmo que o banco jamais tenha devolvido essa coluna), e
        // `gravado[chave]`/`dbUpdates[chave]` são exatamente o padrão que
        // `security/detect-object-injection` aponta. `Map.has`/`Map.get`
        // olham só chave própria, nunca protótipo.
        const gravadoMap = new Map(Object.entries(gravado));
        const chavesNaoConfirmadas = Object.entries(dbUpdates)
          .filter(([chave, valorEnviado]) => {
            const tipo = TIPO_DAS_COLUNAS_STORE_CONFIG.get(chave);
            if (!tipo || !gravadoMap.has(chave)) return true;
            return !valorFoiGravado(tipo, valorEnviado, gravadoMap.get(chave));
          })
          .map(([chave]) => chave);

        if (chavesNaoConfirmadas.length > 0) {
          console.error(
            "[StoreContext] Update não confirmado para:",
            chavesNaoConfirmadas,
            { enviado: dbUpdates, gravado },
          );
          toast.error(
            "Não deu para confirmar que tudo foi salvo. Tente salvar de novo antes de sair da tela.",
          );
          return false;
        }

        setConfig((prev) => {
          const newConfig = { ...prev, ...updates };
          // Persist to DataVault
          // Pelo singleton e com erro logado (revisão 20260825-1050).
          DataVault.init()
            .then((vault) =>
              vault.put("store_config", { id: "singleton", ...newConfig }),
            )
            .catch((err) =>
              console.warn(
                "[StoreContext] config não gravada no cache offline:",
                err,
              ),
            );
          return newConfig;
        });
        // Aplica pela REGRA também no caminho do admin: valor explícito do
        // formulário passa (inclusive #000000 = preto escolhido); ausente
        // não pinta nada. Nenhum caminho aplica cru por fora do dono único.
        applyBranding(
          corPrimariaEfetiva({
            primaryColor: updates.primaryColor,
          } as StoreConfig),
        );
        toast.success("Configurações salvas");
        return true;
      } catch (err) {
        console.error("[StoreContext] Update error:", err);
        toast.error("Erro ao salvar as configurações");
        return false;
      }
    },
    [isAdmin, applyBranding],
  );

  useEffect(() => {
    console.log(
      "[StoreContext] Effect triggered. loading:",
      loading,
      "isAdmin:",
      isAdmin,
    );
    fetchConfig();
    fetchProducts();
  }, [fetchConfig, fetchProducts]);

  // ── Realtime Sync: Start/Stop engine ──
  useEffect(() => {
    if (!isLoaded || !vaultRef.current) return;

    console.log(
      `[StoreContext] Starting RealtimeSyncEngine (isLeader: ${isLeader}, isAdmin: ${isAdmin})`,
    );
    const cleanup = RealtimeSyncEngine.start(
      vaultRef.current,
      isLeader,
      isAdmin,
    );

    return () => {
      cleanup();
    };
  }, [isLoaded, isLeader, isAdmin]);

  // ── Realtime Sync: Listen for changes applied by RealtimeSyncEngine ──
  useSyncListener(
    ["store_config"],
    useCallback(
      (event) => {
        if (event.store === "store_config" && event.newRecord) {
          const mapped = mapConfig(event.newRecord);
          if (
            mapped.minAppVersion &&
            mapped.minAppVersion !== config.minAppVersion
          ) {
            console.log(
              "[StoreContext] New mandatory version detected via Realtime!",
            );
          }
          setConfig(mapped);
          applyBranding(corPrimariaEfetiva(mapped));
        }
      },
      [mapConfig, applyBranding, config.minAppVersion],
    ),
  );

  useSyncListener(
    ["products"],
    useCallback(async (event) => {
      // Re-read products from DataVault when Realtime updates them.
      // Pelo singleton (revisão 20260825-1050): se outra aba subiu a versão
      // do banco, a conexão antiga está fechada — init() reabre e a releitura
      // deste listener volta a funcionar sem recarregar a página.
      //
      // C4 (laudo novos-ângulos 01/09): evento de UMA linha não precisa
      // reler o cofre inteiro — o motor já aplicou a mudança no cofre antes
      // de avisar, então o merge fino troca só o slot do registro afetado e
      // preserva a identidade (e o memo) dos outros cards. A leitura total
      // fica para os eventos que não trazem registro decidível: catchUp,
      // broadcast em massa, ou registro que sumiu do cofre entre o motor e
      // esta leitura.
      try {
        const vault = await DataVault.init();
        const eventoId =
          (event.newRecord as any)?.id ?? (event.oldRecord as any)?.id;

        if (event.eventType === "DELETE" && eventoId) {
          setProducts(
            (prev) =>
              mesclarProdutoNaLista(prev, {
                eventType: "DELETE",
                id: eventoId,
              }) ?? prev,
          );
          return;
        }

        if (
          (event.eventType === "INSERT" || event.eventType === "UPDATE") &&
          eventoId
        ) {
          const atualizado = await vault.getById<Product>("products", eventoId);
          if (atualizado) {
            setProducts(
              (prev) =>
                mesclarProdutoNaLista(prev, {
                  eventType: event.eventType,
                  id: eventoId,
                  registro: atualizado,
                }) ?? prev,
            );
            return;
          }
        }

        const freshProducts = await vault.getAllOrThrow<Product>("products");
        setProducts(freshProducts);
      } catch (err) {
        // Leitura do cofre falhou -- manter o que já está na tela é
        // melhor que esvaziar a vitrine por causa de uma falha de
        // leitura.
        console.warn(
          "[StoreContext] Falha ao reler o cofre; mantendo a lista atual:",
          err,
        );
      }
    }, []),
  );

  const calculateShipping = useCallback(
    (cart: CartItem[], selectedOption?: ShippingOption | null) => {
      if (cart.length === 0) return 0;

      const hasFreeShippingItem = cart.some(
        (item) => item.product.freeShipping,
      );
      if (hasFreeShippingItem) return 0;

      const totalAmount = cart.reduce((sum, item) => {
        // Laudo 31/08 (menor E): regra única do preço em preco-vendido.ts.
        return (
          sum +
          precoVendido(
            item.product,
            item.product.variants?.find((v) => v.id === item.variantId),
          ) *
            item.quantity
        );
      }, 0);

      // Frete grátis exige login — mesma regra do CartContext, da RPC
      // create_marketplace_order_v22 e do que o FreeShippingBlock promete na Home.
      // Sem o `user` aqui, esta função divergia das outras duas.
      if (
        config.freeShippingMin > 0 &&
        totalAmount >= config.freeShippingMin &&
        user
      )
        return 0;

      if (selectedOption) {
        return selectedOption.price;
      }

      return config.shippingFee;
    },
    [config.freeShippingMin, config.shippingFee, user],
  );

  const refresh = useCallback(
    async (options?: { onlyConfig?: boolean }) => {
      if (options?.onlyConfig) {
        await fetchConfig();
      } else {
        await fetchConfig();
        await fetchProducts();
      }
    },
    [fetchConfig, fetchProducts],
  );

  const contextValue = React.useMemo(
    () => ({
      config,
      isLoaded,
      products,
      loadingProducts,
      updateConfig,
      refresh,
      fetchProducts,
      calculateShipping,
    }),
    [
      config,
      isLoaded,
      products,
      loadingProducts,
      updateConfig,
      refresh,
      fetchProducts,
      calculateShipping,
    ],
  );

  return (
    <StoreContext.Provider value={contextValue}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
};
