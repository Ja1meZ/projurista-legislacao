# Projurista Legislacao

**Projurista Legislação** é um plugin para o Obsidian que traz embutida a legislação brasileira em **texto literal** e permite consultar, citar e conferir dispositivos de lei de forma determinística: dentro das notas e, pelo servidor MCP local, no Claude.

É o irmão do [Projurista MCP](https://github.com/Ja1meZ/projurista-mcp), que faz o mesmo com súmulas e precedentes qualificados. A ideia é uma só: o teor de um artigo não se escreve de memória; copia-se de uma base conferida.

## O que o plugin faz

- **Consulta e citação**: você indica o dispositivo como escreve na peça (`art. 1.015, parágrafo único, do CPC`, `CF 5 LV`, `art. 37, § 6º, da Constituição`) e recebe o texto literal do artigo, parágrafo, inciso, alínea ou item, com a citação pronta para colar.
- **Busca**: palavras do texto da lei localizam os artigos pertinentes (`tutela de urgência`, `honorários recursais majoração`).
- **Verificação**: confere, por código e sem modelo de linguagem, todas as referências a artigos de lei de um texto. Diz se o artigo e a subdivisão existem, se a transcrição confere palavra por palavra, se o trecho é de redação anterior já revogada e se o dispositivo está revogado.
- **Servidor MCP local**: o Claude Desktop e o Claude Code ganham quatro ferramentas (`obter_dispositivo`, `buscar_legislacao`, `listar_diplomas`, `verificar_citacoes_legislacao`) que respondem só com o texto da base.
- **Notas no cofre (opcional)**: os diplomas que você escolher podem ser gravados como notas, com o texto literal e o hash de conferência.

## Instalação

O plugin aguarda a inclusão no diretório oficial de plugins não oficiais do Obsidian. Enquanto isso, instale por um destes caminhos:

**Pelo BRAT (recomendado, com atualização automática)**

1. No Obsidian, abra Configurações → Plugins não oficiais, desligue o modo restrito e instale o plugin **BRAT**.
2. Nas configurações do BRAT, clique em "Add beta plugin" e informe `Ja1meZ/projurista-legislacao`.
3. Ative o Projurista Legislação em Configurações → Plugins não oficiais.

**À mão**

1. Baixe `main.js`, `manifest.json` e `styles.css` da [última release](https://github.com/Ja1meZ/projurista-legislacao/releases/latest).
2. Crie a pasta `<seu cofre>/.obsidian/plugins/projurista-legislacao/` e ponha os três arquivos nela.
3. Reinicie o Obsidian e ative o plugin em Configurações → Plugins não oficiais.

## A base

Versão 2026.11.17: **60 diplomas federais e 10.225 artigos**, entre eles a Constituição Federal (com o ADCT), os Códigos Civil, de Processo Civil, Penal, de Processo Penal, Tributário Nacional, de Defesa do Consumidor e de Trânsito, a CLT, o ECA, a Lei de Execução Penal, a Lei de Improbidade Administrativa, a Lei de Drogas, a Lei Maria da Penha, a Lei de Licitações e Contratos, a LGPD e as leis processuais usuais. A lista completa, com as datas das fontes, sai do comando `listar_diplomas` e do arquivo [`dados/legislacao.relatorio.md`](dados/legislacao.relatorio.md).

Como a base é feita:

1. O texto vem das páginas oficiais do Portal da Legislação (Planalto), convertido por três vias independentes; o texto de cada artigo é decidido por consenso entre elas.
2. Cada nota de origem tem um sha256 do bloco literal. O exportador (`scripts/exportar-base-legislacao.py`) recalcula todos e recusa a exportação se um único hash não fechar.
3. Cada artigo ganha o próprio sha256. O plugin o recalcula ao carregar a base e descarta o artigo que não conferir.
4. A divisão em parágrafos, incisos, alíneas e itens é calculada por regra na exportação. Quando a estrutura de um artigo não é inequívoca (por exemplo, artigo que transcreve dispositivos de outra lei), ele fica sem recorte: o plugin entrega o artigo inteiro e avisa, em vez de arriscar um recorte errado. Na versão atual, isso alcança 198 artigos (1,9%).

## Limites que você precisa conhecer

- **A base é uma fotografia.** Cada diploma traz a data da fonte; alteração legislativa posterior não está refletida. Confira no Planalto o que for recente.
- **Ausente não é inexistente.** Diploma ou artigo que não está na base é apontado como "não encontrado na base", nunca como inexistente. Leis estaduais e municipais, diplomas revogados (CPC de 1973, Código Civil de 1916, Lei 8.666/1993) e leis federais menos usuais não integram a base.
- **O verificador só alcança o que reconhece.** Ele confere referências numeradas a artigos. Menção à lei pelo assunto, sem número de artigo, não é alcançada. Quando a referência não diz o diploma, ele só confirma o que consegue presumir com segurança e deixa o resto como "diploma não identificado".
- **Paráfrase não é transcrição.** Trecho entre aspas que não reproduz ao menos cinco palavras seguidas da lei não é tratado como transcrição.
- **O MCP não obriga o Claude a usar as ferramentas.** As instruções do servidor mandam consultar a base antes de citar; peça isso também no seu comando.
- **Ressalvas da fonte.** Dois dispositivos ficaram sem consenso entre as vias de extração (Decreto 6.514/2008, art. 62; Lei 8.987/1995, art. 27) e são entregues com aviso. Diplomas vindos de página "compilada" do Planalto podem não trazer as redações anteriores. Erros de digitação da própria fonte oficial são reproduzidos como estão.

## Uso no Obsidian

| Comando | O que faz |
|---|---|
| Inserir dispositivo legal | Abre a busca; digite a referência (`cpc 1015 pu`) ou palavras do texto e pressione Enter para inserir a citação no cursor. |
| Consultar dispositivo legal | Abre a ficha completa do dispositivo, com botões para copiar ou inserir. |
| Verificar citações de legislação da nota | Confere a seleção ou a nota inteira e mostra o relatório; clique em um item para ir à linha. |
| Instalar diplomas no cofre | Grava os diplomas escolhidos como notas. Nada é gravado sem você pedir; notas existentes só são substituídas se você ligar essa opção. |

Bloco de código `legis`: a nota guarda a referência e o texto exibido vem sempre da base.

````markdown
```legis
art. 300 do CPC
CF 5 LV
```
````

Nas configurações você escolhe se a inserção escreve a citação pronta ou só o texto, e se as anotações do Planalto ("(Redação dada pela Lei nº ...)", "(Incluído pela ...)") são mantidas. Por padrão elas são retiradas, por regra fixa; o texto da lei não muda.

## Uso com o Claude

O servidor MCP roda dentro do Obsidian, só em `127.0.0.1`, protegido por token. Em Configurações → Projurista Legislação:

- **Claude Desktop**: "Conectar ao Claude Desktop" grava a conexão no arquivo de configuração (com cópia de segurança), ou exporte a extensão `.mcpb`.
- **Claude Code**: "Copiar comando do Claude Code" e cole no terminal.

O Obsidian precisa estar aberto. A porta padrão é 27190, diferente da do Projurista MCP; os dois plugins convivem.

### Servidor avulso (sem Obsidian)

Cada release traz `projurista-legislacao.mjs`, um arquivo Node sem dependências:

```bash
claude mcp add --scope user projurista-legislacao -- node /caminho/projurista-legislacao.mjs

node projurista-legislacao.mjs obter "art. 85, § 11, do CPC"
node projurista-legislacao.mjs buscar "prescrição intercorrente" --diploma LEF
node projurista-legislacao.mjs verificar minuta.txt        # sai com código 1 se NÃO VERIFICADO
node projurista-legislacao.mjs listar
```

## Divulgações

- **Rede**: o plugin não acessa a internet. O servidor MCP escuta apenas em 127.0.0.1 e exige token.
- **Arquivos fora do cofre**: só com a sua confirmação, ao gravar a conexão no arquivo de configuração do Claude Desktop (com cópia de segurança) ou ao salvar o `.mcpb`.
- **Tamanho**: o `main.js` tem cerca de 11 MB porque leva a base de legislação embutida, em texto legível (sem compressão nem ofuscação). Ela só é analisada no primeiro uso, não na abertura do Obsidian.
- **Código de terceiros**: `fflate`, para montar o `.mcpb`.
- **Telemetria**: nenhuma.
- Só para computador (usa recursos do Node.js).

## Atualizar a base

```bash
python3 scripts/exportar-base-legislacao.py \
  --notas "<pasta com uma subpasta por diploma>" \
  --saida dados/legislacao.json \
  --ressalvas dados/ressalvas.json --apelidos dados/apelidos.json
npm test && npm run build
```

O exportador lê notas no formato do pipeline de ingestão (bloco entre `LITERAL:INÍCIO` e `LITERAL:FIM`, `sha256_texto` no frontmatter) e grava ao lado `legislacao.relatorio.md`, com as contagens e os artigos sem recorte por diploma.

## Desenvolvimento

```bash
npm install
npm run dev     # compila em modo de observação
npm test        # 32 testes: integridade, gramática, casos de ouro, verificador, protocolo MCP
npm run build
```

## English summary

Projurista Legislação embeds 60 Brazilian federal statutes (the Constitution, the main codes and commonly used acts; 10,225 articles) as literal text taken from the official Planalto portal. It lets you look up and cite a specific provision (article, paragraph, item) deterministically, checks every statutory citation in a note against the embedded text, and exposes the same tools to Claude through a local MCP server (127.0.0.1, token-protected). No network access, no telemetry. Every article carries a sha256 that is verified when the base is loaded. Desktop only. The interface is in Brazilian Portuguese.

## Licença

MIT. O texto das leis é de domínio público.
