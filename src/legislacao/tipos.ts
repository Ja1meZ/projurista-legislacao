/** Formato do arquivo dados/legislacao.json, gerado por scripts/exportar-base-legislacao.py. */

/** [caminho, início, fim (exclusivo), linha da rubrica ou -1, marcas]. Marcas: 1 = seguida de texto sem rótulo; 2 = tachada. */
export type UnidadeBruta = [string, number, number, number, number];

export interface ArtigoBruto {
	/** Chave normalizada: "1015", "103-A", "ADCT:112". */
	k: string;
	/** Rótulo como está na fonte: "1.015", "3º", "ADCT 112". */
	r: string;
	/** Índice da nota (divisão do diploma) a que o artigo pertence. */
	n: number;
	/** Linhas literais do artigo, uma por dispositivo. */
	l: string[];
	/** sha256 das linhas unidas por "\n". */
	s: string;
	u?: UnidadeBruta[];
	/** Linhas que são rubricas marginais. */
	rb?: number[];
	/** Quantidade de linhas sem rótulo (texto solto) no artigo. */
	st?: number;
	/** Motivo pelo qual o artigo não tem recorte por subdivisão. */
	pl?: string;
	rev?: 1;
	/** Último artigo da faixa condensada ("Arts. 52 a 58. (Revogados)"). */
	fx?: number;
	/** Redações anteriores, não vigentes. */
	ant?: string[];
	av?: string[];
}

export interface NotaBruta {
	nome: string;
	h: string[];
	s: string;
}

export interface DiplomaBruto {
	sigla: string;
	nome: string;
	lei: string;
	pasta: string;
	data_fonte: string;
	fonte: string;
	notas: NotaBruta[];
	abertura?: { nota: string; partes: [string, string[]][]; s: string };
	av?: string[];
	artigos: ArtigoBruto[];
}

export interface Ausente {
	nome: string;
	lei: string;
	formas: string[];
	motivo: string;
}

export interface BaseBruta {
	versao_base: string;
	gerado_em: string;
	aviso: string;
	ausentes: Ausente[];
	apelidos: Record<string, string[]>;
	diplomas: DiplomaBruto[];
}
