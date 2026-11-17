import { semAcento } from "../comum/normalizar";
import type { Artigo, Base, Diploma } from "./base";
import { semAnotacoes, semMarcaDeTachado } from "./texto";

const VAZIAS = new Set(
	"a o as os um uma uns umas de do da dos das em no na nos nas por para pelo pela pelos pelas com sem sob sobre ao aos que se e ou art arts artigo artigos lei inciso paragrafo alinea caput ser sera sao foi como quando qual quais nao sua seu suas seus este esta esse essa aquele aquela desta deste".split(" "),
);

function radical(termo: string): string {
	if (termo.length <= 3 || /^\d/.test(termo)) return termo;
	if (/(?:oes|aes)$/.test(termo)) return `${termo.slice(0, -3)}ao`;
	if (termo.endsWith("ais")) return `${termo.slice(0, -3)}al`;
	if (termo.endsWith("eis")) return `${termo.slice(0, -3)}el`;
	if (termo.endsWith("ns")) return `${termo.slice(0, -2)}m`;
	if (termo.endsWith("s")) return termo.slice(0, -1);
	return termo;
}

export function termosDe(texto: string): string[] {
	const brutos = semAcento(texto).match(/[0-9a-z]+/g) ?? [];
	const saida: string[] = [];
	for (const t of brutos) {
		if (t.length < 2 || VAZIAS.has(t)) continue;
		const r = radical(t);
		if (!saida.includes(r)) saida.push(r);
	}
	return saida;
}

interface Indice {
	artigos: Artigo[];
	/** termo → posições (índices em `artigos`) em que aparece. */
	ocorrencias: Map<string, number[]>;
}

const indices = new WeakMap<Base, Indice>();

function indiceDe(base: Base): Indice {
	let indice = indices.get(base);
	if (indice) return indice;
	const artigos: Artigo[] = [];
	const ocorrencias = new Map<string, number[]>();
	for (const d of base.diplomas) {
		for (const a of d.artigos) {
			const i = artigos.length;
			artigos.push(a);
			for (const termo of new Set(termosDe(`${a.nota.h.join(" ")} ${a.linhas.join(" ")}`))) {
				const lista = ocorrencias.get(termo);
				if (lista) lista.push(i);
				else ocorrencias.set(termo, [i]);
			}
		}
	}
	indice = { artigos, ocorrencias };
	indices.set(base, indice);
	return indice;
}

export interface Achado {
	artigo: Artigo;
	/** Linha do artigo que melhor responde à busca. */
	linha: number;
	/** Subdivisão a que a linha pertence ("" quando o artigo é plano ou a linha é solta). */
	caminho: string;
	trecho: string;
	nota: number;
}

export interface OpcoesBusca {
	diploma?: Diploma;
	limite?: number;
}

/** Busca textual nos artigos: todos os termos (até dois) ou a maioria deles, com peso pela raridade. */
export function buscar(base: Base, consulta: string, opcoes: OpcoesBusca = {}): Achado[] {
	const termos = termosDe(consulta);
	if (termos.length === 0) return [];
	const { artigos, ocorrencias } = indiceDe(base);
	const total = artigos.length;
	const peso = new Map<string, number>();
	for (const t of termos) peso.set(t, Math.log(1 + total / (1 + (ocorrencias.get(t)?.length ?? 0))));
	const notas = new Map<number, { soma: number; quantos: number }>();
	for (const t of termos) {
		for (const i of ocorrencias.get(t) ?? []) {
			const atual = notas.get(i) ?? { soma: 0, quantos: 0 };
			atual.soma += peso.get(t) ?? 0;
			atual.quantos++;
			notas.set(i, atual);
		}
	}
	const minimo = termos.length <= 2 ? termos.length : Math.ceil(termos.length * 0.6);
	const frase = semAcento(consulta);
	const achados: Achado[] = [];
	for (const [i, n] of notas) {
		if (n.quantos < minimo) continue;
		const artigo = artigos[i];
		if (opcoes.diploma && artigo.diploma !== opcoes.diploma) continue;
		let melhorLinha = 0;
		let melhorNota = -1;
		artigo.linhas.forEach((linha, k) => {
			const plana = semAcento(linha);
			const presentes = new Set(termosDe(linha));
			let s = 0;
			for (const t of termos) if (presentes.has(t)) s += peso.get(t) ?? 0;
			if (frase.length >= 6 && plana.includes(frase)) s += 4;
			if (s > melhorNota) {
				melhorNota = s;
				melhorLinha = k;
			}
		});
		let caminho = "";
		for (const u of artigo.listaUnidades) {
			if (melhorLinha >= u.inicio && melhorLinha < u.fim) caminho = u.caminho;
		}
		// o assunto da divisão ("Da Tutela de Urgência") e o caput pesam mais que uma menção de passagem
		const daDivisao = new Set(termosDe(artigo.nota.h.join(" ")));
		const caput = artigo.unidades?.get("caput");
		const doCaput = new Set(termosDe(artigo.linhas[caput ? caput.inicio : 0] ?? ""));
		let contexto = 0;
		for (const t of termos) {
			if (daDivisao.has(t)) contexto += 1.2 * (peso.get(t) ?? 0);
			if (doCaput.has(t)) contexto += 0.5 * (peso.get(t) ?? 0);
		}
		const nota = (n.soma + 0.6 * melhorNota + contexto) * (artigo.revogado ? 0.4 : 1);
		achados.push({ artigo, linha: melhorLinha, caminho, trecho: semAnotacoes(semMarcaDeTachado(artigo.linhas[melhorLinha])), nota });
	}
	achados.sort((a, b) => b.nota - a.nota || artigos.indexOf(a.artigo) - artigos.indexOf(b.artigo));
	return achados.slice(0, opcoes.limite ?? 10);
}
