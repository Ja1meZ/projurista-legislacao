import { App, Editor, MarkdownView, Modal, Notice, Setting, SuggestModal, TFile, normalizePath } from "obsidian";
import type ProjuristaLegislacaoPlugin from "../main";
import { Artigo, Diploma, baseLegislacao } from "../legislacao/base";
import { buscar } from "../legislacao/busca";
import { Conferencia, Relatorio, verificarTexto } from "../legislacao/comparador";
import { ROTULO_RESULTADO, TEXTO_VEREDITO, citacaoPronta, fichaDispositivo, textoLiteral } from "../legislacao/ferramentas";
import { gerarNotas } from "../legislacao/notas";
import { interpretarReferencia } from "../legislacao/referencia";
import { hierarquiaDoArtigo, linhaTachada, linhasDaUnidade, nomeDoDispositivo, semMarcaDeTachado } from "../legislacao/texto";

function maiuscula(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function editorAtivo(app: App): Editor | undefined {
	return app.workspace.activeEditor?.editor ?? app.workspace.getActiveViewOfType(MarkdownView)?.editor;
}

interface Sugestao {
	artigo: Artigo;
	caminho: string;
	trecho: string;
}

/** Localiza um dispositivo pela referência ("cpc 1015 pu") ou por palavras do texto e o insere no editor. */
export class ModalDispositivo extends SuggestModal<Sugestao> {
	constructor(app: App, private plugin: ProjuristaLegislacaoPlugin, private modo: "inserir" | "consultar") {
		super(app);
		this.limit = 40;
		this.setPlaceholder('Referência ("cpc 1015 pu", "art. 5º, LV, da CF") ou palavras do texto da lei');
		this.emptyStateText = "Digite a referência do dispositivo ou palavras do texto da lei.";
		this.setInstructions([
			{ command: "↑↓", purpose: "navegar" },
			{ command: "↵", purpose: modo === "inserir" ? "inserir na nota" : "abrir o dispositivo" },
			{ command: "esc", purpose: "fechar" },
		]);
	}

	getSuggestions(consulta: string): Sugestao[] {
		const q = consulta.trim();
		if (q.length < 2) return [];
		const base = baseLegislacao();
		const lida = interpretarReferencia(base, q);
		if (lida.diploma && lida.chave && !lida.erro) {
			const artigo = lida.diploma.obter(lida.chave);
			if (artigo) return this.doArtigo(artigo, lida.caminhos);
		}
		return buscar(base, q, { limite: 30 }).map((a) => ({ artigo: a.artigo, caminho: a.caminho, trecho: a.trecho }));
	}

	private doArtigo(artigo: Artigo, caminhos: string[]): Sugestao[] {
		const trecho = (caminho: string) => {
			const unidade = caminho ? artigo.unidades?.get(caminho) : undefined;
			return linhasDaUnidade(artigo, unidade).join(" ");
		};
		const pedidas = caminhos.filter((c) => artigo.unidades?.has(c));
		if (pedidas.length) return pedidas.map((c) => ({ artigo, caminho: c, trecho: trecho(c) }));
		const saida: Sugestao[] = [{ artigo, caminho: "", trecho: trecho("") }];
		if (artigo.listaUnidades.length > 1) {
			for (const u of artigo.listaUnidades) saida.push({ artigo, caminho: u.caminho, trecho: trecho(u.caminho) });
		}
		return saida;
	}

	renderSuggestion(item: Sugestao, el: HTMLElement): void {
		const titulo = el.createDiv({ cls: "projurista-legislacao-sugestao-titulo" });
		titulo.setText(maiuscula(nomeDoDispositivo(item.artigo, item.caminho)) + (item.caminho ? "" : " (artigo inteiro)"));
		if (item.artigo.revogado) titulo.createSpan({ text: " revogado", cls: "projurista-legislacao-selo alerta" });
		el.createDiv({ cls: "projurista-legislacao-sugestao-detalhe", text: `${item.artigo.diploma.nome} · ${hierarquiaDoArtigo(item.artigo) || item.artigo.diploma.lei}` });
		el.createDiv({ cls: "projurista-legislacao-sugestao-trecho", text: item.trecho.slice(0, 320) });
	}

	onChooseSuggestion(item: Sugestao): void {
		if (this.modo === "consultar") {
			new ModalFicha(this.app, this.plugin, item.artigo, item.caminho).open();
			return;
		}
		inserirDispositivo(this.app, this.plugin, item.artigo, item.caminho, this.plugin.configuracoes.formatoInsercao);
	}
}

/** Escreve o dispositivo no editor ativo; sem editor, copia para a área de transferência. */
export function inserirDispositivo(app: App, plugin: ProjuristaLegislacaoPlugin, artigo: Artigo, caminho: string, formato: "citacao" | "texto"): void {
	const opcoes = { anotacoes: plugin.configuracoes.manterAnotacoes };
	const texto = formato === "citacao" ? (citacaoPronta(artigo, caminho, opcoes) ?? textoLiteral(artigo, caminho, opcoes)) : textoLiteral(artigo, caminho, opcoes);
	if (artigo.revogado) new Notice("Atenção: este artigo está revogado na fonte oficial.", 8000);
	for (const aviso of artigo.avisos) new Notice(aviso, 10_000);
	const editor = editorAtivo(app);
	if (editor) {
		editor.replaceSelection(texto);
		return;
	}
	void navigator.clipboard.writeText(texto).then(() => new Notice("Nenhuma nota em edição: o texto foi copiado para a área de transferência."));
}

/** Ficha completa do dispositivo, com os botões de copiar e de inserir. */
export class ModalFicha extends Modal {
	constructor(app: App, private plugin: ProjuristaLegislacaoPlugin, private artigo: Artigo, private caminho: string) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("projurista-legislacao-modal");
		this.setTitle(maiuscula(nomeDoDispositivo(this.artigo, this.caminho)));
		contentEl.createDiv({ cls: "projurista-legislacao-ficha", text: fichaDispositivo(baseLegislacao(), this.artigo, this.caminho) });
		const opcoes = { anotacoes: this.plugin.configuracoes.manterAnotacoes };
		const copiar = (texto: string) => void navigator.clipboard.writeText(texto).then(() => new Notice("Copiado para a área de transferência."));
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Copiar citação").onClick(() => copiar(citacaoPronta(this.artigo, this.caminho, opcoes) ?? textoLiteral(this.artigo, this.caminho, opcoes))),
			)
			.addButton((b) => b.setButtonText("Copiar só o texto").onClick(() => copiar(textoLiteral(this.artigo, this.caminho, opcoes))))
			.addButton((b) =>
				b
					.setButtonText("Inserir na nota")
					.setCta()
					.onClick(() => {
						this.close();
						inserirDispositivo(this.app, this.plugin, this.artigo, this.caminho, this.plugin.configuracoes.formatoInsercao);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function classeDaConferencia(c: Conferencia): "ok" | "ressalva" | "falha" {
	if (c.alerta || c.resultado === "DIVERGENTE" || c.resultado === "ARTIGO_NAO_ENCONTRADO" || c.resultado === "SUBDIVISAO_NAO_ENCONTRADA") return "falha";
	if (c.resultado === "CONFERE_COM_REDACAO_ANTERIOR") return c.notas.some((n) => n.startsWith("O texto ressalva")) ? "ressalva" : "falha";
	if (c.resultado === "CONFERE_LITERAL" || c.resultado === "CONFERE_TRECHO" || c.resultado === "SEM_TRANSCRICAO") return c.notas.length ? "ressalva" : "ok";
	return "ressalva";
}

/** Relatório da verificação de citações da nota, com salto para a linha de cada referência. */
export class ModalVerificacao extends Modal {
	constructor(app: App, private relatorio: Relatorio, private editor: Editor | undefined, private primeiraLinha: number) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		const r = this.relatorio;
		contentEl.addClass("projurista-legislacao-modal");
		this.setTitle("Citações de legislação da nota");
		const classe = r.veredito === "INTEGRALMENTE_VERIFICADO" ? "ok" : r.veredito === "NAO_VERIFICADO" ? "falha" : "ressalva";
		contentEl.createDiv({ cls: `projurista-legislacao-veredito ${classe}`, text: TEXTO_VEREDITO[r.veredito] });
		if (r.conferencias.length === 0) return;
		const ordem = { falha: 0, ressalva: 1, ok: 2 };
		const itens = [...r.conferencias].sort((a, b) => ordem[classeDaConferencia(a)] - ordem[classeDaConferencia(b)] || a.linha - b.linha);
		const lista = contentEl.createDiv({ cls: "projurista-legislacao-conferencias" });
		for (const c of itens) {
			const item = lista.createDiv({ cls: `projurista-legislacao-conferencia ${classeDaConferencia(c)}` });
			item.createDiv({ cls: "linha", text: `Linha ${c.linha + this.primeiraLinha} · ${c.mencao}` });
			item.createDiv({ text: `${ROTULO_RESULTADO[c.resultado]}${c.dispositivo ? ` — ${c.dispositivo}` : ""}` });
			if (c.alerta) item.createDiv({ cls: "nota", text: `Alerta: ${c.alerta}` });
			for (const d of (c.diferencas ?? []).slice(0, 8)) {
				item.createDiv({ cls: "diferenca", text: `Citado “${d.citado || "(nada)"}” × oficial “${d.oficial || "(nada)"}”` });
			}
			const mostraOficial = c.oficial && (c.resultado === "DIVERGENTE" || c.resultado === "CONFERE_COM_REDACAO_ANTERIOR" || c.resultado === "CONFERE_COM_DIFERENCA_DE_FORMA");
			if (mostraOficial) item.createDiv({ cls: "oficial", text: `Texto oficial: “${(c.oficial ?? "").replace(/\n/g, " ")}”` });
			for (const nota of c.notas) item.createDiv({ cls: "nota", text: nota });
			item.addEventListener("click", () => {
				if (!this.editor) return;
				const linha = c.linha - 1 + this.primeiraLinha;
				this.editor.setCursor({ line: linha, ch: 0 });
				this.editor.scrollIntoView({ from: { line: linha, ch: 0 }, to: { line: linha, ch: 0 } }, true);
				this.close();
			});
		}
		new Setting(contentEl).setDesc("Conferência feita por código, contra a base embutida. Clique em um item para ir à linha.").addButton((b) => b.setButtonText("Fechar").setCta().onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Confere as citações de legislação da seleção ou da nota inteira. */
export function verificarNoEditor(app: App, editor: Editor): void {
	const selecao = editor.getSelection();
	const texto = selecao.trim() ? selecao : editor.getValue();
	const primeiraLinha = selecao.trim() ? editor.getCursor("from").line : 0;
	const relatorio = verificarTexto(texto, baseLegislacao());
	new ModalVerificacao(app, relatorio, editor, primeiraLinha).open();
}

/** Escolha dos diplomas a gravar como notas no cofre. */
export class ModalInstalar extends Modal {
	private escolhidos = new Set<string>();
	private sobrescrever = false;
	private pasta: string;

	constructor(app: App, private plugin: ProjuristaLegislacaoPlugin) {
		super(app);
		this.pasta = plugin.configuracoes.pastaInstalacao;
	}

	onOpen(): void {
		const { contentEl } = this;
		const base = baseLegislacao();
		contentEl.addClass("projurista-legislacao-modal");
		this.setTitle("Instalar diplomas no cofre");
		contentEl.createEl("p", {
			text: "As notas são geradas a partir da base embutida, com o texto literal entre os marcadores LITERAL e o hash de conferência. Servem para navegar e ligar por links; a citação e a verificação continuam saindo da base do plugin.",
		});
		new Setting(contentEl)
			.setName("Pasta de destino")
			.setDesc("Cada diploma ganha uma subpasta.")
			.addText((t) => t.setValue(this.pasta).onChange((v) => (this.pasta = v)));
		new Setting(contentEl)
			.setName("Substituir notas existentes")
			.setDesc("Desligado, as notas que já existem são preservadas.")
			.addToggle((t) => t.setValue(this.sobrescrever).onChange((v) => (this.sobrescrever = v)));
		const lista = contentEl.createDiv({ cls: "projurista-legislacao-lista-diplomas" });
		for (const d of base.diplomas) {
			new Setting(lista)
				.setName(`${d.sigla} — ${d.nome}`)
				.setDesc(`${d.lei} · ${d.artigos.length} artigos · ${d.notas.length} notas`)
				.addToggle((t) =>
					t.onChange((v) => {
						if (v) this.escolhidos.add(d.sigla);
						else this.escolhidos.delete(d.sigla);
					}),
				);
		}
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Instalar selecionados")
				.setCta()
				.onClick(async () => {
					const diplomas = base.diplomas.filter((d) => this.escolhidos.has(d.sigla));
					if (diplomas.length === 0) {
						new Notice("Selecione ao menos um diploma.");
						return;
					}
					this.close();
					await instalarDiplomas(this.app, this.plugin, diplomas, this.pasta, this.sobrescrever);
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

async function garantirPasta(app: App, caminho: string): Promise<void> {
	const partes = caminho.split("/");
	let atual = "";
	for (const parte of partes) {
		atual = atual ? `${atual}/${parte}` : parte;
		if (!app.vault.getAbstractFileByPath(atual)) await app.vault.createFolder(atual);
	}
}

export async function instalarDiplomas(app: App, plugin: ProjuristaLegislacaoPlugin, diplomas: Diploma[], pasta: string, sobrescrever: boolean): Promise<void> {
	const base = baseLegislacao();
	const raiz = normalizePath(pasta.trim() || "Legislação");
	plugin.configuracoes.pastaInstalacao = raiz;
	await plugin.salvarConfiguracoes();
	let criadas = 0;
	let substituidas = 0;
	let preservadas = 0;
	const recusados: string[] = [];
	const aviso = new Notice("Gravando notas de legislação…", 0);
	try {
		for (const diploma of diplomas) {
			const notas = gerarNotas(base, diploma);
			if (notas.some((n) => !n.integra)) {
				recusados.push(diploma.sigla);
				continue;
			}
			for (const nota of notas) {
				const caminho = normalizePath(`${raiz}/${nota.caminho}`);
				await garantirPasta(app, caminho.slice(0, caminho.lastIndexOf("/")));
				const existente = app.vault.getAbstractFileByPath(caminho);
				if (existente instanceof TFile) {
					if (!sobrescrever) {
						preservadas++;
						continue;
					}
					await app.vault.process(existente, () => nota.conteudo);
					substituidas++;
				} else {
					await app.vault.create(caminho, nota.conteudo);
					criadas++;
				}
			}
			aviso.setMessage(`Gravando notas de legislação… ${diploma.sigla}`);
		}
	} catch (erro) {
		plugin.registro.erro(`Falha ao gravar notas: ${erro instanceof Error ? erro.message : String(erro)}`);
		new Notice(`Não foi possível concluir a gravação: ${erro instanceof Error ? erro.message : String(erro)}`, 10_000);
	} finally {
		aviso.hide();
	}
	const partes = [`${criadas} nota(s) criada(s)`];
	if (substituidas) partes.push(`${substituidas} substituída(s)`);
	if (preservadas) partes.push(`${preservadas} já existente(s), preservada(s)`);
	if (recusados.length) partes.push(`recusado(s) por falha de integridade: ${recusados.join(", ")}`);
	plugin.registro.info(`Instalação em "${raiz}": ${partes.join("; ")}.`);
	new Notice(`Legislação em "${raiz}": ${partes.join("; ")}.`, 10_000);
}

/** Bloco de código "legis": cada linha é uma referência; o texto exibido vem sempre da base embutida. */
export function renderizarBlocoLegis(fonte: string, el: HTMLElement): void {
	const base = baseLegislacao();
	let ultimo: Diploma | undefined;
	for (const bruta of fonte.split("\n")) {
		const linha = bruta.trim();
		if (!linha) continue;
		const lida = interpretarReferencia(base, linha, ultimo);
		const artigo = lida.diploma && lida.chave ? lida.diploma.obter(lida.chave) : undefined;
		if (!artigo) {
			const erro = el.createDiv({ cls: "projurista-legislacao-bloco erro" });
			erro.createDiv({ cls: "cabecalho", text: linha });
			erro.createEl("p", { text: lida.fora ? `${lida.fora.rotulo}: ${lida.fora.motivo}` : (lida.erro ?? "Dispositivo não encontrado na base. A ausência na base não significa que ele não exista.") });
			continue;
		}
		ultimo = lida.diploma;
		for (const caminho of lida.caminhos.length ? lida.caminhos : [""]) {
			const unidade = caminho ? artigo.unidades?.get(caminho) : undefined;
			const bloco = el.createDiv({ cls: "projurista-legislacao-bloco" });
			const cabecalho = bloco.createDiv({ cls: "cabecalho" });
			if (caminho && !unidade) {
				bloco.addClass("erro");
				cabecalho.setText(linha);
				bloco.createEl("p", { text: artigo.plano ? `A base não tem recorte por subdivisão neste artigo (${artigo.plano}). Peça o artigo inteiro.` : "Subdivisão não encontrada neste artigo, na base." });
				continue;
			}
			cabecalho.createSpan({ text: maiuscula(nomeDoDispositivo(artigo, caminho)) });
			cabecalho.createSpan({ cls: "projurista-legislacao-selo", text: `texto literal · fonte de ${artigo.diploma.dataFonte}` });
			if (artigo.revogado || unidade?.tachada) cabecalho.createSpan({ cls: "projurista-legislacao-selo alerta", text: "revogado" });
			for (const aviso of artigo.avisos) bloco.createEl("p", { cls: "projurista-legislacao-sugestao-detalhe", text: aviso });
			const de = unidade ? unidade.inicio : 0;
			const ate = unidade ? unidade.fim : artigo.linhas.length;
			for (let i = de; i < ate; i++) {
				const texto = artigo.linhas[i];
				bloco.createEl("p", { text: semMarcaDeTachado(texto), cls: linhaTachada(texto) ? "tachado" : "" });
			}
		}
	}
}
