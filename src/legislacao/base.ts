import { createHash } from "crypto";
import dados from "../../dados/legislacao.json";
import { tirarAcentos } from "../comum/normalizar";
import type { ArtigoBruto, Ausente, BaseBruta, DiplomaBruto, NotaBruta, UnidadeBruta } from "./tipos";

export interface Unidade {
	caminho: string;
	inicio: number;
	fim: number;
	/** Linha da rubrica marginal que antecede a unidade, ou -1. */
	rubrica: number;
	seguidaDeTextoSemRotulo: boolean;
	tachada: boolean;
}

export interface Artigo {
	diploma: Diploma;
	chave: string;
	rotulo: string;
	/** "ADCT" quando o artigo pertence a corpo próprio dentro do diploma. */
	corpo: string;
	linhas: string[];
	sha256: string;
	nota: NotaBruta;
	/** Ausente quando o artigo é plano (sem recorte confiável). */
	unidades?: Map<string, Unidade>;
	listaUnidades: Unidade[];
	rubricas: number[];
	soltas: number;
	plano?: string;
	revogado: boolean;
	faixaAte?: number;
	anteriores: string[];
	avisos: string[];
}

export interface Diploma {
	sigla: string;
	nome: string;
	lei: string;
	pasta: string;
	dataFonte: string;
	fonte: string;
	avisos: string[];
	notas: NotaBruta[];
	abertura?: DiplomaBruto["abertura"];
	artigos: Artigo[];
	apelidos: string[];
	/** Identificador do ato: "lei:13105", "lc:101", "dl:2848", "dec:6514", "ec:113", "cf". */
	ato: string;
	ano: number;
	/** "do CPC", "da Lei n. 8.429/1992": como o diploma entra na citação pronta. */
	naCitacao: string;
	obter(chave: string): Artigo | undefined;
}

export interface Base {
	versao: string;
	geradoEm: string;
	aviso: string;
	diplomas: Diploma[];
	ausentes: Ausente[];
	totalArtigos: number;
	/** Artigos descartados na carga porque o hash do texto não fechou. */
	adulterados: string[];
	porSigla(sigla: string): Diploma | undefined;
}

function sha256(texto: string): string {
	return createHash("sha256").update(texto, "utf8").digest("hex");
}

const TIPOS_ATO: [RegExp, string, string][] = [
	[/^Lei Complementar n[ºo°.]*\s*([\d.]+)/i, "lc", "da Lei Complementar n."],
	[/^Lei n[ºo°.]*\s*([\d.]+)/i, "lei", "da Lei n."],
	[/^Decreto-Lei n[ºo°.]*\s*([\d.]+)/i, "dl", "do Decreto-Lei n."],
	[/^Decreto n[ºo°.]*\s*([\d.]+)/i, "dec", "do Decreto n."],
	[/^Emenda Constitucional n[ºo°.]*\s*([\d.]+)/i, "ec", "da Emenda Constitucional n."],
];

/** Diplomas citados pela sigla, com o artigo definido que os antecede. */
const SIGLA_NA_CITACAO: Record<string, string> = {
	CF: "da CF",
	CC: "do CC",
	CPC: "do CPC",
	CP: "do CP",
	CPP: "do CPP",
	CTN: "do CTN",
	CDC: "do CDC",
	CTB: "do CTB",
	CLT: "da CLT",
	ECA: "do ECA",
	LINDB: "da LINDB",
	LEP: "da LEP",
	RITJPE: "do RITJPE",
};

/** Origem do texto literal de cada diploma: o Planalto, salvo os atos de tribunal. */
export function fonteOficial(sigla: string): string {
	return sigla === "RITJPE" ? "do portal do Tribunal de Justiça de Pernambuco" : "do Portal da Legislação (Planalto)";
}

export function identificarAto(lei: string): { ato: string; ano: number; numero: string; prefixo: string } {
	const ano = Number(/(\d{4})\s*$/.exec(lei)?.[1] ?? 0);
	for (const [re, tipo, prefixo] of TIPOS_ATO) {
		const m = re.exec(lei);
		if (m) return { ato: `${tipo}:${m[1].replace(/\./g, "")}`, ano, numero: m[1], prefixo };
	}
	return { ato: /^Constitui/i.test(lei) ? "cf" : "", ano, numero: "", prefixo: "" };
}

