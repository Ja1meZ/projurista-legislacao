import { ErroFerramenta, Ferramenta, ResultadoFerramenta } from "../mcp/tipos";
import { Artigo, Base, Diploma, baseLegislacao, resumoCobertura } from "./base";
import { buscar } from "./busca";
import { Conferencia, Relatorio, Resultado, Veredito, verificarTexto } from "./comparador";
import { diplomaNoInicio, interpretarReferencia } from "./referencia";
import { hierarquiaDoArtigo, linhasDaUnidade, linhasDoIntervalo, nomeDoCaminho, nomeDoDispositivo } from "./texto";

const SOMENTE_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function texto(conteudo: string): ResultadoFerramenta {
	return { content: [{ type: "text", text: conteudo }] };
}

export function rodape(base: Base): string {
	return `Base Projurista Legislação ${base.versao} — ${resumoCobertura(base)}. Texto do Portal da Legislação (Planalto), fotografado na data da fonte de cada diploma; alteração posterior não está refletida. Diploma ou artigo ausente da base não é inexistente.`;
}

function maiuscula(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Resolve o nome, a sigla ou o número de um diploma dito pelo usuário. */
export function lerDiploma(base: Base, valor: unknown): { diploma?: Diploma; corpo: string; mensagem?: string } {
	if (typeof valor !== "string" || !valor.trim()) return { corpo: "" };
	const dito = valor.trim();
	const achado = diplomaNoInicio(base, dito, "livre");
	if (achado?.tipo === "diploma") return { diploma: achado.diploma, corpo: achado.corpo };
	if (achado?.tipo === "fora") return { corpo: "", mensagem: `${achado.rotulo}: ${achado.motivo}` };
	return { corpo: "", mensagem: `Diploma "${dito}" não reconhecido. Use listar_diplomas para ver as siglas e os nomes aceitos.` };
}

export interface OpcoesCitacao {
	/** Mantém as anotações de alteração legislativa na citação. */
	anotacoes?: boolean;
}

/** Citação pronta de um dispositivo: identificação padronizada e texto literal entre aspas. */
export function citacaoPronta(artigo: Artigo, caminho: string, opcoes: OpcoesCitacao = {}): string | undefined {
	if (artigo.revogado) return undefined;
	const unidade = caminho ? artigo.unidades?.get(caminho) : undefined;
	if (caminho && !unidade) return undefined;
	const linhas = linhasDaUnidade(artigo, unidade, { anotacoes: opcoes.anotacoes });
	if (linhas.length === 0) return undefined;
	return `${maiuscula(nomeDoDispositivo(artigo, caminho))}: “${linhas.join("\n")}”`;
}

/** Só o texto literal do dispositivo, sem identificação. */
export function textoLiteral(artigo: Artigo, caminho: string, opcoes: OpcoesCitacao = {}): string {
	const unidade = caminho ? artigo.unidades?.get(caminho) : undefined;
	return linhasDaUnidade(artigo, unidade, { anotacoes: opcoes.anotacoes }).join("\n");
}

export function fichaDispositivo(base: Base, artigo: Artigo, caminho: string): string {
	const d = artigo.diploma;
	const linhas: string[] = [];
	let unidade = caminho ? artigo.unidades?.get(caminho) : undefined;
	let efetivo = caminho;
	if (artigo.revogado) linhas.push("ATENÇÃO: este artigo está REVOGADO na fonte oficial (texto tachado). Não o cite como direito vigente.", "");
	if (caminho && artigo.plano) {
		linhas.push(
			`ATENÇÃO: a base não tem recorte confiável por subdivisão neste artigo (${artigo.plano}). Segue o ARTIGO INTEIRO; localize nele ${nomeDoCaminho(caminho)} e copie o trecho sem alterar.`,
			"",
		);
		efetivo = "";
	} else if (caminho && !unidade) {
		const filhas = artigo.listaUnidades.filter((u) => u.caminho !== "caput").map((u) => nomeDoCaminho(u.caminho));
		const aviso = artigo.soltas > 0 ? " O artigo tem trechos sem rótulo reconhecível na base: confira no texto integral abaixo." : "";
		linhas.push(
			`NÃO ENCONTRADO NA BASE: o art. ${artigo.rotulo} de ${d.nome} não tem ${nomeDoCaminho(caminho)} (fonte de ${d.dataFonte}).${aviso}`,
			filhas.length ? `Subdivisões que constam do artigo: ${filhas.join("; ")}.` : "O artigo não tem subdivisões.",
			"Não escreva esse dispositivo de memória. Segue o artigo inteiro, para conferência.",
			"",
		);
		efetivo = "";
	}
	if (unidade?.tachada && !artigo.revogado) linhas.push("ATENÇÃO: este dispositivo está REVOGADO na fonte oficial (texto tachado). Não o cite como direito vigente.", "");
	for (const aviso of [...artigo.avisos, ...d.avisos]) linhas.push(`AVISO: ${aviso}`);
	if (artigo.avisos.length + d.avisos.length) linhas.push("");
	if (!efetivo) unidade = undefined;

	linhas.push(`${d.nome} (${d.lei}) — ${nomeDoDispositivo(artigo, efetivo)}`);
	const hierarquia = hierarquiaDoArtigo(artigo);
	if (hierarquia) linhas.push(hierarquia);
	linhas.push("", `Texto literal (fonte oficial, ${d.dataFonte}):`);
	linhas.push(...linhasDaUnidade(artigo, unidade, { anotacoes: true, tachadas: true, rubricas: true }));
	const citacao = citacaoPronta(artigo, efetivo);
	if (citacao && !(unidade?.tachada)) {
		linhas.push("", "Citação pronta (copie sem alterar; sem as anotações de alteração legislativa):", citacao);
	}
	if (unidade && unidade.caminho !== "caput" && !artigo.plano) {
		const caput = artigo.unidades?.get("caput");
		if (caput) linhas.push("", "Contexto — caput do artigo:", ...linhasDoIntervalo(artigo, caput.inicio, caput.inicio + 1));
		const pai = unidade.caminho.includes("/") ? artigo.unidades?.get(unidade.caminho.slice(0, unidade.caminho.lastIndexOf("/"))) : undefined;
		if (pai && pai.caminho !== "caput") linhas.push(`Contexto — ${nomeDoCaminho(pai.caminho)}:`, ...linhasDoIntervalo(artigo, pai.inicio, pai.inicio + 1));
	}
	if (unidade?.seguidaDeTextoSemRotulo) {
		linhas.push("", "Nota: logo depois deste dispositivo há texto sem rótulo próprio (pena, sanção ou continuação) que não entrou no recorte. Consulte o artigo inteiro se precisar dele.");
	}
	if (!unidade && artigo.faixaAte) linhas.push("", `Nota: este registro cobre a faixa de artigos ${artigo.chave} a ${artigo.faixaAte}.`);
	if (artigo.anteriores.length) {
		linhas.push("", `Nota: a base guarda ${artigo.anteriores.length} linha(s) de redação anterior deste artigo, não vigentes. Elas não integram a citação.`);
	}
	linhas.push(
		"",
		`Identificador ${d.sigla}:${artigo.chave}${efetivo ? `#${efetivo}` : ""} · sha256 do artigo ${artigo.sha256}`,
		`Fonte: ${d.fonte.replace(/^raw\//, "")} · ${rodape(base)}`,
	);
	return linhas.join("\n");
}

function naoEncontrado(base: Base, diploma: Diploma, chave: string): string {
	const corpo = chave.includes(":") ? chave.slice(0, chave.indexOf(":")) : "";
	const numero = corpo ? chave.slice(corpo.length + 1) : chave;
	const doCorpo = diploma.artigos.filter((a) => a.corpo === corpo);
	const faixa = doCorpo.length ? `Constam ${doCorpo.length} artigos, do art. ${doCorpo[0].rotulo} ao art. ${doCorpo[doCorpo.length - 1].rotulo}.` : "";
	return [
		`NÃO ENCONTRADO NA BASE: não há art. ${numero} ${corpo === "ADCT" ? "no ADCT" : `em ${diploma.nome} (${diploma.lei})`}, na fonte de ${diploma.dataFonte}. ${faixa}`,
		"Confira o número do artigo e o diploma. Não escreva o dispositivo de memória.",
		rodape(base),
	].join("\n");
}

export const obterDispositivo: Ferramenta = {
	name: "obter_dispositivo",
	description:
		"Devolve o texto LITERAL de um dispositivo de lei (artigo, parágrafo, inciso, alínea ou item) da base embutida, com a citação pronta para copiar, a posição no diploma, as ressalvas (revogação, falta de consenso na fonte) e o hash de integridade. Use SEMPRE antes de transcrever ou citar o teor de um artigo: nunca escreva texto de lei de memória. Aceita a referência escrita livremente (\"art. 1.015, parágrafo único, do CPC\", \"CF 5 LV\", \"art. 37, § 6º, da Constituição\") ou os campos separados.",
	annotations: SOMENTE_LEITURA,
	inputSchema: {
		type: "object",
		properties: {
			referencia: { type: "string", description: 'Referência completa, como se escreve em uma peça: "art. 85, § 11, do CPC"; "art. 5º, LV, da CF"; "ADCT 100"; "Lei 9.099/1995, art. 3º, I".' },
			diploma: { type: "string", description: 'Alternativa aos campos separados: sigla, nome ou número do diploma ("CPC", "Constituição Federal", "Lei 8.429/1992").' },
			artigo: { type: "string", description: 'Número do artigo ("1.015", "103-A", "5").' },
			dispositivo: { type: "string", description: 'Subdivisão dentro do artigo ("caput", "§ 1º", "parágrafo único", "§ 4º, III", "I, a"). Vazio = artigo inteiro.' },
		},
		additionalProperties: false,
	},
	executar(args) {
		const base = baseLegislacao();
		let lida;
		if (typeof args.referencia === "string" && args.referencia.trim()) {
			const padrao = lerDiploma(base, args.diploma);
			lida = interpretarReferencia(base, args.referencia, padrao.diploma);
		} else {
			const artigo = typeof args.artigo === "number" ? String(args.artigo) : typeof args.artigo === "string" ? args.artigo.trim() : "";
			if (!artigo) throw new ErroFerramenta('Informe "referencia" (por exemplo, "art. 85, § 11, do CPC") ou os campos "diploma" e "artigo".');
			const d = lerDiploma(base, args.diploma);
			if (d.mensagem) return Promise.resolve(texto(`${d.mensagem}\n${rodape(base)}`));
			if (!d.diploma) throw new ErroFerramenta('Informe o "diploma" (sigla, nome ou número da lei).');
			const sub = typeof args.dispositivo === "string" && args.dispositivo.trim() ? `, ${args.dispositivo.trim()}` : "";
			lida = interpretarReferencia(base, `${d.corpo ? "ADCT " : ""}art. ${artigo}${sub}`, d.diploma);
		}
		if (lida.fora) {
			return Promise.resolve(texto(`NÃO ENCONTRADO NA BASE: ${lida.fora.rotulo}. ${lida.fora.motivo}\nNão escreva o dispositivo de memória: consulte a fonte oficial.\n${rodape(base)}`));
		}
		if (lida.erro || !lida.diploma || !lida.chave) throw new ErroFerramenta(lida.erro ?? "Referência não compreendida.");
		const artigo = lida.diploma.obter(lida.chave);
		if (!artigo) return Promise.resolve(texto(naoEncontrado(base, lida.diploma, lida.chave)));
		const caminhos = lida.caminhos.length ? lida.caminhos.slice(0, 12) : [""];
		return Promise.resolve(texto(caminhos.map((c) => fichaDispositivo(base, artigo, c)).join("\n\n———\n\n")));
	},
};

export const buscarLegislacao: Ferramenta = {
	name: "buscar_legislacao",
	description:
		"Procura, pelo assunto ou por palavras do texto, os dispositivos de lei da base embutida (60 diplomas federais: Constituição, códigos e leis usuais). Devolve os artigos mais pertinentes, com o trecho que responde à busca e a referência para obter_dispositivo. Use para descobrir QUAL artigo trata de um tema; para citar, chame depois obter_dispositivo. A busca é textual: tente duas ou três formulações com os termos que a lei usaria.",
	annotations: SOMENTE_LEITURA,
	inputSchema: {
		type: "object",
		properties: {
			termo: { type: "string", description: 'Palavras a procurar no texto da lei ("tutela de urgência requisitos", "prescrição intercorrente").' },
			diploma: { type: "string", description: "Restringe a busca a um diploma (sigla, nome ou número)." },
			limite: { type: "integer", minimum: 1, maximum: 30, default: 10 },
		},
		required: ["termo"],
		additionalProperties: false,
	},
	executar(args) {
		const base = baseLegislacao();
		if (typeof args.termo !== "string" || !args.termo.trim()) throw new ErroFerramenta('O parâmetro "termo" é obrigatório.');
		const d = lerDiploma(base, args.diploma);
		if (d.mensagem) return Promise.resolve(texto(`${d.mensagem}\n${rodape(base)}`));
		const limite = typeof args.limite === "number" ? Math.min(30, Math.max(1, Math.floor(args.limite))) : 10;
		const achados = buscar(base, args.termo, { diploma: d.diploma, limite });
		if (achados.length === 0) {
			return Promise.resolve(
				texto(`Nenhum dispositivo encontrado para "${args.termo.trim()}"${d.diploma ? ` em ${d.diploma.nome}` : ""}. Tente outros termos (os que a lei usaria) ou confira em listar_diplomas se o diploma está na base. A ausência de resultado não significa que a lei não trate do assunto.\n${rodape(base)}`),
			);
		}
		const linhas = [`${achados.length} dispositivo(s) para "${args.termo.trim()}"${d.diploma ? ` em ${d.diploma.nome}` : ""}:`, ""];
		achados.forEach((a, i) => {
			const nome = maiuscula(nomeDoDispositivo(a.artigo, a.caminho));
			const trecho = a.trecho.length > 420 ? `${a.trecho.slice(0, 420)}…` : a.trecho;
			linhas.push(
				`${i + 1}. ${nome}${a.artigo.revogado ? " [REVOGADO]" : ""} — ${a.artigo.diploma.nome}`,
				`   ${hierarquiaDoArtigo(a.artigo) || "—"}`,
				`   Trecho: ${trecho}`,
				`   Para o texto literal: obter_dispositivo(referencia="${nomeDoDispositivo(a.artigo, a.caminho)}")`,
				"",
			);
		});
		linhas.push("Os trechos acima servem para localizar; antes de citar, chame obter_dispositivo e copie a citação pronta.", rodape(base));
		return Promise.resolve(texto(linhas.join("\n")));
	},
};

export function listaDeDiplomas(base: Base): string {
	const linhas = [`Diplomas da base Projurista Legislação ${base.versao} (${resumoCobertura(base)}):`, ""];
	for (const d of base.diplomas) {
		const outros = d.apelidos.slice(0, 4).join("; ");
		linhas.push(`${d.sigla} — ${d.nome} (${d.lei}) · ${d.artigos.length} artigos · fonte de ${d.dataFonte}${outros ? ` · também: ${outros}` : ""}`);
	}
	if (base.ausentes.length) {
		linhas.push("", "Fora da base (não cite de memória):", ...base.ausentes.map((a) => `${a.nome} (${a.lei}) — ${a.motivo}`));
	}
	linhas.push("", rodape(base));
	return linhas.join("\n");
}

export const listarDiplomas: Ferramenta = {
	name: "listar_diplomas",
	description: "Lista os diplomas legais que integram a base embutida, com sigla, nome, número do ato, quantidade de artigos e data da fonte oficial. Use para saber se uma lei está na base e como referi-la em obter_dispositivo e buscar_legislacao.",
	annotations: SOMENTE_LEITURA,
	inputSchema: { type: "object", properties: {}, additionalProperties: false },
	executar() {
		return Promise.resolve(texto(listaDeDiplomas(baseLegislacao())));
	},
};

export const TEXTO_VEREDITO: Record<Veredito, string> = {
	INTEGRALMENTE_VERIFICADO: "INTEGRALMENTE VERIFICADO — todas as referências a dispositivos de lei foram localizadas na base e as transcrições conferem.",
	VERIFICADO_COM_RESSALVAS: "VERIFICADO COM RESSALVAS — nada diverge do texto oficial, mas há pontos de atenção ou referências que a base não permite conferir.",
	NAO_VERIFICADO: "NÃO VERIFICADO — há transcrição divergente, dispositivo não localizado ou dispositivo revogado citado sem ressalva.",
	SEM_REFERENCIAS: "SEM REFERÊNCIAS — nenhuma referência a artigo de lei foi reconhecida no texto.",
};

export const ROTULO_RESULTADO: Record<Resultado, string> = {
	CONFERE_LITERAL: "Confere literalmente",
	CONFERE_TRECHO: "Confere (transcrição parcial)",
	CONFERE_COM_DIFERENCA_DE_FORMA: "Confere, com diferença de forma",
	CONFERE_EM_OUTRA_SUBDIVISAO: "Texto confere, subdivisão indicada não",
	CONFERE_COM_REDACAO_ANTERIOR: "Corresponde a redação anterior (não vigente)",
	DIVERGENTE: "Divergente do texto oficial",
	SEM_TRANSCRICAO: "Dispositivo existe (sem transcrição a conferir)",
	ARTIGO_NAO_ENCONTRADO: "Artigo não encontrado no diploma",
	SUBDIVISAO_NAO_ENCONTRADA: "Subdivisão não encontrada no artigo",
	SUBDIVISAO_NAO_CONFERIVEL: "Subdivisão não conferível na base",
	DIPLOMA_FORA_DA_BASE: "Diploma fora da base (não conferido)",
	DIPLOMA_NAO_IDENTIFICADO: "Diploma não identificado (não conferido)",
};

function itemRelatorio(c: Conferencia, n: number): string[] {
	const linhas = [`${n}. Linha ${c.linha} — "${c.mencao}"${c.caminho && !c.mencao.includes("§") && c.dispositivo ? ` → ${c.dispositivo}` : ""}`, `   Resultado: ${ROTULO_RESULTADO[c.resultado]}`];
	if (c.alerta) linhas.push(`   ALERTA: ${c.alerta}`);
	const mostraOficial = c.resultado === "DIVERGENTE" || c.resultado === "CONFERE_COM_REDACAO_ANTERIOR" || c.resultado === "CONFERE_COM_DIFERENCA_DE_FORMA" || c.resultado === "CONFERE_EM_OUTRA_SUBDIVISAO";
	if (c.transcricao && mostraOficial) linhas.push(`   Citado: “${c.transcricao}”`);
	if (c.oficial && mostraOficial) linhas.push(`   Texto oficial (${c.dispositivo}): “${c.oficial.replace(/\n/g, " ")}”`);
	for (const d of (c.diferencas ?? []).slice(0, 12)) {
		linhas.push(`   Diferença: citado “${d.citado || "(nada)"}” × oficial “${d.oficial || "(nada)"}”`);
	}
	if ((c.diferencas?.length ?? 0) > 12) linhas.push(`   (+ ${(c.diferencas?.length ?? 0) - 12} diferença(s))`);
	for (const nota of c.notas) linhas.push(`   Nota: ${nota}`);
	return linhas;
}

export function relatorioEmTexto(relatorio: Relatorio, base: Base): string {
	const linhas = ["VERIFICAÇÃO DE CITAÇÕES DE LEGISLAÇÃO", `Veredito: ${TEXTO_VEREDITO[relatorio.veredito]}`];
	if (relatorio.conferencias.length > 0) {
		const partes = Object.entries(relatorio.contagem).map(([k, v]) => `${v} ${k === "ALERTA_DE_REVOGACAO" ? "alerta(s) de revogação" : ROTULO_RESULTADO[k as Resultado].toLowerCase()}`);
		linhas.push(`Referências encontradas: ${relatorio.conferencias.length} (${partes.join("; ")}).`, "");
		const atencao = relatorio.conferencias.filter((c) => c.resultado !== "SEM_TRANSCRICAO" && c.resultado !== "CONFERE_LITERAL" && c.resultado !== "CONFERE_TRECHO" || c.alerta || c.notas.length > 0);
		const limpas = relatorio.conferencias.filter((c) => !atencao.includes(c));
		atencao.forEach((c, i) => linhas.push(...itemRelatorio(c, i + 1), ""));
		if (limpas.length) {
			linhas.push(`Sem observações (${limpas.length}):`);
			for (const c of limpas) linhas.push(`   Linha ${c.linha} — ${c.dispositivo ?? c.mencao}: ${ROTULO_RESULTADO[c.resultado].toLowerCase()}`);
			linhas.push("");
		}
	} else {
		linhas.push("");
	}
	linhas.push(
		"Alcance: a conferência é feita por código, sem modelo de linguagem. Cobre as referências a artigos que o detector reconheceu e os diplomas da base; confere a existência do dispositivo e, havendo transcrição entre aspas ou após dois-pontos, o texto palavra por palavra. Não avalia se o dispositivo é pertinente ao caso.",
		rodape(base),
	);
	if (base.adulterados.length) linhas.push(`Aviso: ${base.adulterados.length} artigo(s) da base foram descartados por falha de integridade.`);
	return linhas.join("\n");
}

export function relatorioEmJson(relatorio: Relatorio): string {
	return JSON.stringify(
		{
			veredito: relatorio.veredito,
			versao_base: relatorio.versaoBase,
			contagem: relatorio.contagem,
			referencias: relatorio.conferencias.map((c) => ({
				linha: c.linha,
				mencao: c.mencao,
				resultado: c.resultado,
				diploma: c.diploma?.sigla,
				artigo: c.artigo?.chave,
				subdivisao: c.caminho || undefined,
				dispositivo: c.dispositivo,
				alerta: c.alerta,
				citado: c.transcricao,
				oficial: c.oficial,
				diferencas: c.diferencas,
				notas: c.notas,
				data_fonte: c.diploma?.dataFonte,
				sha256_artigo: c.artigo?.sha256,
			})),
		},
		null,
		2,
	);
}

export const verificarCitacoesLegislacao: Ferramenta = {
	name: "verificar_citacoes_legislacao",
	description:
		"Confere, por código e sem modelo de linguagem, todas as referências a artigos de lei em um texto jurídico (minuta, voto, petição, parecer). Para cada referência, diz se o artigo e a subdivisão existem no diploma, se a transcrição confere palavra por palavra com o texto oficial (mostrando as diferenças), se o trecho é de redação anterior não vigente e se o dispositivo está revogado. Termina com um veredito do documento. Use ao analisar um documento recebido e SEMPRE antes de entregar um texto que cite legislação. A ferramenta não altera o texto: aplique você as correções, com obter_dispositivo, e verifique de novo.",
	annotations: SOMENTE_LEITURA,
	inputSchema: {
		type: "object",
		properties: {
			texto: { type: "string", description: "Texto integral a conferir, exatamente como está (não resuma nem reescreva)." },
			diploma_padrao: { type: "string", description: 'Diploma a presumir quando a referência não diz de que lei é o artigo e não há diploma citado antes ("CPC", "CP"). Sem ele, essas referências saem como não identificadas.' },
			formato: { type: "string", enum: ["texto", "json"], description: "Formato do relatório. Padrão: texto.", default: "texto" },
		},
		required: ["texto"],
		additionalProperties: false,
	},
	executar(args) {
		const base = baseLegislacao();
		if (typeof args.texto !== "string" || args.texto.trim() === "") throw new ErroFerramenta('O parâmetro "texto" é obrigatório.');
		const d = lerDiploma(base, args.diploma_padrao);
		if (d.mensagem) throw new ErroFerramenta(d.mensagem);
		const relatorio = verificarTexto(args.texto, base, { diplomaPadrao: d.diploma });
		return Promise.resolve(texto(args.formato === "json" ? relatorioEmJson(relatorio) : relatorioEmTexto(relatorio, base)));
	},
};

export const FERRAMENTAS_LEGISLACAO: Ferramenta[] = [obterDispositivo, buscarLegislacao, listarDiplomas, verificarCitacoesLegislacao];

export const INSTRUCOES_LEGISLACAO =
	"Legislação federal (Constituição, códigos e leis usuais): nunca transcreva dispositivo de lei de memória. Antes de citar o teor de um artigo, parágrafo, inciso ou alínea, chame obter_dispositivo e copie a citação pronta, sem alterar; para descobrir qual artigo trata de um assunto, use buscar_legislacao; para saber se um diploma está na base, listar_diplomas. Informe ao usuário as ressalvas devolvidas (dispositivo revogado, falta de consenso na fonte, data da fonte). Diploma ou artigo ausente da base não é inexistente: diga que não está na base e não reconstrua o texto. Ao analisar um documento ou antes de entregar um texto que cite legislação, chame verificar_citacoes_legislacao com o texto integral e corrija o que não conferir.";
