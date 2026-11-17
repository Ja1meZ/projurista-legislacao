import { FileSystemAdapter, Notice, Plugin, normalizePath } from "obsidian";
import { randomBytes } from "crypto";
import * as net from "net";
import * as path from "path";
import { CONFIGURACOES_PADRAO, Configuracoes, NOME_SERVIDOR } from "./configuracoes";
import { Registro } from "./registro";
import { Despachante } from "./mcp/despachante";
import { FERRAMENTAS_LEGISLACAO } from "./legislacao/ferramentas";
import { TransporteTcp, PREFIXO_TOKEN } from "./transports/tcp";
import {
	ParametrosConexao,
	caminhoConfigClaude,
	claudeDesktopInstalado,
	comandoClaudeCode,
	configuracaoCompleta,
	entradaServidor,
	estadoNoClaudeDesktop,
	gravarNoClaudeDesktop,
	plataformaAtual,
	removerDoClaudeDesktop,
} from "./claude/config-desktop";
import { PONTE_POWERSHELL } from "./claude/pontes";
import { montarMcpb, nomeArquivoMcpb, salvarMcpb } from "./claude/mcpb";
import { AbaConfiguracoes } from "./ui/aba-configuracoes";
import { ModalConfirmacao, ModalPassos, ModalRegistro } from "./ui/modais";
import { ModalDispositivo, ModalInstalar, renderizarBlocoLegis, verificarNoEditor } from "./ui/legislacao";

export interface EstadoServidor {
	ligado: boolean;
	portaTcp: number;
	conexoes: number;
}

export default class ProjuristaLegislacaoPlugin extends Plugin {
	configuracoes: Configuracoes = { ...CONFIGURACOES_PADRAO };
	registro = new Registro(200);
	private despachante!: Despachante;
	private tcp!: TransporteTcp;
	private itemBarraStatus: HTMLElement | null = null;
	private iniciando: Promise<void> | null = null;

	async onload(): Promise<void> {
		await this.carregarConfiguracoes();

		this.despachante = new Despachante({
			nomeServidor: NOME_SERVIDOR,
			versaoServidor: this.manifest.version,
			ferramentas: FERRAMENTAS_LEGISLACAO,
			contexto: () => ({ app: this.app, configuracoes: this.configuracoes, registro: this.registro }),
		});
		this.tcp = new TransporteTcp({ despachante: this.despachante, registro: this.registro, token: () => this.configuracoes.token });

		this.itemBarraStatus = this.addStatusBarItem();
		this.atualizarBarraStatus();
		this.addSettingTab(new AbaConfiguracoes(this.app, this));
		this.addRibbonIcon("scale", "Inserir dispositivo legal", () => new ModalDispositivo(this.app, this, "inserir").open());

		this.addCommand({ id: "inserir-dispositivo", name: "Inserir dispositivo legal", callback: () => new ModalDispositivo(this.app, this, "inserir").open() });
		this.addCommand({ id: "consultar-dispositivo", name: "Consultar dispositivo legal", callback: () => new ModalDispositivo(this.app, this, "consultar").open() });
		this.addCommand({ id: "verificar-nota", name: "Verificar citações de legislação da nota", editorCallback: (editor) => verificarNoEditor(this.app, editor) });
		this.addCommand({ id: "instalar-diplomas", name: "Instalar diplomas no cofre", callback: () => new ModalInstalar(this.app, this).open() });
		this.addCommand({ id: "iniciar-servidor", name: "Iniciar servidor MCP", callback: () => void this.iniciarServidor() });
		this.addCommand({ id: "parar-servidor", name: "Parar servidor MCP", callback: () => void this.pararServidor() });
		this.addCommand({ id: "conectar-claude-desktop", name: "Conectar ao Claude Desktop", callback: () => void this.conectarAoClaudeDesktop() });
		this.addCommand({ id: "copiar-comando-claude-code", name: "Copiar comando do Claude Code", callback: () => void this.copiarComandoClaudeCode() });
		this.addCommand({ id: "exportar-mcpb", name: "Exportar extensão do Claude Desktop (.mcpb)", callback: () => void this.exportarMcpb() });
		this.addCommand({ id: "registro-atividade", name: "Mostrar registro de atividade", callback: () => new ModalRegistro(this.app, this.registro).open() });

		this.registerMarkdownCodeBlockProcessor("legis", (fonte, el) => renderizarBlocoLegis(fonte, el));

		this.app.workspace.onLayoutReady(() => {
			void this.gravarPontePowerShell();
			if (this.configuracoes.iniciarComObsidian) void this.iniciarServidor();
		});
	}

