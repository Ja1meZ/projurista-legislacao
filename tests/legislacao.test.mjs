import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
	baseLegislacao,
	montarBase,
	interpretarReferencia,
	lerSubdivisoes,
	cotejar,
	verificarTexto,
	detectarReferencias,
	buscar,
	gerarNotas,
	semAnotacoes,
	citacaoPronta,
	fichaDispositivo,
	nomeDoDispositivo,
	linhasDaUnidade,
	obterDispositivo,
	verificarCitacoesLegislacao,
} from "../dist/nucleo-legislacao.mjs";

const base = baseLegislacao();
const bruta = JSON.parse(readFileSync(new URL("../dados/legislacao.json", import.meta.url), "utf8"));
const AVULSO = new URL("../dist/projurista-legislacao.mjs", import.meta.url).pathname;

function artigo(sigla, chave) {
	const a = base.porSigla(sigla)?.obter(chave);
	assert.ok(a, `${sigla} ${chave} deveria existir`);
	return a;
}
function verificar(texto, opcoes) {
	return verificarTexto(texto, base, opcoes);
}

// ---------------------------------------------------------------- integridade

test("base íntegra: nenhum artigo descartado e contagens iguais às do arquivo", () => {
	assert.equal(base.adulterados.length, 0);
	assert.equal(base.diplomas.length, bruta.diplomas.length);
	assert.equal(base.totalArtigos, bruta.diplomas.reduce((n, d) => n + d.artigos.length, 0));
	assert.ok(base.diplomas.length >= 60);
	assert.ok(base.totalArtigos >= 10000);
	for (const sigla of ["CF", "CC", "CPC", "CP", "CPP", "CTN", "CDC", "CLT", "ECA", "LIA", "LEP", "LMP", "LD"]) assert.ok(base.porSigla(sigla), sigla);
});

test("artigo adulterado é descartado na carga", () => {
	const copia = JSON.parse(JSON.stringify(bruta));
	const cpc = copia.diplomas.find((d) => d.sigla === "CPC");
	const alvo = cpc.artigos.find((a) => a.k === "300");
	alvo.l[0] = alvo.l[0].replace("probabilidade", "possibilidade");
	const adulterada = montarBase(copia);
	assert.deepEqual(adulterada.adulterados, ["CPC:300"]);
	assert.equal(adulterada.porSigla("CPC").obter("300"), undefined);
});

test("cada artigo confere literalmente consigo mesmo", () => {
	let n = 0;
	for (const d of base.diplomas) {
		for (const a of d.artigos) {
			if (a.revogado) continue;
			const texto = linhasDaUnidade(a, undefined, { anotacoes: true, tachadas: true, rubricas: true }).join(" ");
			const r = cotejar(texto, a, undefined).resultado;
			assert.equal(r, "CONFERE_LITERAL", `${d.sigla} ${a.chave}`);
			n++;
		}
	}
	assert.ok(n > 9000);
});

test("todo caminho de subdivisão aponta para a linha com o rótulo correspondente", () => {
	const esperado = (token) => {
		if (token === "caput") return /^(?:~~)?Art/;
		if (token === "pu") return /^(?:~~)?Par[áa]grafo\s+[úuÚ]nico/i;
		if (token.startsWith("§")) return new RegExp(`^(?:~~)?§\\s*${token.slice(1).split("-")[0]}(?!\\d)`);
		if (/^[a-z]$/.test(token)) return new RegExp(`^(?:~~)?${token}\\)`);
		if (/^\d+$/.test(token)) return new RegExp(`^(?:~~)?${token}\\s*[-–—.)]`);
		return /^(?:~~)?[IVXLCDMl]+/;
	};
	let n = 0;
	for (const d of base.diplomas) {
		for (const a of d.artigos) {
			for (const u of a.listaUnidades) {
				const token = u.caminho.split("/").pop();
				assert.match(a.linhas[u.inicio], esperado(token), `${d.sigla} ${a.chave} ${u.caminho}`);
				assert.ok(u.fim > u.inicio && u.fim <= a.linhas.length);
				n++;
			}
		}
	}
	assert.ok(n > 30000, `unidades: ${n}`);
});

