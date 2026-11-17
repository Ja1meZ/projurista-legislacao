#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Exporta as notas de legislação (formato de fracionar-legislacao.py) para a base JSON
do Projurista Legislação. Não extrai nada de PDF: só lê notas já auditadas, FORA do
cofre do Obsidian (réplica ou pasta de saída do pipeline), e confere o sha256 de cada
bloco LITERAL contra o frontmatter. Qualquer hash que não feche reprova a exportação.

O texto de cada artigo é copiado linha a linha, sem normalização. A subdivisão
(parágrafo, inciso, alínea, item) é calculada aqui, por regra, e gravada como
caminhos que apontam para as linhas. Artigo cuja estrutura não é inequívoca fica
marcado como "plano": o plugin o entrega inteiro, sem recorte.

Uso:
  exportar-base-legislacao.py --notas <dir> --saida <legislacao.json>
      [--ressalvas dados/ressalvas.json] [--versao AAAA.MM.DD] [--diagnostico]

<dir> é a pasta que contém uma subpasta por diploma, cada qual com "dispositivos/*.md".
Só biblioteca padrão.
"""

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

RE_LITERAL = re.compile(r"<!-- LITERAL:INÍCIO -->\s*\n(.*?)\n\s*<!-- LITERAL:FIM -->", re.S)
RE_CABECALHO = re.compile(r"^## (.+)$", re.M)
RE_ARTIGO_CAB = re.compile(r"^(?:(.+?) — )?Art\. (.+)$")
RE_ANTERIOR_CAB = re.compile(r"^### Art\. (.+?) — redação anterior\s*$", re.M)
NIVEIS = ["parte", "livro", "titulo", "capitulo", "secao", "subsecao"]

ASPAS_ABRE = "“\"‘'"
RE_PONTILHADO = re.compile(r"\.{6,}|…{3,}")

RE_CAPUT = re.compile(r"^Art(?:igo)?\.?\s*(\d{1,4}(?:\.\d{3})?)\s*[ºo°]?\s*(-[A-Z](?:-[A-Z])?)?(?![\w])")
RE_PAR = re.compile(r"^§\s*(\d+)\s*\.?\s*[ºo°]?\s*(?:-\s?([A-Z])(?![a-zà-ú]))?")
RE_PAR_UNICO = re.compile(r"^Par[áa]grafo\s+[úu]nico", re.I)
RE_INCISO = re.compile(r"^([IVXLCDM]+)(?:-([A-Z]))?\s*[-–—](?:\s|$)")
RE_INCISO_PAREN = re.compile(r"^([IVXLCDM]+)\)\s")
RE_INCISO_SEM_HIFEN = re.compile(r"^([IVXLCDM]+)\s+[a-zà-ú(]")
RE_INCISO_SUFIXO_SEM_HIFEN = re.compile(r"^([IVXLCDM]+)-([A-Z])\s+[a-zà-ú(]")
RE_INCISO_L = re.compile(r"^([IVX]*[Il]+)\s?[-–—]\s")
RE_FAIXA = re.compile(r"^(?:~~)?Arts?\.?\s*(\d{1,4}(?:\.\d{3})?)\s*\.?\s+a\s+(\d{1,4}(?:\.\d{3})?)\b")
RE_ALINEA = re.compile(r"^([a-z])\)")
RE_ITEM = re.compile(r"^(\d{1,2})\s*(?:[-–—]|\.|\))\s")
RE_PENA = re.compile(r"^Penas?\s*[-–—:]\s")
RE_ANOTACAO_FINAL = re.compile(r"(?:\s*\([^()]*\)\.?)+\s*$")


def frontmatter(txt):
    m = re.match(r"---\n(.*?)\n---\n", txt, re.S)
    fm = {}
    if not m:
        return fm
    for linha in m.group(1).split("\n"):
        mm = re.match(r"^([a-z_0-9]+):\s*(.*)$", linha)
        if not mm:
            continue
        v = mm.group(2).strip()
        # tolerante: duas notas têm aspas aninhadas sem escape; só as externas saem
        if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
            v = v[1:-1].replace('\\"', '"')
        fm[mm.group(1)] = v
    return fm


def sha(txt):
    return hashlib.sha256(txt.encode("utf-8")).hexdigest()


def romano(s):
    val = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    total, ant = 0, 0
    for ch in reversed(s):
        v = val[ch]
        total += -v if v < ant else v
        ant = max(ant, v)
    return total


def para_romano(n):
    pares = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
             (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    out = ""
    for v, r in pares:
        while n >= v:
            out += r
            n -= v
    return out


def chave_artigo(prefixo, rotulo):
    """'1.015' → '1015'; '103-A' → '103-A'; '3º' → '3'; ('ADCT','112') → 'ADCT:112'."""
    r = rotulo.strip()
    m = re.match(r"^(\d{1,4}(?:\.\d{3})?)\s*[ºo°]?\s*((?:-[A-Z])*)$", r)
    if not m:
        return None
    k = m.group(1).replace(".", "") + m.group(2)
    return (prefixo.upper() + ":" if prefixo else "") + k


def sem_tachado(linha):
    s = linha.strip()
    tachada = s.startswith("~~") and s.endswith("~~") and len(s) > 4
    return (s[2:-2].strip() if tachada else s), tachada


def parece_rubrica(linha):
    """Rubrica marginal: linha curta, sem rótulo, sem pontuação final de dispositivo."""
    s = RE_ANOTACAO_FINAL.sub("", linha).strip()
    if not s or len(s) > 120:
        return False
    if s[-1] in ".;:,":
        return False
    if re.search(r"\s[-–—]\s", s):
        return False
    return s[0].isupper() or s[0] in "“\"("


def estruturar(linhas, chave):
    """
    Devolve (unidades, rubricas_do_artigo, motivo_plano, soltas).
    unidades: lista [caminho, inicio, fim, rubrica(-1), marcas]; marcas: 1 = seguida de
    texto sem rótulo fora do recorte; 2 = linha tachada (revogada).

    Linha inteiramente tachada, em artigo que também tem texto vigente, é classificada
    como as demais (para delimitar os recortes), mas não disputa rótulo com a vigente
    nem entra na conferência de sequência.
    """
    n = len(linhas)
    tipos = [None] * n      # caput | par | inciso | alinea | item | pena | solta | rubrica
    tach = [False] * n
    limpas = []
    for i, bruta in enumerate(linhas):
        s, t = sem_tachado(bruta)
        limpas.append(s)
        tach[i] = t
    if all(tach):
        tach = [False] * n   # artigo inteiro revogado: estrutura-se o texto como está
        todo_tachado = True
    else:
        todo_tachado = False

    num_base = chave.split(":")[-1]
    # 1) citação de outro diploma dentro do artigo: sem recorte confiável
    for s in limpas:
        if RE_PONTILHADO.search(s):
            return None, [], "texto de outro diploma citado no artigo (linha pontilhada)", 0
        if s[:1] in ASPAS_ABRE and re.match(r"^.(?:Art|§|Par[áa]grafo|[IVXLC]+\s*[-–—]|[a-z]\))", s):
            return None, [], "texto de outro diploma citado no artigo (dispositivo entre aspas)", 0
        if re.search(r"\(NR\)\s*$", s):
            return None, [], "texto de outro diploma citado no artigo (NR)", 0

    # 2) localizar o caput
    idx_caput = None
    for i, s in enumerate(limpas):
        m = RE_CAPUT.match(s)
        if not m:
            continue
        k = m.group(1).replace(".", "") + (m.group(2) or "")
        if k != num_base:
            return None, [], "outra linha iniciada por 'Art.' dentro do artigo", 0
        if tach[i]:
            tipos[i] = "caput_tachado"
        elif idx_caput is None:
            idx_caput = i
            tipos[i] = "caput"
        else:
            return None, [], "outra linha iniciada por 'Art.' dentro do artigo", 0
    if idx_caput is None:
        return None, [], "caput não localizado", 0
    for i in range(idx_caput):
        if tipos[i] or tach[i]:
            tipos[i] = tipos[i] or "tachada"
            continue
        tipos[i] = "rubrica"
        if not parece_rubrica(limpas[i]):
            return None, [], "texto sem rótulo antes do caput", 0

    # 3) classificar o restante, com conferência de sequência
    registro = {}          # caminho → unidade
    ordem_unidades = []
    par_atual = None       # caminho do parágrafo corrente (None = caput)
    inc_atual = None
    ali_atual = None
    ult = {}               # (pai, nivel) → último ordinal visto
    erro = [None]

    def registrar(caminho, i, nivel, pai, ordinal):
        u = [caminho, i, i + 1, -1, 2 if (tach[i] or todo_tachado) else 0]
        if tach[i]:
            if caminho not in registro:
                registro[caminho] = u
                ordem_unidades.append(u)
            return
        ant = ult.get((pai, nivel))
        if ant is not None and ordinal <= ant:
            erro[0] = erro[0] or f"sequência quebrada em {caminho}"
        ult[(pai, nivel)] = ordinal
        velho = registro.get(caminho)
        if velho is not None:
            if velho[4] & 2 and not todo_tachado:
                ordem_unidades.remove(velho)     # a versão tachada cede o rótulo à vigente
            else:
                erro[0] = erro[0] or f"rótulo repetido: {caminho}"
                return
        registro[caminho] = u
        ordem_unidades.append(u)

    u0 = ["caput", idx_caput, idx_caput + 1, -1, 2 if todo_tachado else 0]
    registro["caput"] = u0
    ordem_unidades.append(u0)
    if idx_caput > 0 and tipos[idx_caput - 1] == "rubrica":
        u0[3] = idx_caput - 1

    def abre_lista(i):
        ant = RE_ANOTACAO_FINAL.sub("", limpas[i - 1]).rstrip()
        return ant.endswith(":")

    for i in range(idx_caput + 1, n):
        if tipos[i] == "caput_tachado":
            par_atual, inc_atual, ali_atual = None, None, None
            continue
        s = limpas[i]
        m = RE_PAR.match(s)
        if m:
            num = int(m.group(1))
            suf = m.group(2) or ""
            caminho = f"§{num}" + (f"-{suf}" if suf else "")
            registrar(caminho, i, "par", "", (num, suf))
            tipos[i] = "par"
            par_atual, inc_atual, ali_atual = caminho, None, None
        elif RE_PAR_UNICO.match(s):
            if not tach[i] and any(k.startswith("§") and not (u[4] & 2) for k, u in registro.items()):
                erro[0] = erro[0] or "parágrafo único convivendo com parágrafos numerados"
            registrar("pu", i, "par", "", (0, ""))
            tipos[i] = "par"
            par_atual, inc_atual, ali_atual = "pu", None, None
        else:
            pai_inc = par_atual or ""
            esperado = ult.get((pai_inc, "inc"))
            rot_inc = None
            mi = RE_INCISO.match(s)
            if mi:
                rot_inc = (romano(mi.group(1)), mi.group(2) or "")
            else:
                cand = None
                for rx in (RE_INCISO_PAREN, RE_INCISO_SEM_HIFEN, RE_INCISO_SUFIXO_SEM_HIFEN):
                    mm = rx.match(s)
                    if mm:
                        cand = (romano(mm.group(1)), mm.group(2) if mm.lastindex and mm.lastindex > 1 else "")
                        break
                ml = RE_INCISO_L.match(s)
                if cand is None and ml and "l" in ml.group(1):
                    cand = (romano(ml.group(1).replace("l", "I")), "")
                # forma fora do padrão só vale se continuar a sequência (ou inaugurá-la após ':')
                if cand is not None:
                    if esperado is not None and cand > esperado and cand[0] <= esperado[0] + 1:
                        rot_inc = cand
                    elif esperado is None and cand == (1, "") and abre_lista(i):
                        rot_inc = cand
            if rot_inc and rot_inc[0] > 0:
                nome = para_romano(rot_inc[0]) + (f"-{rot_inc[1]}" if rot_inc[1] else "")
                caminho = (par_atual + "/" if par_atual else "") + nome
                registrar(caminho, i, "inc", pai_inc, rot_inc)
                tipos[i] = "inciso"
                inc_atual, ali_atual = caminho, None
            elif RE_ALINEA.match(s):
                letra = RE_ALINEA.match(s).group(1)
                pai = inc_atual or par_atual or ""
                caminho = (pai + "/" if pai else "") + letra
                registrar(caminho, i, "ali", pai, ord(letra))
                tipos[i] = "alinea"
                ali_atual = caminho
            elif RE_ITEM.match(s) and (ali_atual or inc_atual):
                num = int(RE_ITEM.match(s).group(1))
                pai = ali_atual or inc_atual
                ant = ult.get((pai, "item"))
                if tach[i] or (ant is None and num == 1) or (ant is not None and num == ant + 1):
                    registrar(pai + "/" + str(num), i, "item", pai, num)
                    tipos[i] = "item"
                else:
                    tipos[i] = "solta"
            elif RE_PENA.match(s):
                tipos[i] = "pena"
            else:
                tipos[i] = "solta"
        if erro[0]:
            return None, [], erro[0], 0

    # 4) rubricas marginais: linha solta imediatamente antes de parágrafo ou inciso
    for i in range(idx_caput + 1, n - 1):
        if tipos[i] == "solta" and tipos[i + 1] in ("par", "inciso") and not tach[i] and parece_rubrica(limpas[i]):
            tipos[i] = "rubrica"

    # 5) limites: cada unidade vai até o próximo rótulo de nível igual ou superior;
    #    pena e texto solto pertencem ao parágrafo (ou caput) corrente e encerram o
    #    recorte de inciso, alínea e item
    ordem = {"caput": 0, "caput_tachado": 0, "par": 0, "inciso": 1, "alinea": 2, "item": 3}
    pos = {u[1]: u for u in ordem_unidades}
    for u in ordem_unidades:
        nivel = ordem[tipos[u[1]]]
        j = u[1] + 1
        while j < n:
            t = tipos[j]
            if t == "rubrica":
                k = j + 1
                while k < n and tipos[k] not in ordem:
                    k += 1
                if k >= n or ordem[tipos[k]] <= nivel:
                    break
            elif t in ordem:
                if ordem[t] <= nivel:
                    break
            elif nivel > 0:      # pena ou solta: fora do recorte de inciso/alínea/item
                u[4] |= 1
                break
            j += 1
        u[2] = j
    soltas = 0
    for i in range(idx_caput + 1, n):
        if tipos[i] == "rubrica" and i + 1 in pos:
            pos[i + 1][3] = i
        if tipos[i] == "solta":
            soltas += 1
    ordem_unidades.sort(key=lambda u: u[1])
    return ordem_unidades, [i for i in range(n) if tipos[i] == "rubrica"], None, soltas


def partir_artigos(bloco):
    """Divide o bloco LITERAL em [(cabeçalho, [linhas])]."""
    partes = RE_CABECALHO.split(bloco)
    if partes[0].strip():
        raise ValueError("texto antes do primeiro cabeçalho")
    saida = []
    for cab, corpo in zip(partes[1::2], partes[2::2]):
        linhas = [p.strip("\n") for p in re.split(r"\n[ \t]*\n", corpo.strip("\n")) if p.strip()]
        saida.append((cab.strip(), linhas))
    return saida


def remontar(artigos):
    return "\n\n".join("## " + cab + ("\n\n" + "\n\n".join(linhas) if linhas else "") for cab, linhas in artigos)


def anteriores_da_nota(txt):
    fim = txt.find("<!-- LITERAL:FIM -->")
    resto = txt[fim:] if fim >= 0 else ""
    m = re.search(r"^## Redações anteriores \(não vigentes\)\s*$", resto, re.M)
    if not m:
        return {}
    sec = resto[m.end():]
    corte = re.search(r"^(?:---\s*$|## )", sec, re.M)
    if corte:
        sec = sec[:corte.start()]
    partes = RE_ANTERIOR_CAB.split(sec)
    saida = {}
    for rot, corpo in zip(partes[1::2], partes[2::2]):
        linhas = [p.strip() for p in re.split(r"\n[ \t]*\n", corpo) if p.strip()]
        saida.setdefault(rot.strip(), []).extend(linhas)
    return saida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--notas", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--ressalvas")
    ap.add_argument("--apelidos")
    ap.add_argument("--versao", default=date.today().strftime("%Y.%m.%d"))
    ap.add_argument("--diagnostico", action="store_true")
    a = ap.parse_args()

    ressalvas = json.loads(Path(a.ressalvas).read_text(encoding="utf-8")) if a.ressalvas else {}
    apelidos = json.loads(Path(a.apelidos).read_text(encoding="utf-8")) if a.apelidos else {}
    erros, diplomas = [], []
    diag = defaultdict(Counter)
    exemplos_planos = defaultdict(list)
    nao_nfc = 0

    pastas = sorted(p for p in Path(a.notas).iterdir() if (p / "dispositivos").is_dir())
    if not pastas:
        erros.append(f"nenhuma pasta de diploma em {a.notas}")
    for pasta in pastas:
        dip = None
        notas, artigos, vistos = [], [], {}
        abertura = None
        for arq in sorted((pasta / "dispositivos").glob("*.md")):
            txt = arq.read_text(encoding="utf-8")
            if unicodedata.normalize("NFC", txt) != txt:
                nao_nfc += 1
            fm = frontmatter(txt)
            if fm.get("tipo") != "dispositivo-legal":
                continue
            ml = RE_LITERAL.search(txt)
            if not ml:
                erros.append(f"sem bloco LITERAL: {arq.name}")
                continue
            bloco = ml.group(1).strip()
            if sha(bloco) != fm.get("sha256_texto"):
                erros.append(f"hash não fecha: {arq.name}")
                continue
            if dip is None:
                dip = {"sigla": fm.get("sigla", ""), "nome": fm.get("diploma", ""), "lei": fm.get("lei", ""),
                       "pasta": pasta.name, "data_fonte": fm.get("data_fonte", ""), "fonte": fm.get("fonte", "")}
            elif fm.get("sigla") != dip["sigla"]:
                erros.append(f"sigla divergente na pasta: {arq.name}")
                continue
            dip["data_fonte"] = max(dip["data_fonte"], fm.get("data_fonte", ""))
            try:
                partes = partir_artigos(bloco)
            except ValueError as e:
                erros.append(f"{arq.name}: {e}")
                continue
            if remontar(partes) != bloco:
                erros.append(f"divisão com perda: {arq.name}")
                continue
            if not any(RE_ARTIGO_CAB.match(c) for c, _ in partes):
                if abertura is not None:
                    erros.append(f"mais de uma nota de abertura: {arq.name}")
                abertura = {"nota": arq.stem, "partes": [[c, ls] for c, ls in partes], "s": fm["sha256_texto"]}
                continue
            ant = anteriores_da_nota(txt)
            idx_nota = len(notas)
            notas.append({"nome": arq.stem, "h": [fm[k] for k in NIVEIS if fm.get(k)], "s": fm["sha256_texto"]})
            for cab, linhas in partes:
                m = RE_ARTIGO_CAB.match(cab)
                if not m:
                    erros.append(f"cabeçalho inesperado '{cab}' em {arq.name}")
                    continue
                prefixo, rot = m.group(1) or "", m.group(2).strip()
                chave = chave_artigo(prefixo, rot)
                if not chave:
                    erros.append(f"rótulo de artigo não reconhecido '{cab}' em {arq.name}")
                    continue
                if chave in vistos:
                    erros.append(f"artigo duplicado {dip['sigla']} {chave}: {arq.name} e {vistos[chave]}")
                    continue
                vistos[chave] = arq.name
                reg = {"k": chave, "r": (prefixo + " " if prefixo else "") + rot, "n": idx_nota,
                       "l": linhas, "s": sha("\n".join(linhas))}
                revogado = bool(linhas) and all(sem_tachado(x)[1] for x in linhas)
                mf = RE_FAIXA.match(linhas[0]) if linhas else None
                if mf and ":" not in chave and "-" not in chave:
                    de, ate = int(mf.group(1).replace(".", "")), int(mf.group(2).replace(".", ""))
                    if de == int(chave) and de < ate <= de + 60:
                        reg["fx"] = ate
                if revogado:
                    reg["rev"] = 1
                unidades, rubricas, motivo, soltas = estruturar(linhas, chave)
                if motivo:
                    reg["pl"] = motivo
                    diag[dip["sigla"]]["planos"] += 1
                    diag[dip["sigla"]]["plano: " + motivo.split(":")[0]] += 1
                    if len(exemplos_planos[dip["sigla"]]) < 6:
                        exemplos_planos[dip["sigla"]].append(f"art. {reg['r']} — {motivo}")
                else:
                    reg["u"] = unidades
                    if rubricas:
                        reg["rb"] = rubricas
                    if soltas:
                        reg["st"] = soltas
                    diag[dip["sigla"]]["soltas"] += soltas
                    diag[dip["sigla"]]["rubricas"] += len(rubricas)
                # redações anteriores: o cabeçalho traz "ADCT 115" ou "1.063"
                for rot_ant in (reg["r"], rot):
                    if rot_ant in ant:
                        reg["ant"] = ant.pop(rot_ant)
                        break
                rs = ressalvas.get("artigos", {}).get(f"{dip['sigla']}:{chave}")
                if rs:
                    reg["av"] = rs
                artigos.append(reg)
                diag[dip["sigla"]]["artigos"] += 1
            for sobra in ant:
                erros.append(f"redação anterior sem artigo correspondente ({sobra}) em {arq.name}")
        if dip is None:
            erros.append(f"pasta sem notas de dispositivo: {pasta.name}")
            continue
        dip["notas"] = notas
        if abertura:
            dip["abertura"] = abertura
        rd = ressalvas.get("diplomas", {}).get(dip["sigla"])
        if rd:
            dip["av"] = rd
        dip["artigos"] = artigos
        diplomas.append(dip)

    siglas = Counter(d["sigla"] for d in diplomas)
    for s, q in siglas.items():
        if q > 1 or not s:
            erros.append(f"sigla ausente ou repetida entre diplomas: '{s}'")

    for s_ap in apelidos:
        if s_ap not in siglas:
            erros.append(f"apelidos.json cita sigla inexistente: {s_ap}")
    for chave_r in ressalvas.get("artigos", {}):
        sg, _, k = chave_r.partition(":")
        if not any(d["sigla"] == sg and any(x["k"] == k for x in d["artigos"]) for d in diplomas):
            erros.append(f"ressalvas.json cita artigo inexistente: {chave_r}")

    if erros:
        print(f"EXPORTAÇÃO REPROVADA — {len(erros)} problema(s):")
        for e in erros[:60]:
            print("  " + e)
        sys.exit(2)

    total = sum(len(d["artigos"]) for d in diplomas)
    planos = sum(1 for d in diplomas for x in d["artigos"] if "pl" in x)
    base = {
        "versao_base": a.versao,
        "gerado_em": date.today().isoformat(),
        "aviso": ("Texto copiado das páginas oficiais do Portal da Legislação (Planalto), conferido por consenso "
                  "entre três vias de extração. A base é uma fotografia na data da fonte de cada diploma. A ausência "
                  "de um diploma ou de um artigo nesta base não significa que ele não exista."),
        "ausentes": ressalvas.get("ausentes", []),
        "apelidos": apelidos,
        "diplomas": diplomas,
    }
    saida = Path(a.saida)
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(json.dumps(base, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    rel = [f"# Base de legislação {a.versao}", "",
           f"- Diplomas: {len(diplomas)}", f"- Notas lidas: {sum(len(d['notas']) + (1 if 'abertura' in d else 0) for d in diplomas)}",
           f"- Artigos: {total}", f"- Artigos sem recorte (planos): {planos} ({planos * 100 / max(total, 1):.1f}%)",
           f"- Notas fora da forma NFC: {nao_nfc}", "",
           "| Sigla | Diploma | Fonte | Artigos | Planos | Rubricas | Linhas soltas |", "|---|---|---|---|---|---|---|"]
    for d in diplomas:
        c = diag[d["sigla"]]
        rel.append(f"| {d['sigla']} | {d['nome']} | {d['data_fonte']} | {c['artigos']} | {c['planos']} | {c['rubricas']} | {c['soltas']} |")
    rel += ["", "## Motivos de artigo plano", ""]
    motivos = Counter()
    for c in diag.values():
        for k, v in c.items():
            if k.startswith("plano: "):
                motivos[k[7:]] += v
    rel += [f"- {k}: {v}" for k, v in motivos.most_common()]
    rel += ["", "## Exemplos por diploma", ""]
    for s, exs in exemplos_planos.items():
        rel += [f"- {s}: " + "; ".join(exs)]
    Path(str(saida).replace(".json", ".relatorio.md")).write_text("\n".join(rel) + "\n", encoding="utf-8")

    print(f"base {a.versao}: {len(diplomas)} diplomas, {total} artigos, {planos} planos "
          f"({planos * 100 / max(total, 1):.1f}%) → {saida} ({saida.stat().st_size // 1024} KB)")
    if a.diagnostico:
        for k, v in motivos.most_common():
            print(f"  {v:5d}  {k}")


if __name__ == "__main__":
    main()