	onunload(): void {
		void this.pararServidor(true);
	}

	// ---------------------------------------------------------------- configurações

	private async carregarConfiguracoes(): Promise<void> {
		const salvas = ((await this.loadData()) ?? {}) as Partial<Configuracoes>;
		this.configuracoes = { ...CONFIGURACOES_PADRAO, ...salvas };
		if (!this.configuracoes.token) {
			this.configuracoes.token = gerarToken();
			await this.salvarConfiguracoes();
		}
	}

	async salvarConfiguracoes(): Promise<void> {
		await this.saveData(this.configuracoes);
		this.atualizarBarraStatus();
	}

	async gerarNovoToken(): Promise<void> {
		this.configuracoes.token = gerarToken();
		await this.salvarConfiguracoes();
		this.registro.aviso("Token regenerado. As conexões existentes deixam de valer.");
		new Notice("Token novo gerado. Conecte de novo o Claude Desktop e os demais clientes.");
	}

	// ---------------------------------------------------------------- servidor

	estadoServidor(): EstadoServidor {
		return { ligado: this.tcp.ativo, portaTcp: this.tcp.portaAtual, conexoes: this.tcp.conexoesAtivas };
	}

	async iniciarServidor(): Promise<void> {
		if (this.iniciando) return this.iniciando;
		if (this.tcp.ativo) return;
		this.iniciando = (async () => {
			try {
				const portaTcp = await this.tcp.iniciar(this.configuracoes.portaTcp);
				if (portaTcp !== this.configuracoes.portaTcp) {
					this.registro.aviso(`Porta TCP ${this.configuracoes.portaTcp} ocupada; usando ${portaTcp}. Conecte de novo ao Claude.`);
					new Notice(`Projurista Legislação: a porta ${this.configuracoes.portaTcp} estava ocupada; o servidor usa a ${portaTcp}. Conecte de novo ao Claude.`, 10_000);
					this.configuracoes.portaTcp = portaTcp;
					await this.salvarConfiguracoes();
				}
				this.registro.info(`Servidor ligado: TCP ${portaTcp}.`);
			} catch (erro) {
				const mensagem = erro instanceof Error ? erro.message : String(erro);
				this.registro.erro(`Não foi possível iniciar o servidor: ${mensagem}`);
				new Notice(`Projurista Legislação: não foi possível iniciar o servidor. ${mensagem}`, 10_000);
				await this.tcp.parar();
			} finally {
				this.iniciando = null;
				this.atualizarBarraStatus();
			}
		})();
		return this.iniciando;
	}

	async pararServidor(silencioso = false): Promise<void> {
		const estavaLigado = this.tcp.ativo;
		await this.tcp.parar();
		if (estavaLigado && !silencioso) this.registro.info("Servidor desligado.");
		this.atualizarBarraStatus();
	}

	async reiniciarServidor(): Promise<void> {
		await this.pararServidor(true);
		await this.iniciarServidor();
	}

	private atualizarBarraStatus(): void {
		if (!this.itemBarraStatus) return;
		const estado = this.estadoServidor();
		this.itemBarraStatus.setText(estado.ligado ? `Leis ● ${estado.portaTcp}` : "Leis ○");
		this.itemBarraStatus.setAttr("aria-label", estado.ligado ? `Projurista Legislação: servidor MCP ligado na porta ${estado.portaTcp}` : "Projurista Legislação: servidor MCP desligado");
	}

	// ---------------------------------------------------------------- Claude

	private caminhoAbsolutoDoPlugin(): string | null {
		const adaptador = this.app.vault.adapter;
		if (!(adaptador instanceof FileSystemAdapter) || !this.manifest.dir) return null;
		return path.join(adaptador.getBasePath(), ...this.manifest.dir.split("/"));
	}

	private async gravarPontePowerShell(): Promise<void> {
		if (!this.manifest.dir) return;
		try {
			const caminho = normalizePath(`${this.manifest.dir}/ponte.ps1`);
			await this.app.vault.adapter.write(caminho, "﻿" + PONTE_POWERSHELL);
		} catch (erro) {
			this.registro.erro(`Não foi possível gravar ponte.ps1: ${erro instanceof Error ? erro.message : String(erro)}`);
		}
	}

	parametrosConexao(): ParametrosConexao {
		const base = this.caminhoAbsolutoDoPlugin() ?? "";
		return {
			nomeServidor: NOME_SERVIDOR,
			portaTcp: this.configuracoes.portaTcp,
			token: this.configuracoes.token,
			caminhoPontePowerShell: path.join(base, "ponte.ps1"),
		};
	}