test("as notas geradas para o cofre reproduzem o bloco literal de origem (hash da nota)", () => {
	let notas = 0;
	for (const d of base.diplomas) {
		for (const nota of gerarNotas(base, d)) {
			assert.ok(nota.integra, nota.caminho);
			notas++;
		}
	}
	assert.ok(notas >= 1893);
});

// ---------------------------------------------------------------- referências

test("gramática das subdivisões", () => {
	const ler = (s, modo = "estrito") => lerSubdivisoes(s, modo).caminhos;
	assert.deepEqual(ler(", § 1º, I, a,"), ["§1/I/a"]);
	assert.deepEqual(ler(", parágrafo único,"), ["pu"]);
	assert.deepEqual(ler(", XXXV e LV,"), ["XXXV", "LV"]);
	assert.deepEqual(ler(", §§ 2º e 11,"), ["§2", "§11"]);
	assert.deepEqual(ler(", caput e § 6º,"), ["caput", "§6"]);
	assert.deepEqual(ler(', I, "r", da'), ["I/r"]);
	assert.deepEqual(ler(", inciso III, alínea c,"), ["III/c"]);
	assert.deepEqual(ler(", CC"), []);
	assert.deepEqual(ler(" e a lei"), []);
	assert.deepEqual(ler(" pu", "livre"), ["pu"]);
	assert.deepEqual(ler(" i r", "livre"), ["I/r"]);
	assert.deepEqual(ler(" § 4 iii", "livre"), ["§4/III"]);
});

test("referência livre: diploma por sigla, nome ou número do ato", () => {
	const ref = (s) => {
		const r = interpretarReferencia(base, s);
		return r.erro ? `ERRO` : r.fora ? "FORA" : `${r.diploma.sigla}:${r.chave}#${r.caminhos.join("+")}`;
	};
	assert.equal(ref("art. 1.015, parágrafo único, do CPC"), "CPC:1015#pu");
	assert.equal(ref("cpc 1015 pu"), "CPC:1015#pu");
	assert.equal(ref("cf 5 lv"), "CF:5#LV");
	assert.equal(ref("art. 37, § 6º, da Constituição Federal"), "CF:37#§6");
	assert.equal(ref("art. 103-B, § 4º, III, da CF/88"), "CF:103-B#§4/III");
	assert.equal(ref("art. 100 do ADCT"), "CF:ADCT:100#");
	assert.equal(ref("Lei 9.099/95, art. 3º, I"), "LJE:3#I");
	assert.equal(ref("art. 12 da Lei n. 8.429/1992"), "LIA:12#");
	assert.equal(ref("art. 1º do Decreto-Lei 3.365/41"), "LDes:1#");
	assert.equal(ref("art. 33, § 4º, da Lei de Drogas"), "LD:33#§4");
	assert.equal(ref("art. 20 do CPC/73"), "FORA");
	assert.equal(ref("art. 3º da Lei 8.666/93"), "FORA");
	assert.equal(ref("art. 10 da Lei 99.999/2020"), "FORA");
	assert.equal(ref("art. 5"), "ERRO");
});

// ---------------------------------------------------------------- casos de ouro

test("CPC 1.015, parágrafo único: citação pronta literal", () => {
	const a = artigo("CPC", "1015");
	assert.equal(
		citacaoPronta(a, "pu"),
		"Art. 1.015, parágrafo único, do CPC: “Parágrafo único. Também caberá agravo de instrumento contra decisões interlocutórias proferidas na fase de liquidação de sentença ou de cumprimento de sentença, no processo de execução e no processo de inventário.”",
	);
	assert.equal(a.unidades.get("XIII").inicio, 13);
	assert.equal(a.unidades.get("caput").fim, 14);
});

test('CF 102, I, "r" e CF 103-B, § 4º, III: recorte por parágrafo e inciso', () => {
	const a = artigo("CF", "102");
	assert.match(citacaoPronta(a, "I/r"), /^Art\. 102, I, "r", da CF: “r\) as ações contra o Conselho Nacional de Justiça e contra o Conselho Nacional do Ministério Público;”$/);
	const b = artigo("CF", "103-B");
	assert.match(linhasDaUnidade(b, b.unidades.get("§4/III")).join(""), /^III - receber e conhecer das reclamações/);
	assert.match(linhasDaUnidade(b, b.unidades.get("III")).join(""), /^III - um Ministro do Tribunal Superior do Trabalho/);
	// incisos sem hífen na fonte ("I receber as reclamações...")
	assert.ok(b.unidades.has("§5/I") && b.unidades.has("§5/III"));
});

