/**
 * Projurista Legislação — servidor MCP avulso (stdio), sem Obsidian.
 * Um arquivo só, sem dependências e sem rede: a base de legislação vai embutida.
 *
 *   node projurista-legislacao.mjs                              servidor MCP por stdio
 *   node projurista-legislacao.mjs obter "<referência>"         "art. 85, § 11, do CPC"; ou: obter CPC 1015 "parágrafo único"
 *   node projurista-legislacao.mjs buscar "<termos>" [--diploma CPC] [--limite N]
 *   node projurista-legislacao.mjs listar
 *   node projurista-legislacao.mjs verificar <arquivo> [--diploma CPC] [--json]
 *   node projurista-legislacao.mjs --versao
 *
 * "verificar" sai com código 1 quando o veredito é NAO_VERIFICADO (serve para ganchos e scripts).
 */
import { readFileSync } from "fs";
import { CONFIGURACOES_PADRAO } from "../configuracoes";
import { baseLegislacao, resumoCobertura } from "../legislacao/base";
import { FERRAMENTAS_LEGISLACAO, INSTRUCOES_LEGISLACAO, buscarLegislacao, listarDiplomas, obterDispositivo, verificarCitacoesLegislacao } from "../legislacao/ferramentas";
import { Despachante } from "../mcp/despachante";
import type { ContextoFerramenta } from "../mcp/tipos";
import { Registro } from "../registro";
import { servirStdio } from "./stdio";

declare const __VERSAO_PROJURISTA__: string;

const registro = new Registro(50);
const contexto = { configuracoes: { ...CONFIGURACOES_PADRAO }, registro } as unknown as ContextoFerramenta;

function escrever(linha: string): void {
	process.stdout.write(linha + "\n");
}

function opcao(args: string[], nome: string): string | undefined {
	const i = args.indexOf(nome);
	return i > 0 ? args[i + 1] : undefined;
}

async function linhaDeComando(args: string[]): Promise<number> {
	const comando = args[0];
	if (comando === "--versao" || comando === "--version") {
		const base = baseLegislacao();
		escrever(`projurista-legislacao ${__VERSAO_PROJURISTA__} · base ${base.versao} (${resumoCobertura(base)})`);
		return 0;
	}
	if (comando === "verificar" && args[1]) {
		const json = args.includes("--json");
		const resultado = await verificarCitacoesLegislacao.executar({ texto: readFileSync(args[1], "utf8"), formato: json ? "json" : "texto", diploma_padrao: opcao(args, "--diploma") }, contexto);
		const saida = resultado.content[0].text;
		escrever(saida);
		const reprovado = json ? (JSON.parse(saida) as { veredito: string }).veredito === "NAO_VERIFICADO" : saida.includes("Veredito: NÃO VERIFICADO");
		return reprovado ? 1 : 0;
	}
	if (comando === "obter" && args[1]) {
		const resultado = await obterDispositivo.executar({ referencia: args.slice(1).join(" ") }, contexto);
		escrever(resultado.content[0].text);
		return /^NÃO ENCONTRADO/m.test(resultado.content[0].text) ? 1 : 0;
	}
	if (comando === "buscar" && args[1]) {
		const limite = opcao(args, "--limite");
		const resultado = await buscarLegislacao.executar({ termo: args[1], limite: limite ? Number(limite) : undefined, diploma: opcao(args, "--diploma") }, contexto);
		escrever(resultado.content[0].text);
		return 0;
	}
	if (comando === "listar") {
		escrever((await listarDiplomas.executar({}, contexto)).content[0].text);
		return 0;
	}
	process.stderr.write(
		'Uso: projurista-legislacao [obter "<referência>" | buscar "<termos>" [--diploma SIGLA] [--limite N] | listar | verificar <arquivo> [--diploma SIGLA] [--json] | --versao]\nSem argumentos, inicia o servidor MCP por stdio.\n',
	);
	return 2;
}

function servidor(): void {
	servirStdio(
		new Despachante({
			nomeServidor: "projurista-legislacao",
			versaoServidor: __VERSAO_PROJURISTA__,
			ferramentas: FERRAMENTAS_LEGISLACAO,
			contexto: () => contexto,
			instrucoes: () => `Servidor de legislação da Projurista (base embutida, sem rede). ${INSTRUCOES_LEGISLACAO}`,
		}),
	);
}

const argumentos = process.argv.slice(2);
if (argumentos.length === 0) servidor();
else
	void linhaDeComando(argumentos).then(
		(codigo) => process.exit(codigo),
		(erro: unknown) => {
			process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
			process.exit(2);
		},
	);