	async conectarAoClaudeDesktop(): Promise<void> {
		const plataforma = plataformaAtual();
		const caminho = caminhoConfigClaude(plataforma);
		if (!caminho) {
			new Notice('Sistema operacional não suportado para a configuração automática. Use "Copiar JSON do Claude Desktop".');
			return;
		}
		await this.gravarPontePowerShell();
		const parametros = this.parametrosConexao();
		const instalado = claudeDesktopInstalado(plataforma);
		const entrada = entradaServidor(parametros, plataforma);
		const paragrafos = [
			`O plugin vai gravar a conexão "${parametros.nomeServidor}" no arquivo de configuração do Claude Desktop, fora do cofre:`,
			caminho,
			"Se o arquivo já existir, uma cópia de segurança será feita antes. Outras conexões já configuradas são preservadas.",
		];
		if (!instalado) {
			paragrafos.push("Atenção: a pasta do Claude Desktop não foi encontrada. Ele parece não estar instalado, ou nunca foi aberto. Você pode criar a pasta mesmo assim ou instalar o Claude Desktop antes.");
		}
		const confirmado = await ModalConfirmacao.perguntar(this.app, {
			titulo: "Conectar ao Claude Desktop",
			paragrafos,
			codigo: JSON.stringify({ [parametros.nomeServidor]: entrada }, null, 2),
			rotuloConfirmar: instalado ? "Gravar" : "Criar pasta e gravar",
		});
		if (!confirmado) return;

		try {
			const resultado = gravarNoClaudeDesktop(parametros, { criarPastaSeAusente: true }, plataforma);
			this.registro.info(`Conexão gravada em ${resultado.caminho}${resultado.copiaDeSeguranca ? ` (cópia em ${resultado.copiaDeSeguranca})` : ""}.`);
			if (!this.tcp.ativo) await this.iniciarServidor();
			const passos = [
				"Feche o Claude Desktop por completo: no macOS, menu Claude → Quit (⌘Q); no Windows, clique com o botão direito no ícone da bandeja e saia.",
				"Abra o Claude Desktop de novo.",
				`Em uma conversa, clique no botão de ferramentas (ou em “+” → Connectors) e confira se "${parametros.nomeServidor}" aparece.`,
				'Peça algo como: "Qual é o texto literal do art. 300 do CPC?".',
				"Mantenha o Obsidian aberto enquanto usa o Claude: o servidor roda dentro dele.",
			];
			if (resultado.arquivoEstavaCorrompido) {
				passos.unshift(`O arquivo anterior do Claude Desktop estava com erro de sintaxe e foi substituído. A cópia está em ${resultado.copiaDeSeguranca}.`);
			}
			new ModalPassos(this.app, {
				titulo: "Conexão gravada",
				introducao: resultado.copiaDeSeguranca ? `Cópia de segurança do arquivo anterior: ${resultado.copiaDeSeguranca}` : "O arquivo de configuração foi criado.",
				passos,
			}).open();
		} catch (erro) {
			const mensagem = erro instanceof Error ? erro.message : String(erro);
			this.registro.erro(`Falha ao gravar no Claude Desktop: ${mensagem}`);
			new Notice(`Não foi possível gravar a configuração: ${mensagem}`, 10_000);
		}
	}

	async desconectarDoClaudeDesktop(): Promise<void> {
		const confirmado = await ModalConfirmacao.perguntar(this.app, {
			titulo: "Desfazer conexão",
			paragrafos: [`Remover a conexão "${NOME_SERVIDOR}" do arquivo de configuração do Claude Desktop? Uma cópia de segurança será feita antes.`],
			rotuloConfirmar: "Remover",
			perigoso: true,
		});
		if (!confirmado) return;
		try {
			const removido = removerDoClaudeDesktop(NOME_SERVIDOR);
			new Notice(removido ? "Conexão removida. Reinicie o Claude Desktop." : "A conexão não estava configurada.");
			if (removido) this.registro.info(`Conexão "${NOME_SERVIDOR}" removida do Claude Desktop.`);
		} catch (erro) {
			new Notice(`Não foi possível alterar o arquivo: ${erro instanceof Error ? erro.message : String(erro)}`);
		}
	}