test("anotações de alteração saem da citação, e só elas", () => {
	assert.equal(semAnotacoes("idade. (Redação dada pela Emenda Constitucional nº 122, de 2022)"), "idade.");
	assert.equal(semAnotacoes("na forma estabelecida em lei. (Incluído pela Emenda Constitucional nº 45, de 2004) (Vide Lei nº 11.417, de 2006)."), "na forma estabelecida em lei.");
	assert.equal(semAnotacoes("IX - contra menor de 14 (quatorze) anos: (Incluído pela Lei nº 14.344, de 2022) Vigência"), "IX - contra menor de 14 (quatorze) anos:");
	assert.equal(semAnotacoes("XII - (VETADO);"), "XII - (VETADO);");
	assert.equal(semAnotacoes("§ 2º (Revogado). (Redação dada pela Lei nº 13.097, de 2015)"), "§ 2º (Revogado).");
	assert.equal(semAnotacoes("VI - (Revogado pela Lei nº 14.994, de 2024)"), "VI - (Revogado pela Lei nº 14.994, de 2024)");
	assert.equal(semAnotacoes("no prazo de 5 (cinco) dias"), "no prazo de 5 (cinco) dias");
});

test("CP 121: rubricas marginais não entram no recorte nem na citação", () => {
	const a = artigo("CP", "121");
	const caput = linhasDaUnidade(a, a.unidades.get("caput"));
	assert.deepEqual(caput, ["Art. 121. Matar alguem:", "Pena - reclusão, de seis a vinte anos."]);
	assert.match(linhasDaUnidade(a, a.unidades.get("§1")).join(" "), /^§ 1º Se o agente comete o crime impelido/);
	assert.ok(a.unidades.get("§2/V").seguidaDeTextoSemRotulo);
});

test("artigo com texto de outro diploma citado fica sem recorte (plano)", () => {
	const a = artigo("CPC", "1061");
	assert.ok(a.plano);
	assert.equal(a.unidades, undefined);
	const ficha = fichaDispositivo(base, a, "§3");
	assert.match(ficha, /não tem recorte confiável/);
	assert.match(ficha, /Art\. 1\.061\./);
});

test("revogados: ADCT 112 tachado e faixa condensada do CTN", () => {
	assert.ok(artigo("CF", "ADCT:112").revogado);
	assert.equal(citacaoPronta(artigo("CF", "ADCT:112"), ""), undefined);
	assert.equal(artigo("CTN", "55").chave, "52");
	assert.equal(nomeDoDispositivo(artigo("CF", "ADCT:100")), "art. 100 do ADCT");
});

test("ressalvas de falta de consenso acompanham o artigo", () => {
	assert.match(artigo("D6514", "62").avisos[0], /consenso/);
	assert.match(artigo("LConc", "27").avisos[0], /consenso/);
	assert.match(fichaDispositivo(base, artigo("D6514", "62"), ""), /^AVISO: As três vias/m);
});

// ---------------------------------------------------------------- verificador

test("transcrição literal, com ou sem rótulo, confere", () => {
	const r = verificar('Nos termos do art. 300 do CPC, "a tutela de urgência será concedida quando houver elementos que evidenciem a probabilidade do direito e o perigo de dano ou o risco ao resultado útil do processo".');
	assert.equal(r.veredito, "INTEGRALMENTE_VERIFICADO");
	assert.equal(r.conferencias[0].resultado, "CONFERE_LITERAL");
	const r2 = verificar('O art. 37, § 6º, da CF/88: "§ 6º As pessoas jurídicas de direito público e as de direito privado prestadoras de serviços públicos responderão pelos danos que seus agentes, nessa qualidade, causarem a terceiros, assegurado o direito de regresso contra o responsável nos casos de dolo ou culpa."');
	assert.equal(r2.conferencias[0].resultado, "CONFERE_LITERAL");
});

test("palavra trocada é divergência, com a diferença apontada", () => {
	const r = verificar('Diz o art. 300 do CPC: "A tutela de urgência será concedida quando houver elementos que evidenciem a possibilidade do direito e o perigo de dano ou o risco ao resultado útil do processo."');
	assert.equal(r.veredito, "NAO_VERIFICADO");
	const c = r.conferencias[0];
	assert.equal(c.resultado, "DIVERGENTE");
	assert.ok(c.diferencas.some((d) => d.citado === "possibilidade" && d.oficial === "probabilidade"));
});

