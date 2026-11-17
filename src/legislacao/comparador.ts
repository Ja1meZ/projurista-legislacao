import { Diferenca, chaveForma, comparavel, diferencas, palavras, palavrasVisiveis, semelhanca } from "../comum/normalizar";
import type { Artigo, Base, Diploma, Unidade } from "./base";
import { Referencia, detectarReferencias } from "./detector";
import { linhasDaUnidade, linhasDoIntervalo, nomeDoCaminho, nomeDoDispositivo, semAnotacoes, semMarcaDeTachado } from "./texto";

export type Resultado =
	| "CONFERE_LITERAL"
	| "CONFERE_TRECHO"
	| "CONFERE_COM_DIFERENCA_DE_FORMA"
	| "CONFERE_EM_OUTRA_SUBDIVISAO"
	| "CONFERE_COM_REDACAO_ANTERIOR"
	| "DIVERGENTE"
	| "SEM_TRANSCRICAO"
	| "ARTIGO_NAO_ENCONTRADO"
	| "SUBDIVISAO_NAO_ENCONTRADA"
	| "SUBDIVISAO_NAO_CONFERIVEL"
	| "DIPLOMA_FORA_DA_BASE"
	| "DIPLOMA_NAO_IDENTIFICADO";

export type Veredito = "INTEGRALMENTE_VERIFICADO" | "VERIFICADO_COM_RESSALVAS" | "NAO_VERIFICADO" | "SEM_REFERENCIAS";

export interface Conferencia {
	linha: number;
	mencao: string;
	resultado: Resultado;
	diploma?: Diploma;
	artigo?: Artigo;
	/** Subdivisão pedida ("" = artigo inteiro). */
	caminho: string;
	/** Nome padronizado do dispositivo conferido. */
	dispositivo?: string;
	transcricao?: string;
	/** Texto literal da base para o dispositivo (sem anotações de alteração). */
	oficial?: string;
	diferencas?: Diferenca[];
	notas: string[];
	/** Dispositivo revogado citado sem ressalva: impede o veredito de verificado. */
	alerta?: string;
}

export interface Relatorio {
	veredito: Veredito;
	versaoBase: string;
	conferencias: Conferencia[];
	contagem: Record<string, number>;
}

export interface OpcoesVerificacao {
	/** Diploma a presumir quando a referência não diz de que lei é o artigo. */
	diplomaPadrao?: Diploma;
}

const RE_RETICENCIAS = /\s*(?:\(\s*(?:\.{3}|…)\s*\)|\[\s*(?:\.{3}|…)\s*\]|\.{3}|…)\s*/g;
const RE_RESSALVA = /revogad|previa\b|dispunha|estabelecia|determinava|rezava|n[ãa]o (?:mais )?(?:vig|subsist)|ent[ãa]o vigente|j[áa] n[ãa]o|reda[çc][ãa]o (?:anterior|original|primitiva|antiga)|antes da (?:lei|emenda|altera)|vigente [àa] [ée]poca|[àa] [ée]poca (?:dos fatos|vigente)|na reda[çc][ãa]o (?:dada|vigente|anterior|original)/i;
const RE_ROTULO = /^(?:Art(?:igo)?\.?\s*\d[\d.]*\s*[ºo°]?(?:-[A-Z])*\s*[.\-–—]?\s*|§\s*\d+\s*\.?[ºo°]?(?:-[A-Z])?\s*[.\-–—]?\s*|Par[áa]grafo\s+[úu]nico\s*[.\-–—]?\s*|[IVXLCDM]+(?:-[A-Z])?\s*[-–—]\s*|[a-z]\)\s*)/u;

function semPontoFinal(s: string): string {
	return s.replace(/[.;:,\s]+$/, "");
}

function limparCitacao(s: string): string {
	return comparavel(s);
}

