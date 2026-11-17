import { tirarAcentos } from "../comum/normalizar";
import type { Base, Diploma } from "./base";

/**
 * Gramática única da referência legal, usada pelas ferramentas, pelo verificador e pela interface.
 * Dois modos: "estrito" (texto corrido: só aceita o que é inequívoco) e "livre" (campo de busca:
 * aceita "cpc 1015 pu", "cf 102 i r").
 */
export type Modo = "estrito" | "livre";

export type DiplomaAchado =
	| { tipo: "diploma"; diploma: Diploma; corpo: string; comprimento: number }
	| { tipo: "fora"; rotulo: string; motivo: string; comprimento: number };

interface Forma {
	/** Forma sem acentos e em minúsculas. */
	chave: string;
	/** Sigla: no modo estrito só casa com a mesma caixa do original. */
	original: string;
	sigla: boolean;
	diploma?: Diploma;
	corpo: string;
	fora?: { rotulo: string; motivo: string };
}

const indices = new WeakMap<Base, { formas: Forma[]; porAto: Map<string, Diploma> }>();

function plano(s: string): string {
	return tirarAcentos(s).toLowerCase();
}

function indiceDe(base: Base) {
	let indice = indices.get(base);
	if (indice) return indice;
	const formas: Forma[] = [];
	const porAto = new Map<string, Diploma>();
	const incluir = (texto: string, resto: Omit<Forma, "chave" | "original" | "sigla">) => {
		const sigla = !/\s/.test(texto) && texto.length <= 10 && (/[A-Z\d/]/.test(texto.slice(1)) || texto === texto.toUpperCase());
		formas.push({ chave: plano(texto), original: texto, sigla, ...resto });
	};
	for (const d of base.diplomas) {
		if (d.ato) porAto.set(d.ato, d);
		const vistos = new Set<string>();
		for (const forma of [d.sigla, d.nome, ...d.apelidos]) {
			if (!forma || vistos.has(forma)) continue;
			vistos.add(forma);
			incluir(forma, { diploma: d, corpo: "" });
		}
	}
	const cf = base.porSigla("CF");
	if (cf) {
		incluir("ADCT", { diploma: cf, corpo: "ADCT" });
		incluir("Ato das Disposições Constitucionais Transitórias", { diploma: cf, corpo: "ADCT" });
	}
	for (const a of base.ausentes) {
		for (const forma of [a.nome, ...a.formas]) incluir(forma, { corpo: "", fora: { rotulo: a.nome, motivo: a.motivo } });
	}
	formas.sort((a, b) => b.chave.length - a.chave.length);
	indice = { formas, porAto };
	indices.set(base, indice);
	return indice;
}

const RE_ATO =
	/^(Lei\s+Complementar|LC|Lei|Decreto-Lei|DL|Decreto|Emenda\s+Constitucional|EC|Medida\s+Provis[óo]ria|MP)(\s+(?:Federal|Estadual|Municipal|Distrital))?\s*(?:n[.ºo°]*\s*)?(\d{1,3}(?:\.\d{3})+|\d{1,6})(?:\s*\/\s*(\d{4}|\d{2})(?!\d)|,?\s+de\s+(?:\d{1,2}[./]\d{1,2}[./])(\d{4}|\d{2})(?!\d)|,?\s+de\s+\d{1,2}[º°]?\s+de\s+\p{L}+\s+de\s+(\d{4})|,?\s+de\s+(\d{4})(?!\d))?/iu;
const RE_ANO_APOS = /^(?:\s*\/\s*(\d{4}|\d{2})(?!\d)|\s+de\s+(\d{4})(?!\d))/;

/** "Código Penal Militar", "Constituição Estadual", "Constituição do Estado de Pernambuco": não é o diploma da base. */
const RE_OUTRO_DIPLOMA = /^\s+(?:Militar|Estadual|Municipal|Distrital|Pernambucan[oa]|anterior|revogad[oa]|d[oe]\s+Estado(?:\s+d[eo]\s+\p{Lu}[\p{L}]+(?:\s+d[eo]\s+\p{Lu}[\p{L}]+)?)?|d[oe]\s+Munic[íi]pio|de\s+Pernambuco)(?![\p{L}])/iu;