	async copiarConfiguracaoJson(): Promise<void> {
		await this.gravarPontePowerShell();
		const json = JSON.stringify(configuracaoCompleta(this.parametrosConexao()), null, 2);
		await navigator.clipboard.writeText(json);
		const caminho = caminhoConfigClaude() ?? "claude_desktop_config.json";
		new ModalPassos(this.app, {
			titulo: "Configuração copiada",
			introducao: "Cole o trecho abaixo no arquivo de configuração do Claude Desktop. Se já houver uma chave mcpServers, acrescente só a entrada interna.",
			passos: ["No Claude Desktop, abra Settings → Developer → Edit Config.", `O arquivo é ${caminho}.`, "Cole o trecho, salve e reinicie o Claude Desktop por completo."],
			codigo: json,
			textoParaCopiar: json,
			rotuloCopiar: "Copiar de novo",
		}).open();
	}

	async copiarComandoClaudeCode(): Promise<void> {
		await this.gravarPontePowerShell();
		const comando = comandoClaudeCode(this.parametrosConexao());
		await navigator.clipboard.writeText(comando);
		new ModalPassos(this.app, {
			titulo: "Comando copiado",
			introducao: "O comando registra o servidor para todos os projetos do Claude Code (escopo do usuário). O Obsidian precisa estar aberto quando o Claude Code for usado.",
			passos: ["Abra o terminal.", "Cole o comando e pressione Enter.", "No Claude Code, digite /mcp para conferir a conexão."],
			codigo: comando,
			textoParaCopiar: comando,
			rotuloCopiar: "Copiar de novo",
		}).open();
	}

	async exportarMcpb(): Promise<void> {
		try {
			const parametros = this.parametrosConexao();
			const pacote = montarMcpb({
				nomeServidor: parametros.nomeServidor,
				portaTcp: parametros.portaTcp,
				token: parametros.token,
				versao: this.manifest.version,
				ferramentas: this.despachante.ferramentasVisiveis(),
			});
			const destino = await salvarMcpb(pacote, nomeArquivoMcpb(parametros.nomeServidor));
			if (!destino) return;
			this.registro.info(`Extensão .mcpb salva em ${destino}.`);
			new ModalPassos(this.app, {
				titulo: "Extensão exportada",
				introducao: `Arquivo salvo em: ${destino}`,
				passos: [
					"No Claude Desktop, abra Settings → Extensions.",
					"Clique em Advanced settings e, na seção Extension Developer, em Install Extension…",
					"Escolha o arquivo .mcpb salvo e confirme a instalação.",
					"Mantenha o Obsidian aberto: a extensão é só uma ponte para o plugin.",
					"Se gerar um token novo ou mudar a porta, exporte e instale a extensão de novo.",
				],
			}).open();
		} catch (erro) {
			const mensagem = erro instanceof Error ? erro.message : String(erro);
			this.registro.erro(`Falha ao exportar .mcpb: ${mensagem}`);
			new Notice(`Não foi possível exportar a extensão: ${mensagem}`, 10_000);
		}
	}

	// ---------------------------------------------------------------- diagnóstico

	async testarConexao(): Promise<void> {
		if (!this.tcp.ativo) await this.iniciarServidor();
		const resultados: string[] = [await this.testarTcp()];
		const estado = estadoNoClaudeDesktop(this.parametrosConexao());
		resultados.push(
			estado === "atualizado"
				? "Claude Desktop: conexão gravada e atualizada."
				: estado === "desatualizado"
					? "Claude Desktop: a conexão gravada está desatualizada (porta ou token mudaram). Clique em Conectar ao Claude Desktop."
					: "Claude Desktop: conexão ainda não gravada.",
		);
		new ModalPassos(this.app, { titulo: "Resultado do teste", passos: resultados }).open();
	}

	private testarTcp(): Promise<string> {
		return new Promise((resolver) => {
			const socket = net.connect({ host: "127.0.0.1", port: this.tcp.portaAtual });
			let resposta = "";
			const temporizador = window.setTimeout(() => {
				socket.destroy();
				resolver("TCP: sem resposta em 5 segundos.");
			}, 5000);
			socket.setEncoding("utf8");
			socket.on("connect", () => {
				socket.write(`${PREFIXO_TOKEN}${this.configuracoes.token}\n`);
				socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
			});
			socket.on("data", (pedaco: string) => {
				resposta += pedaco;
				if (resposta.includes("\n")) {
					window.clearTimeout(temporizador);
					socket.end();
					resolver(resposta.includes('"result"') ? `TCP: ok na porta ${this.tcp.portaAtual}.` : `TCP: resposta inesperada: ${resposta.trim()}`);
				}
			});
			socket.on("error", (erro) => {
				window.clearTimeout(temporizador);
				resolver(`TCP: falha (${erro.message}).`);
			});
		});
	}
}

function gerarToken(): string {
	return randomBytes(24).toString("base64url");
}