/** Aspas e pontuação nas pontas não distinguem duas transcrições do mesmo texto. */
function aparado(s: string): string {
	return inicialNeutra(s.replace(/^["'\s]+|["'\s.;:,]+$/g, ""));
}

function inicialNeutra(s: string): string {
	const t = s.replace(/^\[(\p{L})\]/u, "$1");
	return t.charAt(0).toLowerCase() + t.slice(1);
}

function neutro(s: string): string {
	return inicialNeutra(semPontoFinal(s));
}

function semRotulo(s: string): string {
	return s.replace(RE_ROTULO, "");
}

/** Os trechos (separados por reticências) aparecem todos, em ordem, no texto oficial? */
function trechosEmOrdem(citado: string, oficial: string): boolean {
	const pedacos = citado.split(RE_RETICENCIAS).map(semPontoFinal).filter((p) => p.length > 0);
	if (pedacos.length === 0) return false;
	let posicao = 0;
	for (const pedaco of pedacos) {
		let achado = oficial.indexOf(pedaco, posicao);
		// citação embutida na frase começa em minúscula; no texto da lei, em maiúscula
		if (achado < 0) achado = oficial.indexOf(inicialNeutra(pedaco), posicao);
		if (achado < 0) achado = oficial.indexOf(pedaco.charAt(0).toUpperCase() + pedaco.slice(1), posicao);
		if (achado < 0) return false;
		posicao = achado + pedaco.length;
	}
	return true;
}

function mesmaForma(citado: string, oficial: string): boolean {
	const c = chaveForma(citado.replace(RE_RETICENCIAS, " "));
	const o = chaveForma(oficial);
	return c === o || (c.length >= 24 && o.includes(c));
}

interface Cotejo {
	resultado: Resultado;
	diferencas?: Diferenca[];
	nota?: string;
}

/** Textos oficiais de um intervalo: sem e com as anotações de alteração legislativa. */
function versoes(artigo: Artigo, unidade: Unidade | undefined): string[] {
	const sem = comparavel(linhasDaUnidade(artigo, unidade, { rubricas: false }).join(" "));
	const com = comparavel(linhasDaUnidade(artigo, unidade, { anotacoes: true, rubricas: true, tachadas: true }).join(" "));
	const comSemRubrica = comparavel(linhasDaUnidade(artigo, unidade, { anotacoes: true }).join(" "));
	return [...new Set([sem, comSemRubrica, com])];
}

function cobertura(citado: string[], oficial: string[]): number {
	if (citado.length === 0 || oficial.length === 0) return 0;
	const dice = semelhanca(citado, oficial);
	return (dice * (citado.length + oficial.length)) / 2 / citado.length;
}

/** Caput, parágrafo e inciso que encabeçam a subdivisão, seguidos dela: "O ônus da prova incumbe: I - ao autor...". */
function comAscendentes(artigo: Artigo, unidade: Unidade): string[] {
	const partes = unidade.caminho.split("/");
	const cabecas: Unidade[] = [];
	const caput = artigo.unidades?.get("caput");
	if (caput && unidade.caminho !== "caput") cabecas.push(caput);
	for (let i = 1; i < partes.length; i++) {
		const pai = artigo.unidades?.get(partes.slice(0, i).join("/"));
		if (pai) cabecas.push(pai);
	}
	if (cabecas.length === 0) return [];
	const montar = (anotacoes: boolean) =>
		comparavel([...cabecas.flatMap((c) => linhasDoIntervalo(artigo, c.inicio, c.inicio + 1, { anotacoes })), ...linhasDaUnidade(artigo, unidade, { anotacoes })].join(" "));
	return [...new Set([montar(false), montar(true)])];
}

/** Compara o trecho citado com o texto literal do dispositivo (e, se preciso, com o artigo inteiro e as redações anteriores). */
export function cotejar(citado: string, artigo: Artigo, unidade: Unidade | undefined): Cotejo {
	const c = limparCitacao(citado);
	const alvo = versoes(artigo, unidade);
	const cNeutro = neutro(c);
	const cSemRotulo = neutro(semRotulo(c));
	// referência ao artigo, sem subdivisão: a transcrição do caput inteiro é literal
	const caput = unidade ? undefined : artigo.unidades?.get("caput");
	const literais = caput ? [...alvo, ...versoes(artigo, { ...caput, fim: caput.inicio + 1 }), ...versoes(artigo, caput)] : alvo;
	for (const o of literais) {
		if (neutro(o) === cNeutro || neutro(semRotulo(o)) === cSemRotulo || aparado(o) === aparado(c) || aparado(semRotulo(o)) === aparado(semRotulo(c))) return { resultado: "CONFERE_LITERAL" };
	}
	for (const o of alvo) {
		if (trechosEmOrdem(c, o) || trechosEmOrdem(semRotulo(c), o)) {
			return { resultado: "CONFERE_TRECHO", nota: "Transcrição parcial: o trecho citado consta literalmente do dispositivo." };
		}
	}
	for (const o of alvo) {
		if (mesmaForma(c, o) || mesmaForma(semRotulo(c), semRotulo(o))) {
			return {
				resultado: "CONFERE_COM_DIFERENCA_DE_FORMA",
				nota: "Mesmas palavras, na mesma ordem; a diferença está só em pontuação, maiúsculas, acentos, hífen ou abreviação.",
				diferencas: chaveForma(c) === chaveForma(alvo[0]) ? diferencas(palavrasVisiveis(c), palavrasVisiveis(alvo[0])) : undefined,
			};
		}
	}
	if (unidade) {
		for (const o of comAscendentes(artigo, unidade)) {
			if (neutro(o) === cNeutro || aparado(o) === aparado(c)) return { resultado: "CONFERE_LITERAL" };
			if (trechosEmOrdem(c, o) || mesmaForma(c, o)) {
				return { resultado: "CONFERE_TRECHO", nota: "Transcrição parcial: o trecho citado consta literalmente do dispositivo e do texto que o encabeça." };
			}
		}
		for (const o of versoes(artigo, undefined)) {
			if (trechosEmOrdem(c, o) || trechosEmOrdem(semRotulo(c), o) || mesmaForma(c, o)) {
				const onde = unidadeQueContem(artigo, c);
				return {
					resultado: "CONFERE_EM_OUTRA_SUBDIVISAO",
					nota: `O trecho consta literalmente do artigo, mas não da subdivisão indicada (${nomeDoCaminho(unidade.caminho)})${onde ? `: está em ${nomeDoCaminho(onde)}` : ""}.`,
				};
			}
		}
	}
	const pc = palavras(c);
	if (artigo.anteriores.length > 0 && pc.length >= 6) {
		const anteriores = [comparavel(artigo.anteriores.map((l) => semAnotacoes(semMarcaDeTachado(l))).join(" ")), comparavel(artigo.anteriores.map(semMarcaDeTachado).join(" "))];
		for (const o of anteriores) {
			if (trechosEmOrdem(c, o) || trechosEmOrdem(semRotulo(c), o) || mesmaForma(c, o)) {
				return {
					resultado: "CONFERE_COM_REDACAO_ANTERIOR",
					nota: "O trecho citado corresponde a redação anterior do dispositivo, que não está mais em vigor.",
					diferencas: diferencas(palavrasVisiveis(c), palavrasVisiveis(alvo[0]), (a, b) => chaveForma(a) === chaveForma(b)),
				};
			}
		}
	}
	// divergente: escolhe, para mostrar as diferenças, a linha mais parecida com o trecho citado
	let melhor = alvo[0];
	let nota = semelhanca(pc, palavras(alvo[0]));
	const de = unidade ? unidade.inicio : 0;
	const ate = unidade ? unidade.fim : artigo.linhas.length;
	for (const linha of linhasDoIntervalo(artigo, de, ate)) {
		const s = semelhanca(pc, palavras(linha));
		if (s > nota) {
			nota = s;
			melhor = comparavel(linha);
		}
	}
	return {
		resultado: "DIVERGENTE",
		diferencas: apararDiferencas(diferencas(palavrasVisiveis(c), palavrasVisiveis(melhor), (a, b) => chaveForma(a) === chaveForma(b))),
	};
}

/** Transcrição parcial: o que sobra do texto oficial antes e depois do trecho citado não é divergência. */
function apararDiferencas(lista: Diferenca[]): Diferenca[] {
	const saida = [...lista];
	if (saida.length > 1 && saida[0].citado === "") saida.shift();
	const ultima = saida[saida.length - 1];
	if (saida.length > 1 && ultima.citado === "") saida.pop();
	else if (ultima) {
		const pc = ultima.citado.split(" ").filter((p) => p).length;
		const po = ultima.oficial.split(" ");
		if (po.length > pc + 4) saida[saida.length - 1] = { citado: ultima.citado, oficial: `${po.slice(0, pc + 3).join(" ")} …` };
	}
	return saida;
}

function unidadeQueContem(artigo: Artigo, citado: string): string | undefined {
	let achada: Unidade | undefined;
	for (const u of artigo.listaUnidades) {
		const o = comparavel(linhasDaUnidade(artigo, u).join(" "));
		if (trechosEmOrdem(citado, o) || mesmaForma(citado, o)) {
			if (!achada || u.fim - u.inicio <= achada.fim - achada.inicio) achada = u;
		}
	}
	return achada?.caminho;
}

/**
 * O trecho citado se parece com o texto do artigo a ponto de ser uma transcrição (ainda que com erro)?
 * Exige uma sequência de cinco palavras idêntica à da lei: paráfrase entre aspas não é transcrição.
 */
export function pareceTranscricao(citado: string, artigo: Artigo): boolean {
	const pc = palavras(limparCitacao(citado));
	if (pc.length < 5) return false;
	const textos = [linhasDoIntervalo(artigo, 0, artigo.linhas.length, { anotacoes: true, tachadas: true }).join(" "), artigo.anteriores.join(" ")];
	for (const t of textos) {
		const po = palavras(t);
		if (po.length < 5) continue;
		const sequencias = new Set<string>();
		for (let i = 0; i + 5 <= po.length; i++) sequencias.add(po.slice(i, i + 5).join(" "));
		let comum = false;
		for (let i = 0; i + 5 <= pc.length && !comum; i++) comum = sequencias.has(pc.slice(i, i + 5).join(" "));
		if (comum && cobertura(pc, po) >= 0.6) return true;
	}
	return false;
}

function confere(resultado: Resultado): boolean {
	return resultado.startsWith("CONFERE");
}

function subdivisoesIrmas(artigo: Artigo, caminho: string): string {
	const pai = caminho.includes("/") ? caminho.slice(0, caminho.lastIndexOf("/")) : "";
	const irmas = artigo.listaUnidades
		.filter((u) => u.caminho !== "caput" && (pai ? u.caminho.startsWith(`${pai}/`) && !u.caminho.slice(pai.length + 1).includes("/") : !u.caminho.includes("/")))
		.map((u) => nomeDoCaminho(u.caminho.slice(pai ? pai.length + 1 : 0)));
	if (irmas.length === 0) return pai ? `${nomeDoCaminho(pai)} não tem subdivisões` : "o artigo não tem subdivisões";
	const lista = irmas.length > 14 ? `${irmas.slice(0, 14).join("; ")}; …` : irmas.join("; ");
	return `${pai ? `em ${nomeDoCaminho(pai)} ` : ""}constam: ${lista}`;
}

function conferirReferencia(ref: Referencia, texto: string, base: Base, opcoes: OpcoesVerificacao, ultimoDiploma: Diploma | undefined): Conferencia {
	const conf: Conferencia = { linha: ref.linha, mencao: ref.mencao, resultado: "SEM_TRANSCRICAO", caminho: ref.caminho, notas: [] };
	if (ref.transcricao) conf.transcricao = ref.transcricao.texto.replace(/\s+/g, " ").trim();
	if (ref.fora) {
		conf.resultado = "DIPLOMA_FORA_DA_BASE";
		conf.notas.push(`${ref.fora.rotulo}: ${ref.fora.motivo} A referência não foi conferida.`);
		return conf;
	}

	let diploma = ref.diploma;
	const chave = (ref.corpo ? `${ref.corpo}:` : "") + ref.artigo;
	if (!diploma) {
		// 1) a transcrição identifica o diploma; 2) último diploma citado; 3) diploma_padrao
		const candidatos = [ultimoDiploma, opcoes.diplomaPadrao].filter((d): d is Diploma => Boolean(d));
		if (ref.transcricao) {
			const ordem = [...candidatos, ...base.diplomas.filter((d) => !candidatos.includes(d))];
			for (const d of ordem) {
				const a = d.obter(chave);
				if (a && confere(cotejar(ref.transcricao.texto, a, undefined).resultado)) {
					diploma = d;
					conf.notas.push(`A referência não diz o diploma; identificado pelo texto transcrito: ${d.nome}.`);
					break;
				}
			}
		}
		if (!diploma) {
			// presunção só confirma: sem diploma dito, artigo ou subdivisão ausentes não são acusados
			const presumido = ref.origem === "mesmo_diploma" ? ultimoDiploma : (ultimoDiploma ?? opcoes.diplomaPadrao);
			const artigo = presumido?.obter(chave);
			const existe = artigo && (!ref.caminho || Boolean(artigo.plano) || artigo.soltas > 0 || artigo.unidades?.has(ref.caminho));
			if (presumido && artigo && existe) {
				if (ref.transcricao && !pareceTranscricao(ref.transcricao.texto, artigo)) {
					ref = { ...ref, transcricao: undefined };
					delete conf.transcricao;
				}
				diploma = presumido;
				conf.notas.push(
					ref.origem === "mesmo_diploma"
						? `"Mesmo diploma" lido como ${presumido.nome}, o último citado no texto.`
						: `A referência não diz o diploma; presumido ${presumido.nome}${presumido === ultimoDiploma ? ", o último citado no texto" : " (diploma_padrao)"}.`,
				);
			}
		}
		if (!diploma) {
			conf.resultado = "DIPLOMA_NAO_IDENTIFICADO";
			conf.notas.push("A referência não diz de que diploma é o artigo, e não foi possível presumi-lo com segurança. Não conferida.");
			return conf;
		}
	}
	conf.diploma = diploma;

	const artigo = diploma.obter(chave);
	if (!artigo) {
		conf.resultado = "ARTIGO_NAO_ENCONTRADO";
		const onde = ref.corpo === "ADCT" ? "ADCT" : `${diploma.nome} (${diploma.lei})`;
		conf.notas.push(`Não há art. ${ref.artigo} em ${onde}, no texto que integra a base (fonte de ${diploma.dataFonte}). Confira o número do artigo e o diploma.`);
		return conf;
	}
	conf.artigo = artigo;
	if (ref.faixaAte && !diploma.obter((ref.corpo ? `${ref.corpo}:` : "") + ref.faixaAte)) {
		conf.resultado = "ARTIGO_NAO_ENCONTRADO";
		conf.notas.push(`A faixa citada termina no art. ${ref.faixaAte}, que não consta de ${diploma.nome} na base (fonte de ${diploma.dataFonte}).`);
		return conf;
	}

	let unidade: Unidade | undefined;
	let semRecorte = false;
	if (ref.caminho) {
		if (artigo.plano) {
			semRecorte = true;
			conf.notas.push(`O artigo não tem recorte por subdivisão na base (${artigo.plano}); a conferência foi feita contra o artigo inteiro.`);
		} else {
			unidade = artigo.unidades?.get(ref.caminho);
			if (!unidade) {
				if (artigo.soltas > 0) {
					semRecorte = true;
					conf.notas.push("A subdivisão indicada não foi localizada, mas o artigo tem trechos sem rótulo reconhecível na base; a conferência foi feita contra o artigo inteiro.");
				} else {
					conf.resultado = "SUBDIVISAO_NAO_ENCONTRADA";
					conf.dispositivo = nomeDoDispositivo(artigo);
					conf.notas.push(`O art. ${artigo.rotulo} de ${diploma.nome} não tem ${nomeDoCaminho(ref.caminho)} na base (fonte de ${diploma.dataFonte}): ${subdivisoesIrmas(artigo, ref.caminho)}.`);
					return conf;
				}
			}
		}
	}
	conf.dispositivo = nomeDoDispositivo(artigo, unidade ? unidade.caminho : "");
	conf.oficial = linhasDaUnidade(artigo, unidade).join("\n");
	for (const aviso of artigo.avisos) conf.notas.push(aviso);

	const contexto = texto.slice(Math.max(0, ref.inicio - 160), Math.min(texto.length, ref.fim + 160));
	if (artigo.revogado || unidade?.tachada) {
		if (RE_RESSALVA.test(contexto)) conf.notas.push("O dispositivo está revogado na fonte; o texto já faz a ressalva.");
		else conf.alerta = `${conf.dispositivo} está revogado na fonte oficial e foi citado sem ressalva.`;
	}

	if (!ref.transcricao) {
		conf.resultado = semRecorte ? "SUBDIVISAO_NAO_CONFERIVEL" : "SEM_TRANSCRICAO";
		return conf;
	}
	const cotejo = cotejar(ref.transcricao.texto, artigo, unidade);
	if (cotejo.resultado === "DIVERGENTE" && !pareceTranscricao(ref.transcricao.texto, artigo)) {
		conf.resultado = semRecorte ? "SUBDIVISAO_NAO_CONFERIVEL" : "SEM_TRANSCRICAO";
		conf.notas.push("O trecho que acompanha a referência não se parece com o texto do dispositivo e não foi tratado como transcrição.");
		delete conf.transcricao;
		return conf;
	}
	conf.resultado = cotejo.resultado;
	if (cotejo.diferencas?.length) conf.diferencas = cotejo.diferencas;
	if (cotejo.nota) conf.notas.push(cotejo.nota);
	if (cotejo.resultado === "CONFERE_COM_REDACAO_ANTERIOR" && RE_RESSALVA.test(contexto)) {
		conf.notas.push("O texto ressalva que se trata de redação anterior.");
	}
	return conf;
}

const BLOQUEIAM: Resultado[] = ["DIVERGENTE", "ARTIGO_NAO_ENCONTRADO", "SUBDIVISAO_NAO_ENCONTRADA"];
const RESSALVAM: Resultado[] = ["CONFERE_COM_DIFERENCA_DE_FORMA", "CONFERE_EM_OUTRA_SUBDIVISAO", "SUBDIVISAO_NAO_CONFERIVEL", "DIPLOMA_FORA_DA_BASE", "DIPLOMA_NAO_IDENTIFICADO"];

/** Confere todas as referências a artigos de lei de um texto contra a base. */
export function verificarTexto(texto: string, base: Base, opcoes: OpcoesVerificacao = {}): Relatorio {
	const referencias = detectarReferencias(texto, base);
	const conferencias: Conferencia[] = [];
	let ultimo: Diploma | undefined;
	for (const ref of referencias) {
		const conf = conferirReferencia(ref, texto, base, opcoes, ultimo);
		conferencias.push(conf);
		if (ref.diploma) ultimo = ref.diploma;
		else if (ref.fora) ultimo = undefined;
	}
	const contagem: Record<string, number> = {};
	let bloqueia = false;
	let ressalva = false;
	for (const c of conferencias) {
		contagem[c.resultado] = (contagem[c.resultado] ?? 0) + 1;
		if (c.alerta) {
			contagem.ALERTA_DE_REVOGACAO = (contagem.ALERTA_DE_REVOGACAO ?? 0) + 1;
			bloqueia = true;
		}
		if (BLOQUEIAM.includes(c.resultado)) bloqueia = true;
		if (c.resultado === "CONFERE_COM_REDACAO_ANTERIOR") {
			if (c.notas.some((n) => n.startsWith("O texto ressalva"))) ressalva = true;
			else bloqueia = true;
		}
		if (RESSALVAM.includes(c.resultado) || c.notas.some((n) => /presumido|lido como|revogado na fonte|consenso/.test(n))) ressalva = true;
	}
	const veredito: Veredito = conferencias.length === 0 ? "SEM_REFERENCIAS" : bloqueia ? "NAO_VERIFICADO" : ressalva ? "VERIFICADO_COM_RESSALVAS" : "INTEGRALMENTE_VERIFICADO";
	return { veredito, versaoBase: base.versao, conferencias, contagem };
}
