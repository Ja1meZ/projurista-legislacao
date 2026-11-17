import type { Base, Diploma } from "./base";
import { diplomaNoInicio, lerNumeroArtigo, lerSubdivisoes } from "./referencia";

export interface Transcricao {
	texto: string;
	comAspas: boolean;
	inicio: number;
	fim: number;
	/** Linha que começa por "Art. N." e traz o próprio texto da lei. */
	blocoLegal?: boolean;
}

export type OrigemDiploma = "explicito" | "mesmo_diploma" | "nenhuma";

export interface Referencia {
	inicio: number;
	fim: number;
	linha: number;
	/** Trecho do texto em que a referência aparece. */
	mencao: string;
	/** Número do artigo, sem corpo: "1015", "103-A". */
	artigo: string;
	/** Fim de faixa ("arts. 98 a 102"): chave do último artigo. */
	faixaAte?: string;
	/** "" = artigo inteiro. */
	caminho: string;
	diploma?: Diploma;
	corpo: string;
	fora?: { rotulo: string; motivo: string };
	origem: OrigemDiploma;
	transcricao?: Transcricao;
	/** Posição na lista quando a menção reúne vários dispositivos. */
	deVarios: boolean;
}

const RE_CABECA = /(?<![\p{L}\d])(arts?|artigos?)\.?\s*(?=\d)/giu;
const RE_LIGA = /^\s*,?\s*(?:\(\s*)?(?:(?:ambos|ambas|todos|todas)\s+)?(?:d[oae]s?|n[oa]s?)\s+(?:(?:nov[oa]|atual|vigente|referid[oa]|citad[oa]|mencionad[oa]|aludid[oa]|pr[óo]pri[oa])\s+)?/iu;
const RE_DIRETO = /^\s*(?:,\s*|\(\s*|\s)(?=[\p{Lu}])/u;
const RE_MESMO = /^\s*,?\s*(?:d[oa]|n[oa])\s+(?:mesm[oa]|referid[oa]|citad[oa]|mencionad[oa]|aludid[oa])\s+(?:diploma(?:\s+legal)?|c[óo]digo|codex|estatuto|lei|decreto|texto\s+legal|diploma\s+processual)(?![\p{L}])/iu;
const RE_PREFIXO_FIM = /^\s*(?:[,:(–—-]\s*|\s)(?:(?:em|n[oa]s?)\s+se[ou]s?\s+|n[oa]s?\s+|\(\s*)?$/iu;
const RE_FAIXA = /^\s*(?:a|ao|at[ée]|[-–])\s*(?:o\s+)?(?=\d)/iu;
const RE_PROXIMO = /^\s*(?:,\s*e|,|;|e)\s*(?=\d)/iu;

const FECHA: Record<string, string> = { "“": "”", '"': '"', "«": "»" };
const LIMITE_TRANSCRICAO = 12000;

function transcricaoDepois(texto: string, de: number): Transcricao | undefined {
	const janela = texto.slice(de, de + 160);
	const abre = janela.search(/[“"«]/u);
	if (abre >= 0) {
		const vao = janela.slice(0, abre);
		if (!/[.;!?]\s/.test(vao) && !/(?<![\p{L}\d])arts?\.?\s*\d/iu.test(vao)) {
			const inicio = de + abre;
			const fecha = FECHA[texto[inicio]];
			const fim = texto.indexOf(fecha, inicio + 1);
			if (fim > inicio && fim - inicio <= LIMITE_TRANSCRICAO) {
				return { texto: texto.slice(inicio + 1, fim), comAspas: true, inicio, fim: fim + 1 };
			}
		}
	}
	const semAspas = /^\s*[:–—]\s*/u.exec(janela);
	if (semAspas) {
		const inicio = de + semAspas[0].length;
		if (!"“\"«".includes(texto[inicio] ?? "")) {
			let fim = texto.indexOf("\n", inicio);
			if (fim < 0) fim = texto.length;
			fim = Math.min(fim, inicio + LIMITE_TRANSCRICAO);
			const trecho = texto.slice(inicio, fim).trim();
			if (trecho.split(/\s+/).length >= 4) return { texto: trecho, comAspas: false, inicio, fim };
		}
	}
	return undefined;
}

function transcricaoAntes(texto: string, ate: number): Transcricao | undefined {
	const piso = Math.max(0, ate - 14);
	const cauda = /([”"»])[\s,.;]*[([–—-]?\s*$/u.exec(texto.slice(piso, ate));
	if (!cauda) return undefined;
	const fim = piso + cauda.index;
	const abre = cauda[1] === "”" ? "“" : cauda[1] === "»" ? "«" : '"';
	const inicio = texto.lastIndexOf(abre, fim - 1);
	if (inicio < 0 || fim - inicio > LIMITE_TRANSCRICAO) return undefined;
	return { texto: texto.slice(inicio + 1, fim), comAspas: true, inicio, fim: fim + 1 };
}

interface Item {
	artigo: string;
	faixaAte?: string;
	caminhos: string[];
}

/** Procura o diploma escrito logo antes da menção: "CPC, art. 85", "o Código Civil, em seu art. 421". */
function diplomaAntes(base: Base, texto: string, inicio: number) {
	const piso = Math.max(0, inicio - 80);
	const trecho = texto.slice(piso, inicio);
	for (let i = 0; i < trecho.length; i++) {
		if (i > 0 && /[\p{L}\d]/u.test(trecho[i - 1])) continue;
		if (!/[\p{L}]/u.test(trecho[i])) continue;
		const achado = diplomaNoInicio(base, trecho.slice(i), "estrito");
		if (!achado) continue;
		if (RE_PREFIXO_FIM.test(trecho.slice(i + achado.comprimento))) return achado;
	}
	return undefined;
}

/** Localiza, por expressões regulares, as referências a artigos de lei em um texto. */
export function detectarReferencias(texto: string, base: Base): Referencia[] {
	const saida: Referencia[] = [];
	const quebras: number[] = [];
	for (let i = 0; i < texto.length; i++) if (texto[i] === "\n") quebras.push(i);
	const linhaDe = (pos: number) => {
		let a = 0;
		let b = quebras.length;
		while (a < b) {
			const m = (a + b) >> 1;
			if (quebras[m] < pos) a = m + 1;
			else b = m;
		}
		return a + 1;
	};

	RE_CABECA.lastIndex = 0;
	let cabeca: RegExpExecArray | null;
	let ultimoFim = 0;
	while ((cabeca = RE_CABECA.exec(texto))) {
		const inicio = cabeca.index;
		if (inicio < ultimoFim) continue;
		const plural = /s$/i.test(cabeca[1]);
		let pos = inicio + cabeca[0].length;
		const itens: Item[] = [];
		for (;;) {
			const numero = lerNumeroArtigo(texto.slice(pos));
			if (!numero) break;
			pos += numero.consumido;
			const item: Item = { artigo: numero.chave, caminhos: [] };
			const sub = lerSubdivisoes(texto.slice(pos, pos + 400), "estrito");
			item.caminhos = sub.caminhos;
			pos += sub.consumido;
			if (plural && sub.caminhos.length === 0) {
				const faixa = RE_FAIXA.exec(texto.slice(pos, pos + 12));
				if (faixa) {
					const ate = lerNumeroArtigo(texto.slice(pos + faixa[0].length));
					if (ate) {
						item.faixaAte = ate.chave;
						pos += faixa[0].length + ate.consumido;
					}
				}
			}
			itens.push(item);
			if (!plural) break;
			const proximo = RE_PROXIMO.exec(texto.slice(pos, pos + 8));
			if (!proximo) break;
			pos += proximo[0].length;
		}
		if (itens.length === 0) continue;

		// diploma: depois da menção, antes dela, ou "do mesmo diploma"
		let diploma: Diploma | undefined;
		let corpo = "";
		let fora: Referencia["fora"];
		let origem: OrigemDiploma = "nenhuma";
		let fim = pos;
		const resto = texto.slice(pos, pos + 200);
		const mesmo = RE_MESMO.exec(resto);
		if (mesmo) {
			origem = "mesmo_diploma";
			fim = pos + mesmo[0].length;
		} else {
			for (const re of [RE_LIGA, RE_DIRETO]) {
				const liga = re.exec(resto);
				if (!liga) continue;
				const achado = diplomaNoInicio(base, resto.slice(liga[0].length), "estrito");
				if (!achado) continue;
				origem = "explicito";
				fim = pos + liga[0].length + achado.comprimento;
				if (achado.tipo === "diploma") {
					diploma = achado.diploma;
					corpo = achado.corpo;
				} else {
					fora = { rotulo: achado.rotulo, motivo: achado.motivo };
				}
				break;
			}
			if (origem === "nenhuma") {
				const antes = diplomaAntes(base, texto, inicio);
				if (antes) {
					origem = "explicito";
					if (antes.tipo === "diploma") {
						diploma = antes.diploma;
						corpo = antes.corpo;
					} else {
						fora = { rotulo: antes.rotulo, motivo: antes.motivo };
					}
				}
			}
		}

		const total = itens.reduce((n, it) => n + Math.max(1, it.caminhos.length), 0);
		let transcricao: Transcricao | undefined;
		if (total === 1) {
			transcricao = transcricaoDepois(texto, fim) ?? transcricaoAntes(texto, inicio);
			if (!transcricao && origem === "nenhuma") {
				// linha de lei transcrita: "Art. 300. A tutela de urgência será concedida..."
				const inicioLinha = texto.lastIndexOf("\n", inicio - 1) + 1;
				const margem = texto.slice(inicioLinha, inicio);
				if (/^[\s>“"«*_-]*$/.test(margem) && /^A/.test(cabeca[0]) && /^\s*[.\-–—]?\s+[\p{Lu}“"(]/u.test(texto.slice(pos, pos + 6))) {
					let fimLinha = texto.indexOf("\n", pos);
					if (fimLinha < 0) fimLinha = texto.length;
					const trecho = texto.slice(inicio, fimLinha).replace(/[”"»\s]+$/u, "");
					if (trecho.split(/\s+/).length >= 6) {
						transcricao = { texto: trecho, comAspas: false, inicio, fim: fimLinha, blocoLegal: true };
					}
				}
			}
		}

		const mencao = texto.slice(inicio, fim).replace(/\s+/g, " ").trim();
		for (const item of itens) {
			const caminhos = item.caminhos.length ? item.caminhos : [""];
			for (const caminho of caminhos) {
				saida.push({
					inicio,
					fim,
					linha: linhaDe(inicio),
					mencao,
					artigo: item.artigo,
					faixaAte: item.faixaAte,
					caminho,
					diploma,
					corpo,
					fora,
					origem,
					transcricao,
					deVarios: total > 1,
				});
			}
		}
		ultimoFim = fim;
	}

	// referências que estão dentro da transcrição de outra são texto de lei citado, não citação do autor
	const faixas = saida.filter((r) => r.transcricao && !r.transcricao.blocoLegal).map((r) => [r.transcricao!.inicio, r.transcricao!.fim, r.inicio] as const);
	return saida.filter((r) => !faixas.some(([de, ate, dono]) => r.inicio > de && r.inicio < ate && dono !== r.inicio));
}