test("trecho com reticências confere; diferença só de forma é ressalva", () => {
	const r = verificar('Conforme o art. 300 do CPC, "a tutela de urgência será concedida quando houver elementos que evidenciem a probabilidade do direito (...) ou o risco ao resultado útil do processo".');
	assert.equal(r.conferencias[0].resultado, "CONFERE_TRECHO");
	const r2 = verificar('Conforme o art. 300 do CPC, "A tutela de urgencia sera concedida quando houver elementos que evidenciem a probabilidade do direito e o perigo de dano, ou o risco ao resultado util do processo".');
	assert.equal(r2.conferencias[0].resultado, "CONFERE_COM_DIFERENCA_DE_FORMA");
	assert.equal(r2.veredito, "VERIFICADO_COM_RESSALVAS");
});

test("redação anterior citada como vigente é apontada", () => {
	const r = verificar('O art. 101 da Constituição Federal diz que o Supremo "compõe-se de onze Ministros, escolhidos dentre cidadãos com mais de trinta e cinco e menos de sessenta e cinco anos de idade, de notável saber jurídico e reputação ilibada".');
	assert.equal(r.conferencias[0].resultado, "CONFERE_COM_REDACAO_ANTERIOR");
	assert.equal(r.veredito, "NAO_VERIFICADO");
});

test("artigo e subdivisão inexistentes; texto em outra subdivisão", () => {
	const r = verificar("Aplicam-se o art. 1.099 do CPC e o art. 932, IX, do CPC.");
	assert.deepEqual(r.conferencias.map((c) => c.resultado), ["ARTIGO_NAO_ENCONTRADO", "SUBDIVISAO_NAO_ENCONTRADA"]);
	assert.equal(r.veredito, "NAO_VERIFICADO");
	const r2 = verificar('Segundo o art. 1.015, I, do CPC, "também caberá agravo de instrumento contra decisões interlocutórias proferidas na fase de liquidação de sentença".');
	assert.equal(r2.conferencias[0].resultado, "CONFERE_EM_OUTRA_SUBDIVISAO");
	assert.match(r2.conferencias[0].notas.join(" "), /parágrafo único/);
});

test("diploma fora da base, mesmo diploma, diploma anteposto e listas", () => {
	const r = verificar("Incide o art. 20, § 4º, do CPC/73 e o art. 3º da Lei Estadual n. 11.404/96.");
	assert.deepEqual(r.conferencias.map((c) => c.resultado), ["DIPLOMA_FORA_DA_BASE", "DIPLOMA_FORA_DA_BASE"]);
	assert.equal(r.veredito, "VERIFICADO_COM_RESSALVAS");
	const r2 = verificar("O art. 85, § 2º, do CPC e o art. 98, § 3º, do mesmo diploma, além dos arts. 5º, XXXV e LV, e 93, IX, da Constituição Federal.");
	assert.deepEqual(r2.conferencias.map((c) => c.dispositivo), ["art. 85, § 2º, do CPC", "art. 98, § 3º, do CPC", "art. 5º, XXXV, da CF", "art. 5º, LV, da CF", "art. 93, IX, da CF"]);
	const r3 = verificar("O Código Civil, em seu art. 421, e o CPC, arts. 98 a 102, tratam do tema. (CDC, art. 6º, VIII)");
	assert.deepEqual(r3.conferencias.map((c) => c.diploma?.sigla), ["CC", "CPC", "CDC"]);
	assert.equal(r3.conferencias[2].dispositivo, "art. 6º, VIII, do CDC");
});

test("referência sem diploma: identificada pelo texto ou deixada sem conferência", () => {
	const r = verificar("Art. 1.022. Cabem embargos de declaração contra qualquer decisão judicial para:");
	assert.equal(r.conferencias[0].diploma.sigla, "CPC");
	assert.ok(r.conferencias[0].resultado.startsWith("CONFERE"));
	const r2 = verificar("Observado o art. 7º, o pedido é improcedente.");
	assert.equal(r2.conferencias[0].resultado, "DIPLOMA_NAO_IDENTIFICADO");
	const r3 = verificarTexto("Observado o art. 7º, o pedido é improcedente.", base, { diplomaPadrao: base.porSigla("CPC") });
	assert.equal(r3.conferencias[0].diploma.sigla, "CPC");
});

