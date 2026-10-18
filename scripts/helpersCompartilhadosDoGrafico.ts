import ts from "typescript";
import type { Plugin } from "vite";

const ID_VIRTUAL = "\0ikcous:helpers-compartilhados-do-grafico";
const RECHARTS_ES6 = /[\\/]node_modules[\\/]recharts[\\/]es6[\\/].+\.js$/;

/** Lista FECHADA: formas do Babel presentes no Recharts 2.15.4.
 * Texto congelado, nunca aprendido de node_modules durante o build. Uma
 * atualização que mudar a AST deixa a função local até nova revisão.
 * Os nomes locais também precisam coincidir (comparação conservadora).
 */
const FORMAS_APROVADAS = String.raw`function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } } return target; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter); }
function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } else if (call !== void 0) { throw new TypeError("Derived constructors may only return object or undefined"); } return _assertThisInitialized(self); }
function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function _isNativeReflectConstruct() { return !!t; })(); }
function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }
function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); Object.defineProperty(subClass, "prototype", { writable: false }); if (superClass) _setPrototypeOf(subClass, superClass); }
function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }`;

function analisar(codigo: string) {
  const nome = "/helpers-recharts.js";
  const arquivo = ts.createSourceFile(
    nome,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const opcoes: ts.CompilerOptions = {
    allowJs: true,
    noLib: true,
    noResolve: true,
    types: [],
  };
  const host = ts.createCompilerHost(opcoes);
  host.getSourceFile = (id) => (id === nome ? arquivo : undefined);
  const programa = ts.createProgram([nome], opcoes, host);
  return {
    arquivo,
    checker: programa.getTypeChecker(),
    valido: programa.getSyntacticDiagnostics(arquivo).length === 0,
  };
}

function percorrer(no: ts.Node, visitar: (no: ts.Node) => void) {
  visitar(no);
  ts.forEachChild(no, (filho) => {
    percorrer(filho, visitar);
  });
}

function propriedade(no: ts.Identifier): boolean {
  const pai = no.parent;
  return (
    (ts.isPropertyAccessExpression(pai) && pai.name === no) ||
    ((ts.isPropertyAssignment(pai) ||
      ts.isMethodDeclaration(pai) ||
      ts.isGetAccessorDeclaration(pai) ||
      ts.isSetAccessorDeclaration(pai)) &&
      pai.name === no) ||
    ((ts.isLabeledStatement(pai) ||
      ts.isBreakStatement(pai) ||
      ts.isContinueStatement(pai)) &&
      pai.label === no)
  );
}

function simboloEm(no: ts.Identifier, checker: ts.TypeChecker) {
  if (ts.isShorthandPropertyAssignment(no.parent))
    return checker.getShorthandAssignmentValueSymbol(no.parent);
  if (ts.isExportSpecifier(no.parent))
    return checker.getExportSpecifierLocalTargetSymbol(no.parent);
  return checker.getSymbolAtLocation(no);
}

/** A posição de cada declaração DENTRO da AST identifica o binding: nomes
 * iguais em escopos diferentes não viram a mesma variável. Globais precisam
 * continuar livres; imports/variáveis do módulo nunca substituem Object etc.
 */
function assinatura(funcao: ts.FunctionDeclaration, checker: ts.TypeChecker) {
  const posicoes = new Map<ts.Node, number>();
  percorrer(funcao, (no) => {
    posicoes.set(no, posicoes.size);
  });
  const dependencias = new Set<string>();
  function estrutura(no: ts.Node): unknown {
    const filhos: unknown[] = [];
    ts.forEachChild(no, (filho) => {
      filhos.push(estrutura(filho));
    });
    let valor: unknown;
    if (ts.isIdentifier(no)) {
      const simbolo = simboloEm(no, checker);
      const declaracoes = simbolo?.declarations ?? [];
      let binding: unknown = "global";
      if (propriedade(no)) binding = "propriedade";
      else if (declaracoes.length > 0) {
        if (declaracoes.every((d) => posicoes.has(d)))
          binding = declaracoes.map((d) => posicoes.get(d));
        else if (
          declaracoes.length === 1 &&
          ts.isFunctionDeclaration(declaracoes[0]) &&
          ts.isSourceFile(declaracoes[0].parent)
        ) {
          binding = ["helper", no.text];
          dependencias.add(no.text);
        } else binding = "externo";
      }
      valor = [no.text, binding];
    } else if (ts.isLiteralExpression(no)) valor = no.text;
    // O TS guarda estes operadores como campos numéricos, fora dos filhos.
    // Ignorá-los confundiria ! com ~, ++ com -- ou + com -.
    else if (ts.isPrefixUnaryExpression(no) || ts.isPostfixUnaryExpression(no))
      valor = no.operator;
    return [no.kind, valor, filhos];
  }
  return { chave: JSON.stringify(estrutura(funcao)), dependencias };
}

const modelos = analisar(FORMAS_APROVADAS);
const APROVADOS = new Map(
  modelos.arquivo.statements
    .filter(ts.isFunctionDeclaration)
    .map((funcao) => [funcao.name!.text, assinatura(funcao, modelos.checker)]),
);

function transformar(codigo: string, id: string) {
  if (!RECHARTS_ES6.test(id)) return null;
  const { arquivo, checker, valido } = analisar(codigo);
  if (!valido) return null;
  const candidatos = new Map<string, ts.FunctionDeclaration>();
  for (const no of arquivo.statements) {
    if (!ts.isFunctionDeclaration(no) || !no.name) continue;
    const aprovado = APROVADOS.get(no.name.text);
    if (aprovado && assinatura(no, checker).chave === aprovado.chave)
      candidatos.set(no.name.text, no);
  }
  // Só chamadas diretas podem observar estes helpers. Alias, export, .name,
  // .prototype, new, escritas externas e eval tornam a troca insegura.
  let temEval = false;
  percorrer(arquivo, (no) => {
    if (!ts.isIdentifier(no) || propriedade(no)) return;
    if (no.text === "eval") {
      let referencia: ts.Node = no;
      while (ts.isParenthesizedExpression(referencia.parent))
        referencia = referencia.parent;
      if (
        ts.isCallExpression(referencia.parent) &&
        referencia.parent.expression === referencia
      )
        temEval = true;
    }
    const funcao = candidatos.get(no.text);
    if (!funcao || no === funcao.name) return;
    if (
      no.getStart(arquivo) >= funcao.getStart(arquivo) &&
      no.end <= funcao.end
    )
      return;
    if (simboloEm(no, checker) !== checker.getSymbolAtLocation(funcao.name!))
      return;
    if (!ts.isCallExpression(no.parent) || no.parent.expression !== no)
      candidatos.delete(no.text);
  });
  if (temEval) return null;
  // Ponto fixo: uma dependência não aprovada impede a retirada de TODOS os
  // dependentes, mesmo nas cadeias typeof → primitive → key → spread/class.
  let mudou: boolean;
  do {
    mudou = false;
    for (const nome of candidatos.keys()) {
      if (
        [...APROVADOS.get(nome)!.dependencias].some(
          (dep) => !candidatos.has(dep),
        )
      ) {
        candidatos.delete(nome);
        mudou = true;
      }
    }
  } while (mudou);
  if (candidatos.size === 0) return null;
  const funcoes = [...candidatos.values()].sort(
    (a, b) => b.getStart(arquivo) - a.getStart(arquivo),
  );
  let resultado = codigo;
  for (const funcao of funcoes)
    resultado =
      resultado.slice(0, funcao.getStart(arquivo)) +
      resultado.slice(funcao.end);
  return {
    code: `import { ${[...candidatos.keys()].join(", ")} } from ${JSON.stringify(ID_VIRTUAL)};\n${resultado}`,
    map: null,
  };
}

/** Só transforma Recharts/es6, antes do Rollup e da minificação. O módulo
 * virtual tem exports VIVOS: os helpers que se reatribuem continuam assim.
 * Nenhum construtor de d3, função do app ou node_modules é reescrito no disco.
 */
export function helpersCompartilhadosDoGrafico(): Plugin {
  return {
    name: "helpers-compartilhados-do-grafico",
    apply: "build",
    enforce: "pre",
    resolveId: (id) => (id === ID_VIRTUAL ? ID_VIRTUAL : null),
    load: (id) =>
      id === ID_VIRTUAL
        ? `${FORMAS_APROVADAS}\nexport { ${[...APROVADOS.keys()].join(", ")} };`
        : null,
    transform: transformar,
  };
}