function anoCompleto(s: string): number {
	const n = Number(s);
	if (s.length === 4) return n;
	return n > 30 ? 1900 + n : 2000 + n;
}

function tipoDoAto(palavra: string): string {
	const p = plano(palavra).replace(/\s+/g, " ");
	if (p === "lei complementar" || p === "lc") return "lc";
	if (p === "lei") return "lei";
	if (p === "decreto-lei" || p === "dl") return "dl";
	if (p === "decreto") return "dec";
	if (p === "emenda constitucional" || p === "ec") return "ec";
	return "mp";
}

/** Reconhece um diploma no início do texto: sigla, nome usual ou tipo e número do ato. */
export function diplomaNoInicio(base: Base, texto: string, modo: Modo): DiplomaAchado | undefined {
	const { formas, porAto } = indiceDe(base);
	const ato = RE_ATO.exec(texto);
	if (ato && (modo === "livre" || /^[A-Z]/.test(ato[1]))) {
		const rotulo = ato[0].trim();
		const anoDito = ato[4] ?? ato[5] ?? ato[6] ?? ato[7];
		if (ato[2] && !/federal/i.test(ato[2])) {
			return { tipo: "fora", rotulo, motivo: "A base só reúne diplomas federais.", comprimento: ato[0].length };
		}
		const diploma = porAto.get(`${tipoDoAto(ato[1])}:${ato[3].replace(/\./g, "")}`);
		if (diploma && (!anoDito || anoCompleto(anoDito) === diploma.ano)) {
			return { tipo: "diploma", diploma, corpo: "", comprimento: ato[0].length };
		}
		// "Lei 8.666/93", "Lei 5.869/1973": ausentes conhecidos têm motivo próprio
		const chaveAto = plano(`${ato[1]} ${ato[3]}${anoDito ? `/${anoCompleto(anoDito)}` : ""}`).replace(/\s+/g, " ");
		const conhecido = formas.find((f) => f.fora && f.chave === chaveAto);
		return {
			tipo: "fora",
			rotulo,
			motivo: conhecido?.fora?.motivo ?? "Diploma não incluído na base.",
			comprimento: ato[0].length,
		};
	}
	const janela = plano(texto.slice(0, 90));
	for (const forma of formas) {
		if (!janela.startsWith(forma.chave)) continue;
		const fim = forma.chave.length;
		if (/[\p{L}\d]/u.test(texto[fim] ?? "")) continue;
		if (modo === "estrito" && forma.sigla && texto.slice(0, fim) !== forma.original) continue;
		if (forma.fora) return { tipo: "fora", rotulo: forma.fora.rotulo, motivo: forma.fora.motivo, comprimento: fim };
		const diploma = forma.diploma as Diploma;
		// "CPC/73", "Código Civil de 1916": o ano dito não é o do diploma da base
		const ano = RE_ANO_APOS.exec(texto.slice(fim));
		if (ano) {
			const dito = anoCompleto(ano[1] ?? ano[2]);
			if (diploma.ano && dito !== diploma.ano) {
				return {
					tipo: "fora",
					rotulo: texto.slice(0, fim + ano[0].length).trim(),
					motivo: `A base traz ${diploma.nome} (${diploma.lei}), não o diploma de ${dito}.`,
					comprimento: fim + ano[0].length,
				};
			}
			return { tipo: "diploma", diploma, corpo: forma.corpo, comprimento: fim + ano[0].length };
		}
		const outro = RE_OUTRO_DIPLOMA.exec(texto.slice(fim));
		if (outro) {
			return {
				tipo: "fora",
				rotulo: texto.slice(0, fim + outro[0].length).trim(),
				motivo: "A base só reúne os diplomas federais listados em listar_diplomas; este é outro diploma.",
				comprimento: fim + outro[0].length,
			};
		}
		return { tipo: "diploma", diploma, corpo: forma.corpo, comprimento: fim };
	}
	return undefined;
}

const VALOR_ROMANO: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function deRomano(s: string): number {
	let total = 0;
	let anterior = 0;
	for (let i = s.length - 1; i >= 0; i--) {
		const v = VALOR_ROMANO[s[i]] ?? 0;
		total += v < anterior ? -v : v;
		anterior = Math.max(anterior, v);
	}
	return total;
}