test("dispositivo revogado citado sem ressalva gera alerta; com ressalva, não", () => {
	const r = verificar("Aplica-se o art. 112 do ADCT ao caso.");
	assert.ok(r.conferencias[0].alerta);
	assert.equal(r.veredito, "NAO_VERIFICADO");
	const r2 = verificar("O art. 112 do ADCT, hoje revogado, previa o Novo Regime Fiscal.");
	assert.equal(r2.conferencias[0].alerta, undefined);
});

test("referências dentro de transcrição de lei não são tratadas como citação do autor", () => {
	const texto = 'O art. 1.019 do CPC dispõe: "Art. 1.019. Recebido o agravo de instrumento no tribunal e distribuído imediatamente, se não for o caso de aplicação do art. 932, incisos III e IV, o relator, no prazo de 5 (cinco) dias:"';
	const refs = detectarReferencias(texto, base);
	assert.equal(refs.length, 1);
	assert.equal(verificar(texto).conferencias[0].resultado, "CONFERE_LITERAL");
});

test("listas de artigos com parágrafos: o número depois de \"e\" já é outro artigo", () => {
	const r = verificar("Violados os arts. 1º, §§ 2º e 4º, 10, caput, IX e X, 17, §§ 10-C e 10-E, e 21, II, da Lei n. 8.429/1992.");
	assert.deepEqual(
		r.conferencias.map((c) => c.dispositivo),
		["art. 1º, § 2º, da Lei n. 8.429/1992", "art. 1º, § 4º, da Lei n. 8.429/1992", "art. 10, IX, da Lei n. 8.429/1992", "art. 10, X, da Lei n. 8.429/1992", "art. 17, § 10-C, da Lei n. 8.429/1992", "art. 17, § 10-E, da Lei n. 8.429/1992", "art. 21, II, da Lei n. 8.429/1992"],
	);
	assert.equal(r.veredito, "INTEGRALMENTE_VERIFICADO");
});

test("diploma homônimo não federal ou especial fica fora da base", () => {
	const r = verificar("Conforme o art. 131, § 7º, III, da Constituição do Estado de Pernambuco, o art. 9º do Código Penal Militar e o art. 5º da Constituição Estadual.");
	assert.deepEqual(r.conferencias.map((c) => c.resultado), ["DIPLOMA_FORA_DA_BASE", "DIPLOMA_FORA_DA_BASE", "DIPLOMA_FORA_DA_BASE"]);
});

test("diploma presumido só confirma: nunca acusa artigo ou subdivisão ausente", () => {
	const r = verificar("O art. 85 do CPC trata dos honorários. Já o art. 32, parágrafo único, V e VI, cuida de outro tema, e o art. 98, § 3º, suspende a exigibilidade.");
	assert.deepEqual(r.conferencias.map((c) => c.resultado), ["SEM_TRANSCRICAO", "DIPLOMA_NAO_IDENTIFICADO", "DIPLOMA_NAO_IDENTIFICADO", "SEM_TRANSCRICAO"]);
	assert.match(r.conferencias[3].notas.join(" "), /presumido Código de Processo Civil/);
	assert.notEqual(r.veredito, "NAO_VERIFICADO");
});

test("paráfrase entre aspas não é tratada como transcrição divergente", () => {
	const r = verificar('O art. 139, IV, do Código de Processo Civil autoriza "as medidas necessárias à satisfação do exequente".');
	assert.equal(r.conferencias[0].resultado, "SEM_TRANSCRICAO");
	assert.notEqual(r.veredito, "NAO_VERIFICADO");
});

test("transcrição do caput seguida do inciso indicado confere", () => {
	const r = verificar('Dispõe o art. 373, I, do Código de Processo Civil: "O ônus da prova incumbe: I - ao autor, quanto ao fato constitutivo de seu direito".');
	assert.ok(["CONFERE_LITERAL", "CONFERE_TRECHO"].includes(r.conferencias[0].resultado));
});

test("texto sem referências", () => {
	assert.equal(verificar("O recurso não merece provimento.").veredito, "SEM_REFERENCIAS");
});