function montarArtigo(diploma: Diploma, bruto: ArtigoBruto, nota: NotaBruta): Artigo {
	const lista: Unidade[] = (bruto.u ?? []).map((u: UnidadeBruta) => ({
		caminho: u[0],
		inicio: u[1],
		fim: u[2],
		rubrica: u[3],
		seguidaDeTextoSemRotulo: (u[4] & 1) !== 0,
		tachada: (u[4] & 2) !== 0,
	}));
	const doisPontos = bruto.k.indexOf(":");
	return {
		diploma,
		chave: bruto.k,
		rotulo: bruto.r,
		corpo: doisPontos > 0 ? bruto.k.slice(0, doisPontos) : "",
		linhas: bruto.l,
		sha256: bruto.s,
		nota,
		unidades: bruto.u ? new Map(lista.map((u) => [u.caminho, u])) : undefined,
		listaUnidades: lista,
		rubricas: bruto.rb ?? [],
		soltas: bruto.st ?? 0,
		plano: bruto.pl,
		revogado: bruto.rev === 1,
		faixaAte: bruto.fx,
		anteriores: bruto.ant ?? [],
		avisos: bruto.av ?? [],
	};
}

export function montarBase(bruta: BaseBruta): Base {
	const adulterados: string[] = [];
	const diplomas: Diploma[] = [];
	const porSigla = new Map<string, Diploma>();
	let total = 0;
	for (const d of bruta.diplomas) {
		const porChave = new Map<string, Artigo>();
		const faixas: [number, number, Artigo][] = [];
		const id = identificarAto(d.lei);
		const diploma: Diploma = {
			sigla: d.sigla,
			nome: d.nome,
			lei: d.lei,
			pasta: d.pasta,
			dataFonte: d.data_fonte,
			fonte: d.fonte,
			avisos: d.av ?? [],
			notas: d.notas,
			abertura: d.abertura,
			artigos: [],
			apelidos: bruta.apelidos?.[d.sigla] ?? [],
			ato: id.ato,
			ano: id.ano,
			naCitacao: SIGLA_NA_CITACAO[d.sigla] ?? (id.prefixo ? `${id.prefixo} ${id.numero}/${id.ano}` : `— ${d.nome}`),
			obter: (chave) => {
				const direto = porChave.get(chave);
				if (direto) return direto;
				const n = /^\d+$/.test(chave) ? Number(chave) : NaN;
				if (Number.isNaN(n)) return undefined;
				return faixas.find(([de, ate]) => n >= de && n <= ate)?.[2];
			},
		};
		for (const bruto of d.artigos) {
			if (sha256(bruto.l.join("\n")) !== bruto.s) {
				adulterados.push(`${d.sigla}:${bruto.k}`);
				continue;
			}
			const artigo = montarArtigo(diploma, bruto, d.notas[bruto.n]);
			diploma.artigos.push(artigo);
			porChave.set(artigo.chave, artigo);
			if (artigo.faixaAte) faixas.push([Number(artigo.chave), artigo.faixaAte, artigo]);
			total++;
		}
		diplomas.push(diploma);
		porSigla.set(chaveSigla(d.sigla), diploma);
	}
	return {
		versao: bruta.versao_base,
		geradoEm: bruta.gerado_em,
		aviso: bruta.aviso,
		diplomas,
		ausentes: bruta.ausentes ?? [],
		totalArtigos: total,
		adulterados,
		porSigla: (sigla) => porSigla.get(chaveSigla(sigla)),
	};
}

export function chaveSigla(s: string): string {
	return tirarAcentos(s).toLowerCase().replace(/[^0-9a-z]/g, "");
}

let instancia: Base | null = null;

/** Base embutida (texto JSON), analisada e conferida no primeiro uso. */
export function baseLegislacao(): Base {
	if (!instancia) instancia = montarBase(JSON.parse(dados) as BaseBruta);
	return instancia;
}

export function resumoCobertura(base: Base): string {
	return `${base.diplomas.length} diplomas, ${base.totalArtigos.toLocaleString("pt-BR")} artigos`;
}
