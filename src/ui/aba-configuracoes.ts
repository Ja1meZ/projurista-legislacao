import { App, Notice, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type ProjuristaLegislacaoPlugin from "../main";
import { CONFIGURACOES_PADRAO, Configuracoes } from "../configuracoes";
import { baseLegislacao, resumoCobertura } from "../legislacao/base";
import { ModalDispositivo, ModalInstalar } from "./legislacao";
import { ModalRegistro } from "./modais";

/**
 * Aba de configurações na API declarativa do Obsidian (1.13+): as opções ficam
 * pesquisáveis na busca de configurações. Os valores vêm de plugin.configuracoes.
 */
export class AbaConfiguracoes extends PluginSettingTab {
	constructor(app: App, private plugin: ProjuristaLegislacaoPlugin) {
		super(app, plugin);
	}

	getControlValue(chave: string): unknown {
		return (this.plugin.configuracoes as unknown as Record<string, unknown>)[chave];
	}

	async setControlValue(chave: string, valor: unknown): Promise<void> {
		const c = this.plugin.configuracoes;
		switch (chave as keyof Configuracoes) {
			case "iniciarComObsidian":
				c.iniciarComObsidian = Boolean(valor);
				break;
			case "manterAnotacoes":
				c.manterAnotacoes = Boolean(valor);
				break;
			case "formatoInsercao":
				c.formatoInsercao = valor === "texto" ? "texto" : "citacao";
				break;
			case "pastaInstalacao":
				c.pastaInstalacao = typeof valor === "string" ? valor : "";
				break;
			case "portaTcp":
			case "limiteCaracteres": {
				const numero = Number(valor);
				if (!Number.isInteger(numero)) return;
				c[chave as "portaTcp" | "limiteCaracteres"] = numero;
				break;
			}
			default:
				return;
		}
		await this.plugin.salvarConfiguracoes();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const estado = this.plugin.estadoServidor();
		const base = baseLegislacao();
		const detalhes: string[] = [];
		if (estado.ligado) {
			detalhes.push(`TCP 127.0.0.1:${estado.portaTcp}`);
			detalhes.push(`${estado.conexoes} ${estado.conexoes === 1 ? "sessão ativa" : "sessões ativas"}`);
		}
		const descricaoStatus = [estado.ligado ? "Servidor ligado." : "Servidor desligado: ligue-o para que o Claude possa consultar a legislação.", detalhes.length ? detalhes.join(" · ") + "." : ""].filter((p) => p).join(" ");
		const validarPorta = (valor: number): string | void => {
			if (!Number.isInteger(valor) || valor < 1024 || valor > 65535) return "Informe uma porta entre 1024 e 65535.";
		};
		const integridade = base.adulterados.length ? ` Atenção: ${base.adulterados.length} artigo(s) descartado(s) por falha de integridade.` : " Todos os artigos conferem com o hash de origem.";

		return [
			{
				name: "Base de legislação",
				desc: `Versão ${base.versao}: ${resumoCobertura(base)}, em texto literal do Portal da Legislação (Planalto).${integridade} A base é uma fotografia na data da fonte de cada diploma.`,
				searchable: false,
				render: (setting: Setting) => {
					setting.addButton((b) => b.setButtonText("Consultar dispositivo").setCta().onClick(() => new ModalDispositivo(this.app, this.plugin, "consultar").open()));
				},
			},
			{
				type: "group",
				heading: "Citação nas notas",
				items: [
					{
						name: "O que inserir",
						desc: 'O comando "Inserir dispositivo legal" escreve a citação pronta (identificação e texto entre aspas) ou só o texto literal.',
						aliases: ["citação", "inserir", "formato"],
						control: { type: "dropdown", key: "formatoInsercao", defaultValue: CONFIGURACOES_PADRAO.formatoInsercao, options: { citacao: "Citação pronta", texto: "Só o texto literal" } },
					},
					{
						name: "Manter anotações de alteração",
						desc: 'Ligado, o texto inserido conserva as anotações do Planalto, como "(Redação dada pela Lei nº ...)" e "(Incluído pela ...)". Desligado, elas são retiradas por regra fixa; o texto da lei não muda.',
						aliases: ["redação dada", "incluído", "anotações"],
						control: { type: "toggle", key: "manterAnotacoes", defaultValue: CONFIGURACOES_PADRAO.manterAnotacoes },
					},
					{
						name: "Diplomas no cofre",
						desc: "Opcional: grava diplomas escolhidos como notas, com o texto literal e o hash de conferência, para navegar e ligar por links.",
						aliases: ["instalar", "notas", "diploma"],
						render: (setting: Setting) => {
							setting.addButton((b) => b.setButtonText("Instalar diplomas").onClick(() => new ModalInstalar(this.app, this.plugin).open()));
						},
					},
					{
						name: "Pasta dos diplomas",
						desc: "Pasta do cofre em que os diplomas instalados são gravados.",
						control: { type: "text", key: "pastaInstalacao", placeholder: CONFIGURACOES_PADRAO.pastaInstalacao },
					},
				],
			},
			{
				name: "Servidor MCP",
				desc: descricaoStatus,
				searchable: false,
				render: (setting: Setting) => {
					setting.settingEl.addClass("projurista-legislacao-status");
					if (estado.ligado) setting.settingEl.addClass("ligado");
					setting.addButton((b) =>
						b.setButtonText(estado.ligado ? "Parar" : "Iniciar").onClick(async () => {
							if (estado.ligado) await this.plugin.pararServidor();
							else await this.plugin.iniciarServidor();
							this.update();
						}),
					);
					setting.addButton((b) => b.setButtonText("Registro de atividade").onClick(() => new ModalRegistro(this.app, this.plugin.registro).open()));
				},
			},
			{
				type: "group",
				heading: "Conectar ao Claude",
				items: [
					{
						name: "Claude Desktop",
						desc: "Grava a conexão no arquivo de configuração do Claude Desktop, com cópia de segurança. Depois, feche e abra o Claude Desktop.",
						aliases: ["conectar", "claude_desktop_config"],
						render: (setting: Setting) => {
							setting.addButton((b) => b.setButtonText("Conectar ao Claude Desktop").setCta().onClick(() => this.plugin.conectarAoClaudeDesktop()));
							setting.addButton((b) => b.setButtonText("Desfazer").onClick(() => this.plugin.desconectarDoClaudeDesktop()));
						},
					},
					{
						name: "Extensão do Claude Desktop (.mcpb)",
						desc: "Alternativa à gravação automática: gera um pacote para instalar em Settings → Extensions → Advanced settings → Install Extension…",
						aliases: ["mcpb", "extensão"],
						render: (setting: Setting) => {
							setting.addButton((b) => b.setButtonText("Exportar .mcpb").onClick(() => this.plugin.exportarMcpb()));
						},
					},
					{
						name: "Claude Code e outros clientes",
						desc: "Copia o comando do Claude Code ou a configuração JSON para colar à mão.",
						aliases: ["claude code", "json", "cursor"],
						render: (setting: Setting) => {
							setting.addButton((b) => b.setButtonText("Copiar comando do Claude Code").onClick(() => this.plugin.copiarComandoClaudeCode()));
							setting.addButton((b) => b.setButtonText("Copiar JSON do Claude Desktop").onClick(() => this.plugin.copiarConfiguracaoJson()));
						},
					},
					{
						name: "Testar conexão",
						desc: "O plugin abre uma conexão contra o próprio servidor e informa o resultado.",
						render: (setting: Setting) => {
							setting.addButton((b) => b.setButtonText("Testar").onClick(() => this.plugin.testarConexao()));
						},
					},
				],
			},
			{
				type: "group",
				heading: "Servidor",
				items: [
					{
						name: "Iniciar com o Obsidian",
						desc: "Sobe o servidor automaticamente quando o cofre abre.",
						control: { type: "toggle", key: "iniciarComObsidian", defaultValue: CONFIGURACOES_PADRAO.iniciarComObsidian },
					},
					{
						name: "Porta TCP",
						desc: "Usada pela ponte do Claude. Se mudar, conecte de novo.",
						control: { type: "number", key: "portaTcp", defaultValue: CONFIGURACOES_PADRAO.portaTcp, min: 1024, max: 65535, step: 1, validate: validarPorta },
					},
					{
						name: "Token",
						desc: "Senha compartilhada exigida em toda conexão. Ao gerar um token novo, conecte de novo o Claude Desktop e os demais clientes.",
						aliases: ["senha", "chave"],
						render: (setting: Setting) => {
							setting.settingEl.addClass("projurista-legislacao-token");
							setting.addText((t) => {
								t.setValue(this.plugin.configuracoes.token);
								t.inputEl.readOnly = true;
							});
							setting.addButton((b) =>
								b.setButtonText("Copiar").onClick(() => {
									void navigator.clipboard.writeText(this.plugin.configuracoes.token).then(() => new Notice("Token copiado."));
								}),
							);
							setting.addButton((b) =>
								b.setButtonText("Gerar novo").setClass("mod-warning").onClick(async () => {
									await this.plugin.gerarNovoToken();
									this.update();
								}),
							);
						},
					},
					{
						name: "Limite de caracteres por resposta",
						desc: "Protege o Claude de respostas enormes. Padrão: 200.000.",
						control: { type: "number", key: "limiteCaracteres", defaultValue: CONFIGURACOES_PADRAO.limiteCaracteres, min: 1000, step: 1000 },
					},
				],
			},
		];
	}
}