// ---------------------------------------------------------------- busca e ferramentas

test("busca textual: assunto da divisão e caput pesam; ignora acentos", () => {
	const a = buscar(base, "tutela de urgencia requisitos", { limite: 3 });
	assert.equal(`${a[0].artigo.diploma.sigla}:${a[0].artigo.chave}`, "CPC:300");
	const b = buscar(base, "honorários recursais majoração", { limite: 3 });
	assert.equal(`${b[0].artigo.diploma.sigla}:${b[0].artigo.chave}#${b[0].caminho}`, "CPC:85#§11");
	const c = buscar(base, "agravo de instrumento", { diploma: base.porSigla("CPC"), limite: 5 });
	assert.ok(c.every((x) => x.artigo.diploma.sigla === "CPC"));
	assert.deepEqual(buscar(base, "xyzzyqwert"), []);
});

test("ferramentas: obter por referência e por campos; ausente da base não é inventado", async () => {
	const ctx = { configuracoes: {}, registro: { info() {}, aviso() {}, erro() {} } };
	const t1 = (await obterDispositivo.executar({ referencia: "art. 85, § 11, do CPC" }, ctx)).content[0].text;
	assert.match(t1, /Citação pronta \(copie sem alterar/);
	assert.match(t1, /Art\. 85, § 11, do CPC: “§ 11\. O tribunal, ao julgar recurso, majorará os honorários/);
	const t2 = (await obterDispositivo.executar({ diploma: "Constituição Federal", artigo: "5", dispositivo: "LV" }, ctx)).content[0].text;
	assert.match(t2, /Art\. 5º, LV, da CF: “LV - aos litigantes/);
	const t3 = (await obterDispositivo.executar({ referencia: "art. 1.099 do CPC" }, ctx)).content[0].text;
	assert.match(t3, /^NÃO ENCONTRADO NA BASE/);
	const t4 = (await obterDispositivo.executar({ referencia: "art. 3º da Lei 8.666/93" }, ctx)).content[0].text;
	assert.match(t4, /^NÃO ENCONTRADO NA BASE: Lei 8\.666\/93\. Diploma revogado/);
	const t5 = (await obterDispositivo.executar({ referencia: "art. 932, IX, do CPC" }, ctx)).content[0].text;
	assert.match(t5, /^NÃO ENCONTRADO NA BASE: o art\. 932/);
	const v = JSON.parse((await verificarCitacoesLegislacao.executar({ texto: "Art. 1.099 do CPC.", formato: "json" }, ctx)).content[0].text);
	assert.equal(v.veredito, "NAO_VERIFICADO");
	assert.equal(v.referencias[0].resultado, "ARTIGO_NAO_ENCONTRADO");
});

// ---------------------------------------------------------------- servidor avulso

test("servidor avulso: protocolo MCP por stdio e linha de comando", () => {
	const entrada = [
		{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "teste" } } },
		{ jsonrpc: "2.0", id: 2, method: "tools/list" },
		{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "obter_dispositivo", arguments: { referencia: "CPC 1015 pu" } } },
	]
		.map((m) => JSON.stringify(m))
		.join("\n");
	const p = spawnSync("node", [AVULSO], { input: entrada + "\n", encoding: "utf8" });
	const respostas = p.stdout.trim().split("\n").map((l) => JSON.parse(l));
	assert.equal(respostas[0].result.serverInfo.name, "projurista-legislacao");
	assert.match(respostas[0].result.instructions, /nunca transcreva dispositivo de lei de memória/);
	assert.deepEqual(respostas[1].result.tools.map((t) => t.name), ["obter_dispositivo", "buscar_legislacao", "listar_diplomas", "verificar_citacoes_legislacao"]);
	assert.match(respostas[2].result.content[0].text, /Art\. 1\.015, parágrafo único, do CPC: “Parágrafo único\./);

	const obter = spawnSync("node", [AVULSO, "obter", "CPC", "300"], { encoding: "utf8" });
	assert.equal(obter.status, 0);
	assert.match(obter.stdout, /Art\. 300\. A tutela de urgência será concedida/);
	const ausente = spawnSync("node", [AVULSO, "obter", "art. 1.099 do CPC"], { encoding: "utf8" });
	assert.equal(ausente.status, 1);
});