export function paraRomano(n: number): string {
	const pares: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
	let saida = "";
	let resto = n;
	for (const [v, r] of pares) {
		while (resto >= v) {
			saida += r;
			resto -= v;
		}
	}
	return saida;
}

/** Numeral romano canônico e plausível como inciso (até 150): afasta siglas como "CC", "LC", "CDC". */
function incisoValido(romano: string): boolean {
	const n = deRomano(romano);
	return n > 0 && n <= 150 && paraRomano(n) === romano;
}

export interface Subdivisoes {
	/** Caminhos lidos: "§1/I/a", "pu", "caput", "LV". Vazio = o artigo inteiro. */
	caminhos: string[];
	/** Quantos caracteres do texto foram consumidos. */
	consumido: number;
}

const RE_SEP = /^(?:\s*[,;]\s*|\s+)/;
const RE_CONJ = /^(?:e|c\/c|bem como)\s+/i;
const RE_CAPUT = /^caput(?![\p{L}\d])/iu;
const RE_PU = /^(?:par[áa]grafo\s+[úu]nico|§\s*[úu]nico|par\.\s*[úu]n(?:ico|\.)|p\.\s?[úu]\.?)(?![\p{L}\d])/iu;
const RE_PU_LIVRE = /^pu(?![\p{L}\d])/iu;
const RE_PAR = /^(§§?|par[áa]grafos?|pars?\.)\s*(\d{1,3})(?:[ºo°]|\s[º°])?(?:\s?-\s?([A-Z])(?![\p{L}\d]))?/iu;
const RE_INC_PALAVRA = /^(?:incisos?|incs?\.)\s*([IVXLCDM]+)(?:-([A-Z]))?(?![\p{L}\d])/iu;
const RE_INC = /^([IVXLCDM]+)(?:-([A-Z]))?(?![\p{L}\d])/u;
const RE_INC_LIVRE = /^([ivxlcdm]+)(?:-([a-z]))?(?![\p{L}\d])/iu;
const RE_ALI_PALAVRA = /^(?:al[íi]neas?|als?\.|letras?)\s*["'“‘«]?([a-z])["'”’»]?\)?(?![\p{L}\d])/iu;
const RE_ALI_ASPAS = /^["'“‘«]([a-z])["'”’»]\)?/u;
const RE_ALI_PAREN = /^([a-z])\)/u;
const RE_ALI_NUA = /^([a-z])(?![\p{L}\d])/u;
const RE_ITEM = /^(?:itens?|n[úu]meros?)\s*(\d{1,2})(?![\p{L}\d])/iu;
const RE_NUMERO = /^(\d{1,3})(?:[ºo°]|\s[º°])?(?:\s?-\s?([A-Z])(?![\p{L}\d]))?(?![\p{L}\d.])/u;

/** Lê as subdivisões que seguem o número do artigo: "§ 1º, I, a", "caput e § 2º", "parágrafo único". */
export function lerSubdivisoes(texto: string, modo: Modo): Subdivisoes {
	const caminhos: string[] = [];
	let par = "";
	let inc = "";
	let ali = "";
	let item = "";
	let algo = false;
	let modoPar = false;
	let modoAli = false;
	let pos = 0;
	let consumido = 0;

	const fechar = () => {
		if (!algo) return;
		const partes = [par === "caput" && (inc || ali || item) ? "" : par, inc, ali, item].filter((p) => p);
		caminhos.push(partes.join("/"));
	};
	const definir = (nivel: number, valor: string) => {
		const ocupado = (nivel <= 0 && par) || (nivel <= 1 && inc) || (nivel <= 2 && ali) || (nivel <= 3 && item);
		if (algo && ocupado) fechar();
		if (nivel <= 0) par = "";
		if (nivel <= 1) inc = "";
		if (nivel <= 2) ali = "";
		item = "";
		if (nivel === 0) par = valor;
		else if (nivel === 1) inc = valor;
		else if (nivel === 2) ali = valor;
		else item = valor;
		algo = true;
	};

	for (;;) {
		let resto = texto.slice(pos);
		const sep = RE_SEP.exec(resto);
		if (!sep && pos > 0) break;
		let avanco = sep ? sep[0].length : 0;
		resto = resto.slice(avanco);
		const conj = RE_CONJ.exec(resto);
		const comConjuncao = Boolean(conj) || /\be\s*$/i.test(sep?.[0] ?? "");
		if (conj) {
			avanco += conj[0].length;
			resto = resto.slice(conj[0].length);
		}
		let m: RegExpExecArray | null;
		let lido = 0;
		if ((m = RE_CAPUT.exec(resto))) {
			definir(0, "caput");
			modoPar = modoAli = false;
			lido = m[0].length;
		} else if ((m = RE_PU.exec(resto)) || (modo === "livre" && (m = RE_PU_LIVRE.exec(resto)))) {
			definir(0, "pu");
			modoPar = modoAli = false;
			lido = m[0].length;
		} else if ((m = RE_PAR.exec(resto))) {
			definir(0, `§${Number(m[2])}${m[3] ? `-${m[3].toUpperCase()}` : ""}`);
			modoPar = /^(?:§§|par[áa]grafos|pars)/i.test(m[1]);
			modoAli = false;
			lido = m[0].length;
		} else if ((m = RE_INC_PALAVRA.exec(resto)) && incisoValido(m[1].toUpperCase())) {
			definir(1, m[1].toUpperCase() + (m[2] ? `-${m[2].toUpperCase()}` : ""));
			modoPar = modoAli = false;
			lido = m[0].length;
		} else if ((m = RE_ALI_PALAVRA.exec(resto))) {
			definir(2, m[1].toLowerCase());
			modoPar = false;
			modoAli = true;
			lido = m[0].length;
		} else if ((m = RE_ITEM.exec(resto))) {
			definir(3, String(Number(m[1])));
			modoPar = modoAli = false;
			lido = m[0].length;
		} else if ((m = RE_INC.exec(resto)) && incisoValido(m[1])) {
			definir(1, m[1] + (m[2] ? `-${m[2]}` : ""));
			modoPar = modoAli = false;
			lido = m[0].length;
		} else if ((m = RE_ALI_ASPAS.exec(resto)) || (m = RE_ALI_PAREN.exec(resto))) {
			definir(2, m[1]);
			modoPar = false;
			modoAli = true;
			lido = m[0].length;
		} else if (modoPar && (m = RE_NUMERO.exec(resto))) {
			definir(0, `§${Number(m[1])}${m[2] ? `-${m[2]}` : ""}`);
			// "§§ 2º e 4º, 10, caput": depois do "e", o número seguinte já é outro artigo
			if (comConjuncao) modoPar = false;
			lido = m[0].length;
		} else if (modo === "livre" && (m = RE_INC_LIVRE.exec(resto)) && incisoValido(m[1].toUpperCase()) && (m[1].length > 1 || !inc)) {
			definir(1, m[1].toUpperCase() + (m[2] ? `-${m[2].toUpperCase()}` : ""));
			lido = m[0].length;
		} else if ((m = RE_ALI_NUA.exec(resto)) && alineaNuaAceita(m[1], resto.slice(1), modo, modoAli, Boolean(inc || par))) {
			definir(2, m[1]);
			modoAli = true;
			lido = m[0].length;
		} else if (modo === "livre" && (inc || ali) && (m = /^(\d{1,2})(?![\p{L}\d])/u.exec(resto))) {
			definir(3, String(Number(m[1])));
			lido = m[0].length;
		} else {
			break;
		}
		pos += avanco + lido;
		consumido = pos;
	}
	fechar();
	return { caminhos, consumido };
}

/** Letra solta só vale como alínea quando o contexto não deixa dúvida. */
function alineaNuaAceita(letra: string, depois: string, modo: Modo, modoAli: boolean, temPai: boolean): boolean {
	if (modo === "livre") return true;
	if (!temPai && !modoAli) return false;
	if (/^\s*(?:[,;)]|$)/.test(depois)) return true;
	if (/^\s+e\s+[a-z](?![\p{L}\d])/u.test(depois)) return true;
	// "a", "e", "o" seguidos de palavra são artigo ou conjunção, não alínea
	if ("aeo".includes(letra)) return false;
	return /^\s+d[oae]s?\s/.test(depois) || /^\s*$/.test(depois);
}

