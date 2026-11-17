export interface Configuracoes {
	/** Porta do transporte TCP (ponte stdio do Claude Desktop). */
	portaTcp: number;
	/** Token compartilhado exigido pelo transporte. */
	token: string;
	/** Sobe o servidor assim que o Obsidian termina de carregar. */
	iniciarComObsidian: boolean;
	/** Tamanho máximo, em caracteres, do texto devolvido por uma ferramenta. */
	limiteCaracteres: number;
	/** O que o comando de inserção escreve no editor. */
	formatoInsercao: "citacao" | "texto";
	/** Mantém "(Redação dada pela ...)" e semelhantes no texto inserido. */
	manterAnotacoes: boolean;
	/** Pasta do cofre em que os diplomas são gravados como notas, a pedido. */
	pastaInstalacao: string;
}

export const CONFIGURACOES_PADRAO: Configuracoes = {
	portaTcp: 27190,
	token: "",
	iniciarComObsidian: true,
	limiteCaracteres: 200_000,
	formatoInsercao: "citacao",
	manterAnotacoes: false,
	pastaInstalacao: "Legislação",
};

/** Nome do servidor MCP como aparece no Claude. */
export const NOME_SERVIDOR = "projurista-legislacao";
