import type { Artigo, Unidade } from "./base";

/**
 * Anotações de alteração legislativa que o Planalto acrescenta ao fim do dispositivo:
 * "(Redação dada pela Lei nº ...)", "(Incluído pela ...)", "(Vide ...)", "(Vigência)".
 * No Regimento Interno do TJPE: "(Alterado pelo art. 1º da Emenda Regimental n. ...)", "(Inserido pelo ...)".
 * Não integram o texto da lei. "(VETADO)" e "(Revogado)" são conteúdo e ficam.
 */
const INICIO_ANOTACAO =
	"(?:Reda[çc][ãa]o|Inclu[íi]d[oa]|Incu[íi]d[oa]|Acrescid[oa]|Acrescentad[oa]|Renumera|Numerad[oa]|Vide\\b|Vig[êe]ncia|Regulament|Produ[çc][ãa]o de efeito|Transformad[oa]|Promulga[çc][ãa]o|Restabelecid[oa]|Restaurad[oa]|Suprimid[oa]|Veto rejeitado|Par[áa]grafo (?:[úu]nico )?(?:inclu[íi]do|renumerado|acrescido)|Inciso (?:inclu[íi]do|acrescido|renumerado)|Al[íi]nea (?:inclu[íi]da|acrescida|renumerada)|Artigo (?:inclu[íi]do|acrescido)|Express[ãa]o (?:declarada|suprimida)|Declarad[oa] inconstitucional|Revogad[oa] pel[oa]|Alterad[oa] pel[oa]|Aterad[oa] pel[oa]|Inserid[oa] pel[oa])";
const RE_ANOTACAO_FINAL = new RegExp(`\\s*\\(\\s*${INICIO_ANOTACAO}[^()]*(?:\\([^()]*\\)[^()]*)*\\)?\\.?\\s*$`, "i");
const RE_PALAVRA_FINAL = /(?<=\))\s*(?:Vig[êe]ncia(?: encerrada)?|Produ[çc][ãa]o de efeitos?|Regulamento)\s*$/i;

const RE_SO_ROTULO = /^\s*(?:Art(?:igo)?\.?\s*\d[\d.]*\s*[ºo°]?(?:-[A-Z])*|§\s*\d+\s*\.?[ºo°]?(?:-[A-Z])?|Par[áa]grafo\s+[úu]nico|[IVXLCDM]+(?:-[A-Z])?(?=\s*[-–—])|[a-z]\)|\d+(?=\s*[-–—]))[\s.\-–—]*/iu;

export function linhaTachada(linha: string): boolean {
	const s = linha.trim();
	return s.length > 4 && s.startsWith("~~") && s.endsWith("~~");
}

export function semMarcaDeTachado(linha: string): string {
	return linhaTachada(linha) ? linha.trim().slice(2, -2).trim() : linha.replace(/~~/g, "");
}

/** Remove, por regra fixa, as anotações finais de alteração legislativa de uma linha. */
export function semAnotacoes(linha: string): string {
	let atual = linha;
	for (let i = 0; i < 8; i++) {
		const proxima = atual.replace(RE_PALAVRA_FINAL, "").replace(RE_ANOTACAO_FINAL, "");
		if (proxima === atual) break;
		// a anotação era o próprio conteúdo ("§ 2º (Revogado pela Lei ...)"): fica como está
		if (!/\p{L}/u.test(proxima.replace(RE_SO_ROTULO, ""))) break;
		atual = proxima;
	}
	return atual.trimEnd();
}

export interface OpcoesTexto {
	/** Mantém "(Redação dada pela ...)" e semelhantes. */
	anotacoes?: boolean;
	/** Mantém as linhas tachadas (dispositivos revogados dentro do artigo). */
	tachadas?: boolean;
	/** Mantém as rubricas marginais ("Homicídio simples"). */
	rubricas?: boolean;
}

/** Linhas de um intervalo do artigo, filtradas conforme as opções. Nada é reescrito além dos cortes previstos. */
export function linhasDoIntervalo(artigo: Artigo, inicio: number, fim: number, opcoes: OpcoesTexto = {}): string[] {
	const saida: string[] = [];
	const rubricas = new Set(artigo.rubricas);
	for (let i = inicio; i < fim; i++) {
		const linha = artigo.linhas[i];
		if (!artigo.revogado && !opcoes.tachadas && linhaTachada(linha)) continue;
		if (!opcoes.rubricas && rubricas.has(i)) continue;
		const limpa = semMarcaDeTachado(linha);
		saida.push(opcoes.anotacoes ? limpa : semAnotacoes(limpa));
	}
	return saida;
}

export function linhasDaUnidade(artigo: Artigo, unidade: Unidade | undefined, opcoes: OpcoesTexto = {}): string[] {
	if (!unidade) return linhasDoIntervalo(artigo, 0, artigo.linhas.length, opcoes);
	return linhasDoIntervalo(artigo, unidade.inicio, unidade.fim, opcoes);
}

const ORDINAL_ATE = 9;

function nomeParagrafo(token: string): string {
	if (token === "pu") return "parágrafo único";
	const m = /^§(\d+)(?:-([A-Z]))?$/.exec(token);
	if (!m) return token;
	const n = Number(m[1]);
	return `§ ${n}${n <= ORDINAL_ATE ? "º" : ""}${m[2] ? `-${m[2]}` : ""}`;
}

/** "§1/I/a" → '§ 1º, I, "a"'. */
export function nomeDoCaminho(caminho: string): string {
	if (!caminho) return "";
	if (caminho === "caput") return "caput";
	return caminho
		.split("/")
		.map((token) => {
			if (token === "pu" || token.startsWith("§")) return nomeParagrafo(token);
			if (/^[a-z]$/.test(token)) return `"${token}"`;
			if (/^\d+$/.test(token)) return `item ${token}`;
			return token;
		})
		.join(", ");
}

/** "art. 1.015, parágrafo único, do CPC"; "art. 100 do ADCT". */
export function nomeDoDispositivo(artigo: Artigo, caminho = ""): string {
	const rotulo = artigo.corpo ? artigo.rotulo.replace(new RegExp(`^${artigo.corpo}\\s+`), "") : artigo.rotulo;
	const sub = nomeDoCaminho(caminho);
	const diploma = artigo.corpo === "ADCT" ? "do ADCT" : artigo.diploma.naCitacao;
	return `art. ${rotulo}${sub ? `, ${sub},` : ""} ${diploma}`;
}

export function hierarquiaDoArtigo(artigo: Artigo): string {
	return artigo.nota.h.join(" › ");
}