export interface NumeroArtigo {
	chave: string;
	consumido: number;
}

const RE_NUM_ARTIGO = /^(\d{1,4}(?:\.\d{3})?)(?:[ºo°]|\s[º°])?(?:\s?-\s?([A-Za-z])(?![\p{L}\d])(?:-([A-Za-z])(?![\p{L}\d]))?|([A-Z])(?![\p{L}\d]))?/u;

/** "1.015" → "1015"; "103-A" → "103-A"; "5º" → "5". */
export function lerNumeroArtigo(texto: string): NumeroArtigo | undefined {
	const m = RE_NUM_ARTIGO.exec(texto);
	if (!m) return undefined;
	const sufixos = [m[2] ?? m[4], m[3]].filter((s): s is string => Boolean(s)).map((s) => `-${s.toUpperCase()}`);
	return { chave: m[1].replace(/\./g, "") + sufixos.join(""), consumido: m[0].length };
}

export interface ReferenciaLida {
	diploma?: Diploma;
	fora?: { rotulo: string; motivo: string };
	/** Chave do artigo no diploma, já com o corpo ("ADCT:112"). */
	chave?: string;
	caminhos: string[];
	erro?: string;
}

/** Interpreta uma referência escrita livremente: "art. 1.015, parágrafo único, do CPC", "cpc 1015 pu", "cf 5 lv". */
export function interpretarReferencia(base: Base, entrada: string, diplomaPadrao?: Diploma): ReferenciaLida {
	const s = entrada.trim().replace(/\s+/g, " ");
	if (!s) return { caminhos: [], erro: "Referência vazia." };
	// 1) achar o diploma em qualquer posição que comece palavra
	let achado: DiplomaAchado | undefined;
	let antes = s;
	let depois = "";
	const inicios = [0];
	for (let i = 1; i < s.length; i++) if (/[\s,(]/.test(s[i - 1]) && /\p{L}/u.test(s[i])) inicios.push(i);
	for (const i of inicios) {
		const tentativa = diplomaNoInicio(base, s.slice(i), "livre");
		if (!tentativa) continue;
		achado = tentativa;
		antes = s.slice(0, i).replace(/[\s,(]*(?:d[oae]s?|n[oa]s?)?\s*$/i, "");
		depois = s.slice(i + tentativa.comprimento);
		break;
	}
	if (achado?.tipo === "fora") return { caminhos: [], fora: { rotulo: achado.rotulo, motivo: achado.motivo } };
	const diploma = achado?.diploma ?? diplomaPadrao;
	let corpo = achado?.corpo ?? "";
	let artigoTexto = `${antes} ${depois}`.trim().replace(/^[,;:\s)]+/, "");
	const adct = /^ADCT(?![\p{L}\d])\s*/iu.exec(artigoTexto);
	if (adct) {
		corpo = "ADCT";
		artigoTexto = artigoTexto.slice(adct[0].length);
	}
	artigoTexto = artigoTexto.replace(/^(?:arts?|artigos?)\.?\s*/i, "");
	const numero = lerNumeroArtigo(artigoTexto);
	if (!numero) {
		return { diploma, caminhos: [], erro: `Não identifiquei o número do artigo em "${entrada.trim()}".` };
	}
	if (!diploma) {
		return { caminhos: [], erro: `Não identifiquei o diploma em "${entrada.trim()}". Diga a sigla ou o nome (por exemplo: CPC, CF, Lei 9.099/1995) ou use listar_diplomas.` };
	}
	const resto = artigoTexto.slice(numero.consumido);
	const sub = lerSubdivisoes(resto.replace(/^\s*[.,:]?\s*/, (m) => (m.trim() ? ", " : m)), "livre");
	const sobra = resto.replace(/^\s*[.,:]?\s*/, (m) => (m.trim() ? ", " : m)).slice(sub.consumido).replace(/[\s,.;)]+/g, "");
	if (sobra) {
		return { diploma, caminhos: [], erro: `Não entendi o trecho "${resto.trim()}" da referência. Use, por exemplo: "§ 1º, I, a", "parágrafo único", "caput".` };
	}
	if (corpo === "ADCT" && diploma.sigla !== "CF") return { diploma, caminhos: [], erro: "O ADCT pertence à Constituição Federal." };
	return { diploma, chave: (corpo ? `${corpo}:` : "") + numero.chave, caminhos: sub.caminhos };
}
