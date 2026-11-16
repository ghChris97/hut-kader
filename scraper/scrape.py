#!/usr/bin/env python3
"""Liest die HUT-Daten der eingestellten NHL-Version von nhlhutbuilder.com aus
und schreibt kompakte JSON-Dateien. Die NHL-Version steht in version.txt und wechselt
nie von selbst; gibt es eine neuere, steht das nur als Hinweis in den Metadaten.

Schonend: wenige grosse Seitenabrufe, Pause zwischen den Requests, 1x taeglich reicht.
Nur Standardbibliothek. Aufruf:  python3 scrape.py <ausgabe-ordner>
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SITE = "https://nhlhutbuilder.com/"
BASE = SITE + "NHL27/"  # wird in main() auf die aktuelle Version gesetzt
MIN_CARDS = 300  # eine neue Version zaehlt erst, wenn sie genug Karten hat
UA = "Mozilla/5.0 (private hobby project; 1 run/day)"
PAUSE = 1.5
PAGE = 1000

SKATER_ATTRS = ["acceleration", "agility", "balance", "endurance", "speed", "slap_shot_accuracy",
                "slap_shot_power", "wrist_shot_accuracy", "wrist_shot_power", "deking", "off_awareness",
                "hand_eye", "passing", "puck_control", "body_checking", "strength", "aggression",
                "durability", "fighting_skill", "def_awareness", "shot_blocking", "stick_checking",
                "faceoffs", "discipline"]
GOALIE_ATTRS = ["glove_high", "stick_high", "glove_low", "poke_check", "stick_low", "passing", "speed",
                "vision", "endurance", "agility", "positioning", "five_hole", "breakaway",
                "shot_recovery", "aggression", "rebound_control", "durability"]
SKATER_COLS = ["card_art", "full_name", "card", "synergies", "overall", "team", "league", "position",
               "weight", "height", "salary", "hand", "nationality", "division", "aOVR"] + SKATER_ATTRS + \
              ["date_added", "date_updated"]
GOALIE_COLS = ["card_art", "full_name", "card", "synergies", "overall", "team", "league", "hand", "weight",
               "height", "salary", "nationality", "division"] + GOALIE_ATTRS + ["date_added", "date_updated"]
NOT_ORDERABLE = {"card_art", "synergies"}


def http(path, data=None, referer="player-stats.php"):
    headers = {"User-Agent": UA, "Referer": BASE + referer}
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        headers["X-Requested-With"] = "XMLHttpRequest"
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    last = None
    for attempt in range(5 if LEGACY else 3):
        try:
            req = urllib.request.Request(BASE + path, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=120 if LEGACY else 60) as r:
                out = r.read().decode("utf-8", "replace")
            time.sleep(PAUSE)
            return out
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Abruf fehlgeschlagen: {path}: {last}")


def row_id(r):
    if r.get("_id") not in (None, ""):
        return int(r["_id"])
    m = re.search(r'id="(\d+)"', r.get("card_art") or "") or re.search(r"id=(\d+)", r.get("card_art") or "")
    return int(m.group(1)) if m else 0


LEGACY = False  # aeltere Seitenversion: nur einfache Sortierung, keine Zusatzfilter
LEGACY_START = 0.0
LEGACY_BUDGET = float(os.environ.get("LEGACY_BUDGET_MIN", "90")) * 60


def table(endpoint, cols, referer):
    """Mehrere Durchlaeufe mit unterschiedlicher Sortierung, bis alle Karten da sind
    (bei gleichen Sortierwerten liefert die Seite sonst Dubletten/Luecken)."""
    seen, total = {}, 0
    orders = [[("full_name", "asc"), ("aOVR", "asc"), ("date_added", "asc"), ("salary", "asc")],
              [("date_added", "desc"), ("full_name", "desc"), ("aOVR", "desc")],
              [("overall", "asc"), ("team", "asc"), ("full_name", "asc"), ("weight", "asc")]]
    if LEGACY:
        # der alte Server ist langsam und bricht bei Sortierung mit grossem Versatz ab: erst unsortiert lesen
        orders = [[], [("full_name", "asc")]]
    for order in orders:
        order = [(c, d) for c, d in order if c in cols]
        rows, total = table_pass(endpoint, cols, referer, order)
        for r in rows:
            seen[(row_id(r), r.get("_msp"))] = r
        print(f"  eindeutig: {len(seen)}/{total}", flush=True)
        if len(seen) >= total:
            break
    return list(seen.values()), total


def table_params(cols, order, start, length):
    p = [("draw", "1")]
    for i, c in enumerate(cols):
        p += [(f"columns[{i}][data]", c), (f"columns[{i}][name]", ""), (f"columns[{i}][searchable]", "true"),
              (f"columns[{i}][orderable]", "false" if c in NOT_ORDERABLE or (LEGACY and c == "card_art") else "true"),
              (f"columns[{i}][search][value]", ""), (f"columns[{i}][search][regex]", "false")]
    for i, (c, d) in enumerate(order):
        p += [(f"order[{i}][column]", str(cols.index(c))), (f"order[{i}][dir]", d)]
    p += [("start", str(start)), ("length", str(length)), ("search[value]", ""), ("search[regex]", "false")]
    if not LEGACY:
        for k in ["card_type", "team", "league", "nationality", "xfactor"]:
            p += [(f"filter_{k}_ids", ""), (f"exclude_{k}_ids", "")]
        p += [("abilities_match", "all")]
    return p


def table_pass(endpoint, cols, referer, order):
    rows, start, total = [], 0, None
    while total is None or start < total:
        if LEGACY and time.time() - LEGACY_START > LEGACY_BUDGET:
            raise RuntimeError("Zeitbudget fuer die alte Version aufgebraucht")
        d = json.loads(http(endpoint, table_params(cols, order, start, 200 if LEGACY else PAGE), referer))
        total = int(d["recordsFiltered"])
        if not d["data"]:
            break
        rows += d["data"]
        start += len(d["data"])
        print(f"  {endpoint}: {start}/{total}", flush=True)
    return rows, total


def probe_total(version):
    """Anzahl Feldspieler-Karten einer Version, 0 wenn es sie (noch) nicht gibt."""
    global BASE
    old, BASE = BASE, f"{SITE}NHL{version}/"
    try:
        d = json.loads(http("php/player_stats.php", table_params(SKATER_COLS, [("overall", "desc")], 0, 1), "player-stats.php"))
        return int(d.get("recordsTotal") or 0)
    except Exception:  # noqa: BLE001
        return 0
    finally:
        BASE = old


def pinned_version(root):
    """Die Version wechselt nie von selbst: sie steht in version.txt (oder HUT_VERSION)."""
    forced = os.environ.get("HUT_VERSION", "").strip()
    if forced:
        return int(forced)
    f = Path(root) / "version.txt"
    if f.exists():
        m = re.search(r"\d{2}", f.read_text())
        if m:
            return int(m.group(0))
    return 27


def newer_version(current):
    """Nur ein Hinweis fuer die App: gibt es eine neuere Version mit genug Karten?"""
    try:
        req = urllib.request.Request(SITE, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            home = r.read().decode("utf-8", "replace")
        time.sleep(PAUSE)
        for v in sorted({int(x) for x in re.findall(r"NHL\s?(\d{2})\b", home)}, reverse=True):
            if v <= current:
                break
            n = probe_total(v)
            print(f"  NHL {v}: {n} Feldspieler", flush=True)
            if n >= MIN_CARDS:
                return {"version": v, "game": f"NHL {v}", "skaters": n}
    except Exception as e:  # noqa: BLE001
        print(f"  Pruefung auf neuere Version uebersprungen: {e}", flush=True)
    return None


def select_list(kind):
    d = json.loads(http("ajax/select-list.php?" + urllib.parse.urlencode({"type": kind, "filters": "{}"})))
    return d["items"]


def to_id(v):
    """Numerische ID; Sonder-IDs wie 'subtype_1' werden negativ abgebildet."""
    try:
        return int(v)
    except (TypeError, ValueError):
        m = re.search(r"\d+", str(v))
        return -int(m.group(0)) if m else 0


def base(p):
    return p.rsplit("/", 1)[-1] if p else ""


def text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", str(s or ""))).strip()


def num(s):
    m = re.search(r"-?\d+(\.\d+)?", str(s or ""))
    return float(m.group(0)) if m else None


def card(row, kind, maps):
    attrs = SKATER_ATTRS if kind == "s" else GOALIE_ATTRS
    art = re.search(r'src="([^"]+)"', row.get("card_art") or "")
    xf = [int(x) for x in re.findall(r'data-abi_id="(\d+)"', row.get("synergies") or "")]
    sal = num(row.get("salary"))
    wgt = num(row.get("weight"))
    return {
        "id": row_id(row),
        "k": kind,
        "n": text(row.get("full_name")),
        "ct": maps["card"].get(row.get("card_logo") or "", 0) or maps.get("card_abbr", {}).get(row.get("card") or "", 0),
        "ctn": row.get("card") or "",
        "tm": maps["team"].get(row.get("team_logo") or "", 0)
              or maps.get("team_lg", {}).get((row.get("league") or "", row.get("team") or ""), 0)
              or maps.get("team_lg_name", {}).get((row.get("league") or "", row.get("team") or ""), 0)
              or maps["team_abbr"].get(row.get("team") or "", 0),
        "tmn": row.get("team") or "",
        "lg": maps["league"].get(row.get("league_logo") or "", 0) or maps.get("league_name", {}).get(row.get("league") or "", 0),
        "nid": maps.get("nat", {}).get(row.get("nationality") or "", 0),
        "lgn": row.get("league") or "",
        "nat": row.get("nationality") or "",
        "pos": row.get("position") or ("G" if kind == "g" else ""),
        "hand": (row.get("hand") or "")[:1],
        "wgt": int(wgt) if wgt is not None else None,
        "hgt": html.unescape(row.get("height") or ""),
        "sal": sal,
        "ovr": int(row["overall"]),
        "aovr": num(row.get("aOVR")),
        "xf": xf,
        "a": [int(row.get(a) or 0) for a in attrs],
        "art": art.group(1) if art else "",
        "add": row.get("date_added") or "",
        "upd": row.get("date_updated") or "",
        "msp": int(row.get("_msp") or 0),
    }


def parse_combos(s):
    out = []
    lines = re.findall(r'<section id="[a-z_]+_chemistry_table"[^>]*data-chemistry-line="([^"]+)"', s)
    panels = re.split(r'<section id="[a-z_]+_chemistry_table"', s)[1:]
    for line, panel in zip(lines, panels):
        for r in panel.split('<div class="chemistry-table-row"')[1:]:
            bt = re.search(r'data-boost-type="([^"]+)"', r).group(1)
            ba = float(re.search(r'data-boost-amount="([^"]+)"', r).group(1))
            slots = []
            for sl in r.split('<div class="chemistry-requirement-slot"')[1:]:
                reqs = []
                for m in re.finditer(r'<div class="chemistry-combo-logo combo_selector (\w+)"([^>]*)>', sl):
                    a = m.group(2)
                    sid = re.search(r'data-selector-id="([^"]+)"', a).group(1)
                    al = re.search(r'data-selector-aliases="([^"]+)"', a)
                    ti = re.search(r'title="([^"]*)"', a)
                    reqs.append({"kind": m.group(1), "ids": [int(x) for x in (al.group(1) if al else sid).split(",")],
                                 "name": html.unescape(ti.group(1)) if ti else ""})
                slots.append(reqs)
            out.append({"line": line, "type": bt, "boost": ba, "slots": slots})
    return out


def parse_combos_legacy(s):
    out = []
    for line in ("forwards", "defense"):
        i = s.find(f'id="{line}_chemistry_table"')
        if i < 0:
            continue
        j = s.find('_chemistry_table"', i + 30)
        part = s[i:j if j > 0 else len(s)]
        for r in part.split('class="table-row chemistry_table_content"')[1:]:
            b = re.search(r'class="boost_amount">\s*([^<]+)<', r)
            if not b:
                continue
            bt = b.group(1).upper()
            typ = "salary" if "SAL" in bt else ("ability_points" if "AP" in bt else "overall")
            slots = []
            for m in re.finditer(r'combo_selector (\w+)"\s*data-selector_id="(\d+)"', r):
                slots.append([{"kind": m.group(1), "ids": [int(m.group(2))], "name": ""}])
            if slots:
                out.append({"line": line, "type": typ, "boost": num(bt), "slots": slots})
    return out


def options(html_text, select_re):
    m = re.search(select_re + r'[^>]*>(.*?)</select>', html_text, re.S)
    if not m:
        return []
    return [(v, html.unescape(t).strip()) for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)', m.group(1)) if v != ""]


def option_groups(html_text, select_re):
    m = re.search(select_re + r'[^>]*>(.*?)</select>', html_text, re.S)
    out = []
    if not m:
        return out
    for g in re.finditer(r'<optgroup label="([^"]*)"[^>]*>(.*?)</optgroup>', m.group(1), re.S):
        for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)', g.group(2)):
            if v != "":
                out.append((html.unescape(g.group(1)), v, html.unescape(t).strip()))
    return out


def legacy_lists(stats_html, combos_html):
    """Listen der aelteren Seitenversion aus den Auswahlfeldern zusammensetzen (IDs aus der Combo-Seite)."""
    ct_abbr = {name: ab for ab, name in options(stats_html, r'<select name="card_search"')}
    tm_abbr = {name: ab for ab, name in options(stats_html, r'<select id="team_id"')}
    card_type = [{"id": int(i), "name": n, "abbr": ct_abbr.get(n, ""), "logo": ""} for i, n in options(combos_html, r'<select id="filter-card"')]
    # Teams je Liga zuordnen: Kuerzel wie "ANA" gibt es sonst bei NHL und NHL-Alumni doppelt
    ab_by = {(g, n): ab for g, ab, n in option_groups(stats_html, r'<select id="team_id"')}
    team = [{"id": int(i), "name": n, "abbr": ab_by.get((g, n), tm_abbr.get(n, "")), "logo": "", "group": g}
            for g, i, n in option_groups(combos_html, r'<select id="filter-team"')]
    nationality = [{"id": int(i), "name": n, "abbr": n, "logo": ""} for i, n in options(combos_html, r'<select id="filter-nationality"')]
    league = [{"id": k + 1, "name": n, "abbr": v, "logo": ""} for k, (v, n) in enumerate(options(stats_html, r'<select id="league_id"'))]
    names = {}
    for kind, items in (("card", card_type), ("team", team), ("nationality", nationality)):
        for it in items:
            names[(kind, it["id"])] = it["name"]
    return {"card_type": card_type, "team": team, "league": league, "nationality": nationality, "xfactor": []}, names


def page_columns(page_html):
    m = re.search(r'"columns":\s*\[(.*?)\]\s*,\s*"', page_html, re.S) or re.search(r'"columns":\s*\[(.*?)\]\s*\}\s*\)', page_html, re.S)
    return re.findall(r'"data":\s*"([^"]+)"', m.group(1)) if m else []


def parse_xfactors(s, items):
    """X-Factor-Glossar: Stufe, AP-Kosten und Effekte je X-Factor-ID."""
    by_logo = {base(i["logo"]): int(i["id"]) for i in items}
    out = {}
    s = re.sub(r"\s+", " ", s)
    for art in s.split('<article class="xfactor-card')[1:]:
        name = text(re.search(r'class="xfactor-name">(.*?)</div>', art, re.S).group(1))
        cat = text(re.search(r'class="xfactor-category">(.*?)</div>', art, re.S).group(1))
        dm = re.search(r'class="xfactor-description">(.*?)</div>', art, re.S)
        desc = " ".join(text(x) for x in re.findall(r"<p>(.*?)</p>", dm.group(1), re.S)) if dm else ""
        for tier in art.split('<div class="tier-section')[1:]:
            logo = re.search(r'<img class="xfactor-logo" src="([^"]+)"', tier)
            ap = re.search(r'class="ap_amount">\s*(\d+)', tier)
            typ = re.search(r'class="xfactor_type">(.*?)</div>', tier, re.S)
            eff = list(zip([text(x) for x in re.findall(r'class="bonus_effect">(.*?)</div>', tier, re.S)],
                           [text(x) for x in re.findall(r'class="bonus_change">(.*?)</div>', tier, re.S)]))
            xid = by_logo.get(base(logo.group(1))) if logo else None
            if xid is None or not ap:
                continue
            out[str(xid)] = {"n": name, "t": text(typ.group(1)) if typ else "", "ap": int(ap.group(1)),
                             "cat": cat, "d": desc, "e": [list(e) for e in eff]}
    return out


def parse_captains(s):
    """Captain-Karten aus dem Team Builder: ab N Spielern aus den genannten Teams gibt es einen Bonus."""
    m = re.search(r"captainRequirements\s*:\s*(\{.*?\})\s*,\s*coachBuilderData", s, re.S)
    if not m:
        return []
    out = []
    for key, c in json.loads(m.group(1)).items():
        km = re.match(r"(player|goalie)_(\d+)$", key)
        if not km:
            continue
        teams, groups = [], []
        for t in c.get("teams") or []:
            if isinstance(t, dict):
                groups.append({"kind": t.get("captainItemType"), "key": t.get("key")})
            else:
                teams.append(int(t))
        typ = c.get("boostType") or "ability_points"
        out.append({"k": "s" if km.group(1) == "player" else "g", "id": int(km.group(2)),
                    "need": int(c.get("requirementAmount") or 0), "type": typ,
                    "boost": float(c.get("boostAmount") or 0), "teams": teams, "groups": groups,
                    "title": c.get("title") or ""})
    return out


def parse_coaches(s, name_ids):
    out = []
    s = re.sub(r"\s+", " ", s)
    for block in s.split('<article class="coach-card"')[1:]:
        name = html.unescape(re.search(r'data-coach-display-name="([^"]*)"', block).group(1))
        meta = [text(x) for x in re.findall(r"<span>(.*?)</span>", block.split("coach-card__meta")[1].split("</div>")[0], re.S)]
        combos = []
        for sec in block.split('<section class="coach-chemistry__section">')[1:]:
            title = text(re.search(r'coach-chemistry__title">(.*?)</div>', sec, re.S).group(1))
            line = "forwards" if title.lower().startswith("forward") else ("defense" if title.lower().startswith("def") else title.lower())
            for ln in sec.split('<div class="coach-line">')[1:]:
                reqs = [html.unescape(t) for t in re.findall(r'<div class="coach-requirement" title="([^"]*)"', ln)]
                b = text(re.search(r'coach-line__boost[^>]*>(.*?)</div>', ln, re.S).group(1))
                typ = "ability_points" if "AP" in b else ("overall" if "OVR" in b else "salary")
                slots = []
                for t in reqs:
                    hit = name_ids.get(t)
                    slots.append([{"kind": hit[0], "ids": hit[1], "name": t}] if hit else [{"kind": "unknown", "ids": [], "name": t}])
                combos.append({"line": line, "type": typ, "boost": num(b), "slots": slots})
        out.append({"name": name, "meta": meta, "combos": combos})
    return out


def build_version(version):
    """Alle Daten einer NHL-Version. Neue Seitenversion (ab NHL 27) per API, aeltere ueber die Seiten selbst."""
    global BASE, LEGACY
    BASE = f"{SITE}NHL{version}/"
    print(f"== NHL {version} ==", flush=True)
    legacy = False
    try:
        lists = {k: select_list(k) for k in ["card_type", "team", "league", "nationality", "xfactor"]}
    except RuntimeError as e:
        if "404" not in str(e):
            raise
        legacy = True
    LEGACY = legacy
    if legacy:
        global LEGACY_START
        LEGACY_START = time.time()
        stats_html = http("player-stats.php", referer="player-stats.php")
        goalie_html = http("goalie-stats.php", referer="goalie-stats.php")
        combos_html = http("chemistry-combos.php", referer="chemistry-combos.php")
        lists, names = legacy_lists(stats_html, combos_html)
        sk_cols, go_cols = page_columns(stats_html), page_columns(goalie_html)
        maps = {"card": {}, "team": {}, "league": {},
                "card_abbr": {i["abbr"]: i["id"] for i in lists["card_type"] if i["abbr"]},
                "league_name": {i["name"]: i["id"] for i in lists["league"]}}
        cnt = {}
        for i in lists["team"]:
            cnt[i["abbr"]] = cnt.get(i["abbr"], 0) + 1
        maps["team_abbr"] = {i["abbr"]: i["id"] for i in lists["team"] if i["abbr"] and cnt[i["abbr"]] == 1}
        maps["team_lg"] = {(i["group"], i["abbr"]): i["id"] for i in lists["team"] if i["abbr"]}
        maps["team_lg_name"] = {(i["group"], i["name"]): i["id"] for i in lists["team"]}
    else:
        sk_cols, go_cols = SKATER_COLS, GOALIE_COLS
        maps = {
            "card": {base(i["logo"]): to_id(i["id"]) for i in lists["card_type"]},
            "team": {base(i["logo"]): int(i["id"]) for i in lists["team"]},
            "league": {base(i["logo"]): int(i["id"]) for i in lists["league"]},
        }
        abbr_count = {}
        for i in lists["team"]:
            abbr_count[i["abbr"]] = abbr_count.get(i["abbr"], 0) + 1
        maps["team_abbr"] = {i["abbr"]: int(i["id"]) for i in lists["team"] if abbr_count[i["abbr"]] == 1}
    maps["nat"] = {i["name"]: to_id(i["id"]) for i in lists["nationality"]}

    print("Feldspieler ...", flush=True)
    sk, sk_total = table("php/player_stats.php", sk_cols, "player-stats.php")
    print("Goalies ...", flush=True)
    go, go_total = table("php/goalie_stats.php", go_cols, "goalie-stats.php")
    cards = {}
    for r in sk:
        c = card(r, "s", maps)
        cards[("s", c["id"], c["msp"])] = c
    for r in go:
        c = card(r, "g", maps)
        cards[("g", c["id"], c["msp"])] = c
    cards = sorted(cards.values(), key=lambda c: (-c["ovr"], c["n"], c["id"]))

    print("Chemistry Combos ...", flush=True)
    if legacy:
        combos = parse_combos_legacy(combos_html)
        for c in combos:
            for sl in c["slots"]:
                for r in sl:
                    r["name"] = names.get((r["kind"], r["ids"][0]), "")
    else:
        combos = parse_combos(http("chemistry-combos.php", referer="chemistry-combos.php"))
    name_ids = {}
    for i in lists["team"]:
        name_ids[i["name"]] = ("team", [int(i["id"])])
    for i in lists["card_type"]:
        name_ids.setdefault(i["name"], ("card", [to_id(i["id"])]))
    for c in combos:
        for sl in c["slots"]:
            for r in sl:
                if r["name"]:
                    name_ids[r["name"]] = (r["kind"], r["ids"])

    def optional(label, fn, default):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            print(f"  {label} uebersprungen: {e}", flush=True)
            return default

    print("Coaches, X-Factors, Captains ...", flush=True)
    coaches = optional("Coaches", lambda: parse_coaches(http("coaches.php", referer="coaches.php"), name_ids), [])
    xf = optional("X-Factors", lambda: parse_xfactors(http("xfactor-glossary.php", referer="xfactor-glossary.php"), lists["xfactor"]), {})
    captains = optional("Captains", lambda: parse_captains(http("builder.php", referer="builder.php")), [])

    n_s = sum(1 for c in cards if c["k"] == "s")
    n_g = len(cards) - n_s
    problems = []
    if n_s < 0.98 * sk_total:
        problems.append(f"Feldspieler unvollstaendig: {n_s}/{sk_total}")
    if n_g < 0.98 * go_total:
        problems.append(f"Goalies unvollstaendig: {n_g}/{go_total}")
    if not combos:
        problems.append("keine Chemistry Combos gefunden (Seitenaufbau geaendert?)")
    unmapped = sum(1 for c in cards if not c["tm"] or not c["ct"])
    if unmapped > 0.05 * max(1, len(cards)):
        problems.append(f"{unmapped} Karten ohne Team/Kartentyp-Zuordnung")
    if problems:
        raise RuntimeError("; ".join(problems))

    meta = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "game": f"NHL {version}", "version": version, "newer": None,
        "source": f"nhlhutbuilder.com (NHL {version})",
        "skaters": n_s, "goalies": n_g, "combos": len(combos), "coaches": len(coaches),
        "xfactors": len(xf), "captains": len(captains), "legacy": legacy,
        "skater_attrs": SKATER_ATTRS, "goalie_attrs": GOALIE_ATTRS,
        "img_base": BASE,
    }
    print(json.dumps({k: v for k, v in meta.items() if k not in ("skater_attrs", "goalie_attrs")}), flush=True)
    return {"meta": meta, "lists": lists, "cards": cards, "combos": combos, "coaches": coaches, "xf": xf, "captains": captains}


def wanted_versions(root):
    """version.txt: erste Zahl = Standard, weitere = zusaetzlich waehlbar (z. B. '27,26'). HUT_VERSION erzwingt eine."""
    forced = os.environ.get("HUT_VERSION", "").strip()
    if forced:
        return [int(forced)]
    f = Path(root) / "version.txt"
    vs = [int(x) for x in re.findall(r"\d{2}", f.read_text())] if f.exists() else []
    return vs or [27]


def main(outdir):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    versions = wanted_versions(Path(__file__).resolve().parent.parent)
    default = versions[0]
    newer = newer_version(max(versions))
    if newer and newer["version"] not in versions:
        versions.append(newer["version"])  # neue Version ist sofort waehlbar, Standard bleibt unveraendert
    built = []
    max_age_days = float(os.environ.get("OLD_VERSION_MAX_AGE_DAYS", "7"))
    for v in versions:
        try:
            data = None
            cached = out / f"hut-{v}.json"
            if v != default and cached.exists():
                # aeltere Spiele aendern sich kaum: hoechstens einmal pro Woche neu abrufen
                try:
                    old = json.loads(cached.read_text(encoding="utf-8"))
                    age = datetime.now(timezone.utc) - datetime.strptime(old["meta"]["updated"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                    if age.total_seconds() < max_age_days * 86400:
                        data = old
                        print(f"== NHL {v}: Daten vom {old['meta']['updated']} wiederverwendet ==", flush=True)
                except Exception:  # noqa: BLE001
                    data = None
            if data is None and v != default and os.environ.get("SKIP_OLD") == "1":
                print(f"  NHL {v}: kein Zwischenstand, Abruf erst beim naechtlichen Lauf", flush=True)
                continue
            if data is None:
                data = build_version(v)
        except Exception as e:  # noqa: BLE001
            if v == default:
                sys.exit(f"ABBRUCH bei NHL {v}: {e}")
            print(f"  NHL {v} uebersprungen: {e}", flush=True)
            continue
        if v == default:
            data["meta"]["newer"] = newer if newer and newer["version"] > v else None
        (out / f"hut-{v}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        if v == default:
            (out / "hut.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            (out / "meta.json").write_text(json.dumps(data["meta"], ensure_ascii=False, indent=1), encoding="utf-8")
        built.append({"version": v, "game": f"NHL {v}", "updated": data["meta"]["updated"],
                      "skaters": data["meta"]["skaters"], "goalies": data["meta"]["goalies"]})
    manifest = {"default": default, "versions": sorted(built, key=lambda x: -x["version"])}
    (out / "versions.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data")
