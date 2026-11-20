import { createHash } from "crypto";
import type { Artigo, Base, Diploma } from "./base";
import { fonteOficial } from "./base";

/** Notas de um diploma para gravação no cofre, no mesmo contrato das notas de origem (bloco LITERAL + sha256_texto). */
export interface NotaGerada {
	/** Caminho relativo à pasta de instalação: "<pasta do diploma>/<nome>.md". */
	caminho: string;
	conteudo: string;
	/** O bloco LITERAL remontado confere com o hash da nota de origem. */
	integra: boolean;
}

function nomeSeguro(nome: string): string {
	return nome.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function cabecalhoArtigo(a: Artigo): string {
	if (!a.corpo) return `## Art. ${a.rotulo}`;
	return `## ${a.corpo} — Art. ${a.rotulo.replace(new RegExp(`^${a.corpo}\\s+`), "")}`;
}

function blocoLiteral(artigos: Artigo[]): string {
	return artigos.map((a) => `${cabecalhoArtigo(a)}${a.linhas.length ? `\n\n${a.linhas.join("\n\n")}` : ""}`).join("\n\n");
}

function sha256(texto: string): string {
	return createHash("sha256").update(texto, "utf8").digest("hex");
}

function yaml(valor: string): string {
	return JSON.stringify(valor);
}

export function gerarNotas(base: Base, diploma: Diploma): NotaGerada[] {
	const pasta = nomeSeguro(diploma.pasta);
	const saida: NotaGerada[] = [];
	const porNota = new Map<number, Artigo[]>();
	diploma.artigos.forEach((a) => {
		const i = diploma.notas.indexOf(a.nota);
		const lista = porNota.get(i);
		if (lista) lista.push(a);
		else porNota.set(i, [a]);
	});
	const comum = (sha: string) => [
		"tipo: dispositivo-legal",
		`diploma: ${yaml(diploma.nome)}`,
		`sigla: ${yaml(diploma.sigla)}`,
		`lei: ${yaml(diploma.lei)}`,
		`data_fonte: ${diploma.dataFonte}`,
		`sha256_texto: ${yaml(sha)}`,
		'gerado_por: "projurista-legislacao"',
		`versao_base: ${yaml(base.versao)}`,
		"tags:",
		"  - legislacao",
		`  - ${diploma.sigla.toLowerCase()}`,
	];
	const indice: string[] = [];

	if (diploma.abertura) {
		const bloco = diploma.abertura.partes.map(([cab, linhas]) => `## ${cab}${linhas.length ? `\n\n${linhas.join("\n\n")}` : ""}`).join("\n\n");
		const nome = nomeSeguro(diploma.abertura.nota);
		saida.push({
			caminho: `${pasta}/${nome}.md`,
			integra: sha256(bloco) === diploma.abertura.s,
			conteudo: ["---", ...comum(diploma.abertura.s), "---", "", `# ${diploma.sigla} — Ementa, preâmbulo e fecho`, "", "<!-- LITERAL:INÍCIO -->", "", bloco, "", "<!-- LITERAL:FIM -->", ""].join("\n"),
		});
		indice.push(`| — | [[${nome}]] |`);
	}

	diploma.notas.forEach((nota, i) => {
		const artigos = porNota.get(i) ?? [];
		if (artigos.length === 0) return;
		const bloco = blocoLiteral(artigos);
		const nome = nomeSeguro(nota.nome);
		const anteriores = artigos.filter((a) => a.anteriores.length > 0);
		const linhas = [
			"---",
			...comum(nota.s),
			`artigos: [${artigos.map((a) => yaml(a.rotulo)).join(", ")}]`,
			...(nota.h.length ? ["hierarquia:", ...nota.h.map((h) => `  - ${yaml(h)}`)] : []),
			"---",
			"",
			`# ${nome}`,
			"",
			...(nota.h.length ? [`> ${nota.h.join(" › ")}`, ""] : []),
			"<!-- LITERAL:INÍCIO -->",
			"",
			bloco,
			"",
			"<!-- LITERAL:FIM -->",
			"",
		];
		if (anteriores.length) {
			linhas.push("---", "", "## Redações anteriores (não vigentes)", "", "> Preservadas por integralidade. Não citar como direito vigente.", "");
			for (const a of anteriores) linhas.push(`### Art. ${a.rotulo} — redação anterior`, "", a.anteriores.join("\n\n"), "");
		}
		saida.push({ caminho: `${pasta}/${nome}.md`, conteudo: linhas.join("\n"), integra: sha256(bloco) === nota.s });
		indice.push(`| ${artigos[0].rotulo}${artigos.length > 1 ? ` a ${artigos[artigos.length - 1].rotulo}` : ""} | [[${nome}]] |`);
	});

	saida.unshift({
		caminho: `${pasta}/${nomeSeguro(`${diploma.sigla} — Índice`)}.md`,
		integra: true,
		conteudo: [
			"---",
			"tipo: indice-legislacao",
			`diploma: ${yaml(diploma.nome)}`,
			`sigla: ${yaml(diploma.sigla)}`,
			`lei: ${yaml(diploma.lei)}`,
			`data_fonte: ${diploma.dataFonte}`,
			'gerado_por: "projurista-legislacao"',
			`versao_base: ${yaml(base.versao)}`,
			"---",
			"",
			`# ${diploma.nome}`,
			"",
			`${diploma.lei}. Texto literal ${fonteOficial(diploma.sigla)}, na data de ${diploma.dataFonte}. Notas gravadas pelo plugin Projurista Legislação a partir da base ${base.versao}; não edite o bloco entre LITERAL:INÍCIO e LITERAL:FIM.`,
			...diploma.avisos.map((a) => `\n> ${a}`),
			"",
			"| Artigos | Nota |",
			"|---|---|",
			...indice,
			"",
		].join("\n"),
	});
	return saida;
}
