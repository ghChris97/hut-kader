/* Reihen-Optimierer: reine Logik ohne DOM, damit sie auch in Node testbar ist. */
(function (root) {
  'use strict';

  var F_POS = ['LW', 'C', 'RW'];
  var D_POS = ['LD', 'RD'];
  var LOCK = 1000; // Bonus fuer fixierte Spieler: sie werden praktisch immer aufgestellt
  var DIVISIONS = {
    PACIFIC: [1, 5, 12, 14, 24, 314, 28, 29], CENTRAL: [7, 8, 10, 15, 17, 25, 31, 369],
    METRO: [6, 9, 18, 19, 20, 22, 23, 30], ATLANTIC: [3, 4, 11, 13, 16, 21, 26, 27]
  };
  /* Attribut-Gruppen in der Reihenfolge der Feldspieler-Werte */
  var GROUPS = { skating: [0, 1, 2, 3, 4], shooting: [5, 6, 7, 8], hands: [9, 10, 11, 12, 13], checking: [14, 15, 16, 17, 18], defense: [19, 20, 21, 22, 23] };

  function key(c) { return c.k + c.id; }

  function reqOk(p, r) {
    if (r.kind === 'card') return r.ids.indexOf(p.ct) >= 0;
    if (r.kind === 'team') return r.ids.indexOf(p.tm) >= 0;
    if (r.kind === 'nationality') return r.ids.indexOf(p.nid) >= 0;
    return false;
  }
  function slotOk(p, slot) {
    for (var i = 0; i < slot.length; i++) if (!reqOk(p, slot[i])) return false;
    return slot.length > 0;
  }
  var PERMS = { 2: [[0, 1], [1, 0]], 3: [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] };

  /* Ein Combo greift, wenn jeder Slot von einem anderen Spieler der Reihe erfuellt wird. */
  function comboMatches(combo, players) {
    var n = combo.slots.length;
    if (players.length !== n || !PERMS[n]) return false;
    var perms = PERMS[n];
    for (var i = 0; i < perms.length; i++) {
      var ok = true;
      for (var s = 0; s < n; s++) if (!slotOk(players[perms[i][s]], combo.slots[s])) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  function combosFor(data, line, coachName) {
    var list = data.combos.filter(function (c) { return c.line === line; }).map(function (c, i) {
      return { line: c.line, type: c.type, boost: c.boost, slots: c.slots, src: 'Standard', key: line + i };
    });
    if (coachName) {
      var coach = (data.coaches || []).filter(function (c) { return c.name === coachName; })[0];
      if (coach) coach.combos.forEach(function (c, i) {
        if (c.line === line) list.push({ line: c.line, type: c.type, boost: c.boost, slots: c.slots, src: 'Coach', key: 'coach' + line + i });
      });
    }
    return list;
  }

  /* Nur Combos behalten, deren Slots der Kader ueberhaupt bedienen kann. */
  function usable(combos, pool) {
    return combos.filter(function (c) {
      return c.slots.every(function (slot) { return pool.some(function (p) { return slotOk(p, slot); }); });
    });
  }

  function evalLine(players, combos, val) {
    var b = { overall: 0, ability_points: 0, salary: 0 }, active = [];
    for (var i = 0; i < combos.length; i++) {
      if (comboMatches(combos[i], players)) { b[combos[i].type] += combos[i].boost; active.push(combos[i]); }
    }
    var ovr = 0, sal = 0, v = 0;
    players.forEach(function (p) { ovr += p.ovr; sal += p.sal || 0; v += val ? val(p) : p.ovr; });
    return { players: players, boosts: b, active: active, ovr: ovr, val: v, sal: sal };
  }

  /* Im Spiel zaehlt jedes Combo nur einmal pro Aufstellung (bei mehreren Reihen waehlt man eine).
     Gibt fuer jede Reihe die wirksamen Boni zurueck; doppelte Combos zaehlen nur in der ersten Reihe. */
  function uniqueBoosts(lines, taken) {
    var seen = taken ? Object.assign({}, taken) : {};
    return lines.map(function (l) {
      var b = { overall: 0, ability_points: 0, salary: 0 }, act = [], dup = [];
      l.active.forEach(function (c) { if (seen[c.key]) dup.push(c); else { seen[c.key] = 1; b[c.type] += c.boost; act.push(c); } });
      return { boosts: b, active: act, dup: dup };
    });
  }
  /* Combos, die in den anderen Reihen schon wirken */
  function takenElsewhere(lines, skip) {
    var eff = uniqueBoosts(lines), t = {};
    eff.forEach(function (e, i) { if (i !== skip) e.active.forEach(function (c) { t[c.key] = 1; }); });
    return t;
  }
  function stripTaken(l, taken) {
    if (!taken) return l;
    var e = uniqueBoosts([l], taken)[0];
    return Object.assign({}, l, { boosts: e.boosts, active: e.active, dup: e.dup });
  }
  function finalizeLines(res) {
    ['forwards', 'defense'].forEach(function (k) {
      var eff = uniqueBoosts(res[k]);
      res[k] = res[k].map(function (l, i) { return Object.assign({}, l, { boosts: eff[i].boosts, active: eff[i].active, dup: eff[i].dup }); });
    });
    return res;
  }

  function candidates(pool, slots, strict, combos, val) {
    var out = [];
    var n = slots.length;
    function rec(start, picked) {
      if (picked.length === n) {
        var names = {};
        for (var i = 0; i < n; i++) { if (names[picked[i].n]) return; names[picked[i].n] = 1; }
        var ordered = picked;
        if (strict) {
          ordered = slots.map(function (pos) { return picked.filter(function (p) { return p.pos === pos; })[0]; });
          if (ordered.some(function (p) { return !p; })) return;
        }
        out.push(evalLine(ordered, combos, val));
        return;
      }
      for (var j = start; j < pool.length; j++) rec(j + 1, picked.concat([pool[j]]));
    }
    rec(0, []);
    return out;
  }

  /* Zusatzpunkte je Spieler: fixiert, oder passend zum Captain-Ziel */
  function extra(ctx, p) {
    var e = 0;
    if (ctx.locks[key(p)]) e += LOCK;
    if (ctx.teamBonus && ctx.capTeams && ctx.capTeams[p.tm]) e += ctx.teamBonus;
    return e;
  }
  function lineScore(l, ctx, lambda) {
    var w = ctx.w, s = w.ovr * (l.val + l.boosts.overall * l.players.length) +
      w.ap * l.boosts.ability_points + w.sal * l.boosts.salary - lambda * (l.sal - l.boosts.salary);
    for (var i = 0; i < l.players.length; i++) s += extra(ctx, l.players[i]);
    if (ctx.handBonus && mixedPair(l)) s += ctx.handBonus;
    return s;
  }
  /* Verteidiger-Paar aus einem Links- und einem Rechtsschuetzen */
  function mixedPair(l) { return l.players.length === 2 && l.players[0].hand && l.players[1].hand && l.players[0].hand !== l.players[1].hand; }
  /* Strenge Positionen gelten fuer Verteidiger nicht, wenn sie nach Schusshand verteilt werden */
  function strictFor(ctx, group) { return group === 'defense' ? ctx.strict && !ctx.dHand : ctx.strict; }

  /* k disjunkte Reihen mit maximaler Punktesumme (Branch and Bound ueber die besten Kandidaten). */
  function pickDisjoint(cands, k, ctx, lambda, banned) {
    var arr = cands.map(function (l) { return { l: l, s: lineScore(l, ctx, lambda) }; })
      .filter(function (x) { return !x.l.players.some(function (p) { return banned[p.n]; }); })
      .sort(function (a, b) { return b.s - a.s; });
    if (arr.length > 1500) arr = arr.slice(0, 1500);
    var best = null, bestScore = -Infinity, nodes = 0, LIMIT = 300000;
    function rec(idx, chosen, used, score) {
      if (chosen.length === k) { if (score > bestScore) { bestScore = score; best = chosen.slice(); } return; }
      var need = k - chosen.length;
      for (var i = idx; i <= arr.length - need; i++) {
        if (++nodes > LIMIT) return;
        if (score + arr[i].s * need <= bestScore) return;
        var ps = arr[i].l.players, clash = false;
        for (var j = 0; j < ps.length; j++) if (used[ps[j].n]) { clash = true; break; }
        if (clash) continue;
        ps.forEach(function (p) { used[p.n] = 1; });
        chosen.push(arr[i].l);
        rec(i + 1, chosen, used, score + arr[i].s);
        chosen.pop();
        ps.forEach(function (p) { used[p.n] = 0; });
      }
    }
    rec(0, [], {}, 0);
    return best;
  }
  function pickMost(cands, kMax, ctx, lambda, banned) {
    for (var k = kMax; k >= 1; k--) {
      var r = pickDisjoint(cands, k, ctx, lambda, banned);
      if (r) return r;
    }
    return [];
  }

  function lineupPlayers(res) {
    var out = [];
    res.forwards.concat(res.defense).forEach(function (l) { l.players.forEach(function (p) { out.push(p); }); });
    res.goalies.forEach(function (p) { out.push(p); });
    return out;
  }

  function captainTeams(cap, data) {
    var set = {};
    (cap.teams || []).forEach(function (t) { set[t] = 1; });
    (cap.groups || []).forEach(function (g) {
      if (g.kind === 'division' && DIVISIONS[g.key]) DIVISIONS[g.key].forEach(function (t) { set[t] = 1; });
      if (g.kind === 'league' && data) data.cards.forEach(function (c) { if (c.lgn === g.key) set[c.tm] = 1; });
    });
    /* Alumni-Teams zaehlen im Spiel wie ihr NHL-Team (z. B. Buffalo Sabres Alumni = BUF) */
    var teams = data && data.lists && data.lists.team;
    if (teams) {
      var abbrs = {};
      teams.forEach(function (t) { if (set[t.id] && t.abbr && /^NHL/.test(t.group || 'NHL')) abbrs[t.abbr] = 1; });
      teams.forEach(function (t) { if (abbrs[t.abbr] && /^NHL/.test(t.group || '')) set[t.id] = 1; });
    }
    return set;
  }
  function captainState(res, cap, teams) {
    var ps = lineupPlayers(res), count = 0, inLineup = false;
    ps.forEach(function (p) { if (teams[p.tm]) count++; if (p.k === cap.k && p.id === cap.id) inLineup = true; });
    return { cap: cap, count: count, need: cap.need, inLineup: inLineup, active: inLineup && count >= cap.need, type: cap.type, boost: cap.boost };
  }

  function totals(res, ctx) {
    var w = ctx.w, t = { ovrSum: 0, valSum: 0, n: 0, boostOvr: 0, ap: 0, salBoost: 0, sal: 0, locked: 0, mixed: 0 };
    res.defense.forEach(function (l) { if (mixedPair(l)) t.mixed++; });
    var eff = uniqueBoosts(res.forwards).concat(uniqueBoosts(res.defense));
    res.forwards.concat(res.defense).forEach(function (l, li) {
      var k = l.players.length, bo = eff[li].boosts;
      t.ovrSum += l.ovr + bo.overall * k; t.valSum += l.val + bo.overall * k; t.n += k;
      t.boostOvr += bo.overall; t.ap += bo.ability_points; t.salBoost += bo.salary; t.sal += l.sal;
      l.players.forEach(function (p) { if (ctx.locks[key(p)]) t.locked++; });
    });
    res.goalies.forEach(function (p) {
      t.ovrSum += p.ovr; t.valSum += ctx.val(p); t.n += 1; t.sal += p.sal || 0; if (ctx.locks[key(p)]) t.locked++;
    });
    t.comboAp = t.ap; t.comboSal = t.salBoost;
    if (ctx.captain) {
      var st = captainState(res, ctx.captain, ctx.capTeams);
      t.captain = st;
      if (st.active) {
        if (st.type === 'ability_points') t.ap += st.boost;
        else if (st.type === 'salary') t.salBoost += st.boost;
      }
    }
    t.avg = t.n ? t.ovrSum / t.n : 0;
    t.raw = w.ovr * t.valSum + w.ap * t.ap + w.sal * t.salBoost + LOCK * t.locked + (ctx.handBonus || 0) * t.mixed;
    return t;
  }

  function build(ctx, lambda) {
    var f = pickMost(ctx.fCands, 4, ctx, lambda, {});
    var used = {};
    f.forEach(function (l) { l.players.forEach(function (p) { used[p.n] = 1; }); });
    var d = pickMost(ctx.dCands, 3, ctx, lambda, used);
    d.forEach(function (l) { l.players.forEach(function (p) { used[p.n] = 1; }); });
    var g = [], gNames = {};
    var gs = function (p) { return ctx.w.ovr * ctx.val(p) + extra(ctx, p) - lambda * (p.sal || 0); };
    ctx.goalies.slice().sort(function (a, b) { return gs(b) - gs(a) || (b.aovr || 0) - (a.aovr || 0); })
      .forEach(function (p) { if (g.length < 2 && !gNames[p.n] && !used[p.n]) { g.push(p); gNames[p.n] = 1; } });
    var res = { forwards: f, defense: d, goalies: g };
    res.totals = totals(res, ctx);
    return res;
  }

  /* Nachbessern: einzelne Spieler gegen Bankspieler tauschen, solange der Wert steigt und der Cap haelt. */
  function improve(res, ctx, capBase) {
    var fits = function (t) { return !(capBase > 0) || t.sal - t.salBoost <= capBase + 1e-9; };
    var groups = [{ key: 'forwards', pool: ctx.fPool, combos: ctx.fC }, { key: 'defense', pool: ctx.dPool, combos: ctx.dC }];
    var cur = totals(res, ctx), changed = true, rounds = 0;
    while (changed && rounds++ < 40) {
      changed = false;
      var used = {};
      lineupPlayers(res).forEach(function (p) { used[p.n] = 1; });
      for (var gi = 0; gi < groups.length && !changed; gi++) {
        var g = groups[gi], lines = res[g.key];
        for (var li = 0; li < lines.length && !changed; li++) {
          for (var si = 0; si < lines[li].players.length && !changed; si++) {
            var old = lines[li], out = old.players[si];
            for (var bi = 0; bi < g.pool.length; bi++) {
              var b = g.pool[bi];
              if (used[b.n] || (strictFor(ctx, g.key) && b.pos !== out.pos)) continue;
              var np = old.players.slice(); np[si] = b;
              lines[li] = evalLine(np, g.combos, ctx.val);
              var t = totals(res, ctx);
              var capKeep = !(ctx.captain && cur.captain && cur.captain.active && !(t.captain && t.captain.active));
              if (capKeep && fits(t) && (t.raw > cur.raw + 1e-9 || !fits(cur))) { cur = t; changed = true; break; }
              lines[li] = old;
            }
          }
        }
      }
    }
    res.totals = cur;
    return res;
  }

  function solve(ctx, capBase) {
    var res = build(ctx, 0);
    var over = function (r) { return capBase > 0 && r.totals.sal - r.totals.salBoost > capBase + 1e-9; };
    if (over(res)) {
      var lo = 0, hi = 0.5, bestFeasible = null, tries = 0;
      var r = build(ctx, hi);
      while (over(r) && tries++ < 8) { hi *= 2.5; r = build(ctx, hi); }
      if (!over(r)) bestFeasible = r;
      for (var i = 0; i < 8 && bestFeasible; i++) {
        var mid = (lo + hi) / 2;
        r = build(ctx, mid);
        if (over(r)) lo = mid; else { hi = mid; if (r.totals.raw >= bestFeasible.totals.raw) bestFeasible = r; }
      }
      if (bestFeasible) { res = bestFeasible; res.capAdjusted = true; }
      else { res.capFailed = true; }
    }
    if (!res.capFailed) improve(res, ctx, capBase);
    return res;
  }

  function makeCtx(data, owned, opts) {
    var strict = opts.strict !== false, bans = opts.bans || {}, locks = opts.locks || {};
    var val = opts.val || function (p) { return p.ovr; };
    owned = owned.filter(function (c) { return !bans[key(c)]; });
    var fPool = owned.filter(function (c) { return c.k === 's' && F_POS.indexOf(c.pos) >= 0; });
    var dPool = owned.filter(function (c) { return c.k === 's' && D_POS.indexOf(c.pos) >= 0; });
    var goalies = owned.filter(function (c) { return c.k === 'g'; });
    var top = function (pool, max) {
      return pool.slice().sort(function (a, b) { return (locks[key(b)] ? 1 : 0) - (locks[key(a)] ? 1 : 0) || val(b) - val(a); }).slice(0, max);
    };
    // Sehr grosse Kader begrenzen, damit die Rechnung auf dem Handy fluessig bleibt.
    fPool = top(fPool, strict ? 54 : 28); dPool = top(dPool, 36);
    var fC = usable(combosFor(data, 'forwards', opts.coach), fPool);
    var dC = usable(combosFor(data, 'defense', opts.coach), dPool);
    return {
      w: opts.w || { ovr: 1, ap: 0.5, sal: 0.25 }, val: val, locks: locks, strict: strict,
      dHand: opts.dHand || '', handBonus: opts.dHand ? (opts.handBonus != null ? opts.handBonus : 4) : 0,
      fPool: fPool, dPool: dPool, fC: fC, dC: dC, goalies: goalies,
      fCands: candidates(fPool, F_POS, strict, fC, val), dCands: candidates(dPool, D_POS, strict && !opts.dHand, dC, val),
      captain: null, capTeams: null, teamBonus: 0, owned: owned
    };
  }

  /* owned: Kartenobjekte des Kaders.
     opts: {coach, strict, cap, w:{ovr,ap,sal}, val(card), locks:{key:1}, bans:{key:1}, captain:'auto'|''|key} */
  function optimize(data, owned, opts) {
    opts = opts || {};
    var ctx = makeCtx(data, owned, opts);
    var capBase = opts.cap > 0 ? opts.cap : 0;
    var best = solve(ctx, capBase);
    var capOpt = opts.captain === undefined ? 'auto' : opts.captain;
    if (capOpt && data.captains && data.captains.length) {
      var ownedKeys = {};
      ctx.owned.forEach(function (c) { ownedKeys[key(c)] = c; });
      var cands = data.captains.filter(function (c) {
        return ownedKeys[c.k + c.id] && (capOpt === 'auto' || capOpt === c.k + c.id);
      });
      var baseLocks = ctx.locks, capAlt = null;
      cands.forEach(function (cap) {
        ctx.captain = cap; ctx.capTeams = captainTeams(cap, data);
        ctx.locks = Object.assign({}, baseLocks); ctx.locks[cap.k + cap.id] = 1;
        var steps = [0, 0.5, 1.5, 3, 6, 12, 25, 50], found = null;
        for (var i = 0; i < steps.length && !found; i++) {
          ctx.teamBonus = steps[i];
          var r = solve(ctx, capBase);
          if (!r.capFailed && r.totals.captain && r.totals.captain.active) found = r;
        }
        ctx.teamBonus = 0;
        if (found) {
          // Vergleich ohne den Fixier-Bonus des Captains selbst
          var a = found.totals.raw - LOCK * (baseLocks[cap.k + cap.id] ? 0 : 1);
          var bestHasCap = best && best.totals.captain && best.totals.captain.active;
          if (!best || best.capFailed || a > best.totals.raw + 1e-9 || (opts.forceCaptain && !bestHasCap)) { best = found; best.totals.rawAdj = a; }
          else if (!bestHasCap && (!capAlt || a > capAlt.raw)) {
            capAlt = { raw: a, avg: found.totals.avg, valAvg: found.totals.valSum / found.totals.n, ap: found.totals.ap, cap: cap, players: lineupPlayers(found) };
          }
        } else if (capOpt !== 'auto' && !best.totals.captain) {
          // gewuenschter Captain erreicht das Ziel nicht: trotzdem den Stand zeigen
          ctx.teamBonus = 0;
          best.totals.captain = captainState(best, cap, ctx.capTeams);
        }
        ctx.captain = null; ctx.capTeams = null; ctx.locks = baseLocks;
      });
      if (capAlt && !(best.totals.captain && best.totals.captain.active)) {
        var inB = {}; lineupPlayers(best).forEach(function (p) { inB[key(p)] = 1; });
        var inA = {}; capAlt.players.forEach(function (p) { inA[key(p)] = 1; });
        capAlt.add = capAlt.players.filter(function (p) { return !inB[key(p)]; });
        capAlt.drop = lineupPlayers(best).filter(function (p) { return !inA[key(p)]; });
        capAlt.dAvg = capAlt.avg - best.totals.avg; capAlt.dVal = capAlt.valAvg - best.totals.valSum / best.totals.n; capAlt.dAp = capAlt.ap - best.totals.ap;
        delete capAlt.players; best.capAlt = capAlt;
      }
    }
    var byAvg = function (a, b) { return (b.val + b.boosts.overall * b.players.length) - (a.val + a.boosts.overall * a.players.length); };
    finalizeLines(best);
    best.forwards.sort(byAvg); best.defense.sort(byAvg);
    finalizeLines(best);
    best.capBase = capBase;
    best.pools = { f: ctx.fPool.length, d: ctx.dPool.length, g: ctx.goalies.length };
    best.missing = { f: Math.max(0, 4 - best.forwards.length), d: Math.max(0, 3 - best.defense.length), g: Math.max(0, 2 - best.goalies.length) };
    best.ctx = ctx;
    return best;
  }

  function contrib(l, w) {
    return w.ovr * (l.val + l.boosts.overall * l.players.length) + w.ap * l.boosts.ability_points + w.sal * l.boosts.salary;
  }

  /* Upgrade-Finder: fuer jede fremde Karte der beste Einzeltausch in die aktuelle Aufstellung. */
  function upgrades(data, res, opts, limit) {
    var ctx = res.ctx, w = ctx.w, val = ctx.val, capBase = res.capBase || 0;
    var have = {}, inLineup = {};
    ctx.owned.forEach(function (c) { have[key(c)] = 1; });
    lineupPlayers(res).forEach(function (p) { inLineup[p.n] = (inLineup[p.n] || 0) + 1; });
    var fAll = combosFor(data, 'forwards', opts.coach), dAll = combosFor(data, 'defense', opts.coach);
    var groups = [{ key: 'forwards', lines: res.forwards, combos: fAll, pos: F_POS, label: '. Sturmreihe' }, { key: 'defense', lines: res.defense, combos: dAll, pos: D_POS, label: '. Verteidigungsreihe' }];
    var room = capBase > 0 ? capBase - (res.totals.sal - res.totals.salBoost) : Infinity;
    var minOvr = opts.minOvr || 0, maxO = opts.maxOvr || 0, out = [];
    data.cards.forEach(function (c) {
      if (have[key(c)] || c.ovr < minOvr || (maxO && c.ovr > maxO)) return;
      var best = null;
      if (c.k === 'g') {
        res.goalies.forEach(function (g, gi) {
          if (inLineup[c.n] && g.n !== c.n) return;
          var d = w.ovr * (val(c) - val(g));
          if ((c.sal || 0) - (g.sal || 0) > room + 1e-9) return;
          if (d > 1e-9 && (!best || d > best.delta)) best = { card: c, delta: d, replaces: g, where: gi ? 'Backup' : 'Starter', gain: { overall: 0, ability_points: 0, salary: 0 } };
        });
      } else {
        groups.forEach(function (g) {
          if (g.pos.indexOf(c.pos) < 0) return;
          g.lines.forEach(function (l, li) {
            for (var si = 0; si < l.players.length; si++) {
              var out0 = l.players[si];
              if (strictFor(ctx, g.key) && out0.pos !== c.pos) continue;
              if (ctx.locks[key(out0)]) continue;
              if (inLineup[c.n] && out0.n !== c.n) continue;
              if (val(c) < val(out0) - 8) continue;
              var np = l.players.slice(); np[si] = c;
              var nl = stripTaken(evalLine(np, g.combos, val), takenElsewhere(g.lines, li));
              var d = contrib(nl, w) - contrib(l, w);
              if ((nl.sal - nl.boosts.salary) - (l.sal - l.boosts.salary) > room + 1e-9) continue;
              if (d > 1e-9 && (!best || d > best.delta)) {
                best = { card: c, delta: d, replaces: out0, where: (li + 1) + g.label, line: np, before: l.boosts, after: nl.boosts, group: g.key,
                  gain: { overall: nl.boosts.overall - l.boosts.overall, ability_points: nl.boosts.ability_points - l.boosts.ability_points, salary: nl.boosts.salary - l.boosts.salary } };
              }
            }
          });
        });
      }
      if (best) out.push(best);
    });
    out.sort(function (a, b) { return b.delta - a.delta || b.card.ovr - a.card.ovr; });
    return out.slice(0, limit || 30);
  }

  /* Bonus-Finder: Karten, die durch einen Tausch neue Combos oder den Captain-Bonus freischalten,
     und dabei hoechstens opts.tol Punkte schwaecher sind als der ersetzte Spieler.
     Sortiert nach gewonnenen Boni, dann nach niedrigerer OVR (meist leichter zu bekommen). */
  function bonusUpgrades(data, res, opts, limit) {
    var ctx = res.ctx, w = ctx.w, val = ctx.val, capBase = res.capBase || 0;
    var tol = opts.tol != null ? opts.tol : 3, maxOvr = opts.maxOvr || 0, minOvrB = opts.minOvr || 0;
    var have = {}, inLineup = {};
    ctx.owned.forEach(function (c) { have[key(c)] = 1; });
    lineupPlayers(res).forEach(function (p) { inLineup[p.n] = 1; });
    var groups = [{ key: 'forwards', lines: res.forwards, combos: combosFor(data, 'forwards', opts.coach), pos: F_POS, label: '. Sturmreihe' },
      { key: 'defense', lines: res.defense, combos: combosFor(data, 'defense', opts.coach), pos: D_POS, label: '. Verteidigungsreihe' }];
    var room = capBase > 0 ? capBase - (res.totals.sal - res.totals.salBoost) : Infinity;
    var cst = res.totals.captain, capTeams = cst ? captainTeams(cst.cap, data) : null;
    var out = [];
    data.cards.forEach(function (c) {
      if (c.k !== 's' || have[key(c)] || (maxOvr && c.ovr > maxOvr) || c.ovr < minOvrB || inLineup[c.n]) return;
      var best = null;
      groups.forEach(function (g) {
        if (g.pos.indexOf(c.pos) < 0) return;
        g.lines.forEach(function (l, li) {
          for (var si = 0; si < l.players.length; si++) {
            var o = l.players[si];
            if (strictFor(ctx, g.key) && o.pos !== c.pos) continue;
            if (ctx.locks[key(o)]) continue;
            if (val(c) < val(o) - tol) continue;
            var np = l.players.slice(); np[si] = c;
            var nl = stripTaken(evalLine(np, g.combos, val), takenElsewhere(g.lines, li));
            if ((nl.sal - nl.boosts.salary) - (l.sal - l.boosts.salary) > room + 1e-9) continue;
            var gain = { overall: nl.boosts.overall - l.boosts.overall, ability_points: nl.boosts.ability_points - l.boosts.ability_points, salary: nl.boosts.salary - l.boosts.salary };
            var bonus = w.ovr * gain.overall * np.length + w.ap * gain.ability_points + w.sal * gain.salary;
            // Captain: fehlt genau dieser Spieler aus den Zielteams?
            var capGain = 0;
            if (cst && !cst.active && cst.inLineup && capTeams[c.tm] && !capTeams[o.tm] && cst.count + 1 >= cst.need && !(o.k === cst.cap.k && o.id === cst.cap.id)) {
              capGain = cst.boost; bonus += (cst.type === 'ability_points' ? w.ap : cst.type === 'salary' ? w.sal : w.ovr) * cst.boost;
            }
            if (cst && cst.active && capTeams[o.tm] && !capTeams[c.tm] && cst.count - 1 < cst.need) {
              bonus -= (cst.type === 'ability_points' ? w.ap : cst.type === 'salary' ? w.sal : w.ovr) * cst.boost;
            }
            if (bonus <= 1e-9) continue;
            var newCombos = nl.active.filter(function (x) { return l.active.indexOf(x) < 0 && !l.active.some(function (y) { return y.key === x.key; }); });
            var cand = { card: c, replaces: o, where: (li + 1) + g.label, gain: gain, capGain: capGain, bonus: bonus, diff: val(c) - val(o), combos: newCombos,
              line: np, before: l.boosts, after: nl.boosts, group: g.key };
            if (!best || cand.bonus > best.bonus + 1e-9 || (Math.abs(cand.bonus - best.bonus) < 1e-9 && cand.diff > best.diff)) best = cand;
          }
        });
      });
      if (best) out.push(best);
    });
    // mehr Boni zuerst; bei gleichem Bonus die niedrigere OVR (meist guenstiger), je Spieler nur eine Version
    out.sort(function (a, b) { return (Math.round(b.bonus * 100) - Math.round(a.bonus * 100)) || a.card.ovr - b.card.ovr || b.diff - a.diff; });
    var seen = {}, uniq = [];
    // hoechstens 4 Vorschlaege fuer denselben Platz, damit auch andere Reihen vorkommen
    var perSlot = {};
    out.forEach(function (u) {
      var sk = u.where + '|' + key(u.replaces);
      if (seen[u.card.n] || (perSlot[sk] || 0) >= 4) return;
      seen[u.card.n] = 1; perSlot[sk] = (perSlot[sk] || 0) + 1; uniq.push(u);
    });
    return uniq.slice(0, limit || 30);
  }

  /* Fast-Combos: Reihen, denen genau eine Anforderung fehlt. */
  function nearMisses(data, res, opts, limit) {
    var ctx = res.ctx, w = ctx.w, out = [], seen = {};
    var groups = [{ lines: res.forwards, combos: combosFor(data, 'forwards', opts.coach), label: '. Sturmreihe' },
      { lines: res.defense, combos: combosFor(data, 'defense', opts.coach), label: '. Verteidigungsreihe' }];
    groups.forEach(function (g) {
      g.lines.forEach(function (l, li) {
        var taken = takenElsewhere(g.lines, li);
        g.combos.forEach(function (c) {
          if (comboMatches(c, l.players) || taken[c.key]) return;
          var n = c.slots.length, perms = PERMS[n];
          for (var i = 0; i < perms.length; i++) {
            var missSlot = -1, misses = 0;
            for (var s = 0; s < n; s++) if (!slotOk(l.players[perms[i][s]], c.slots[s])) { misses++; missSlot = s; }
            if (misses !== 1) continue;
            var who = l.players[perms[i][missSlot]];
            var id = g.label + li + c.key + key(who);
            if (seen[id]) continue; seen[id] = 1;
            var worth = c.type === 'overall' ? w.ovr * c.boost * n : c.type === 'ability_points' ? w.ap * c.boost : w.sal * c.boost;
            out.push({ where: (li + 1) + g.label, combo: c, slot: c.slots[missSlot], replace: who, worth: worth, line: l });
          }
        });
      });
    });
    out.sort(function (a, b) { return b.worth - a.worth; });
    // je Reihe und Combo nur den Vorschlag mit dem schwaechsten zu ersetzenden Spieler
    var per = {}, res2 = [];
    out.forEach(function (m) {
      var k = m.where + m.combo.key;
      if (!per[k] || ctx.val(m.replace) < ctx.val(per[k].replace)) per[k] = m;
    });
    Object.keys(per).forEach(function (k) { res2.push(per[k]); });
    res2.sort(function (a, b) { return b.worth - a.worth; });
    return res2.slice(0, limit || 8);
  }

  /* Karten, die einen fehlenden Slot fuellen wuerden (beste zuerst). */
  function fillers(data, miss, res, n) {
    var ctx = res.ctx, used = {};
    lineupPlayers(res).forEach(function (p) { used[p.n] = 1; });
    var ownedKeys = {};
    ctx.owned.forEach(function (c) { ownedKeys[key(c)] = 1; });
    var group = F_POS.indexOf(miss.replace.pos) >= 0 ? F_POS : D_POS;
    return data.cards.filter(function (c) {
      if (c.k !== 's' || !slotOk(c, miss.slot)) return false;
      if (strictFor(ctx, group === D_POS ? 'defense' : 'forwards') ? c.pos !== miss.replace.pos : group.indexOf(c.pos) < 0) return false;
      return !used[c.n] || c.n === miss.replace.n;
    }).map(function (c) { return { card: c, owned: !!ownedKeys[key(c)] }; })
      .sort(function (a, b) { return (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || ctx.val(b.card) - ctx.val(a.card); }).slice(0, n || 3);
  }

  function avg(p, idx) { var s = 0; idx.forEach(function (i) { s += p.a[i] || 0; }); return s / idx.length; }

  /* Powerplay und Unterzahl aus den aufgestellten Feldspielern */
  function specialTeams(res) {
    var fw = [], df = [];
    res.forwards.forEach(function (l) { l.players.forEach(function (p) { fw.push(p); }); });
    res.defense.forEach(function (l) { l.players.forEach(function (p) { df.push(p); }); });
    var off = function (p) { return avg(p, [5, 6, 7, 8, 9, 10, 11, 12, 13]); };
    var offD = function (p) { return avg(p, [6, 5, 10, 12, 13, 4]); };
    var def = function (p) { return avg(p, [19, 20, 21, 4, 3]); };
    var by = function (f) { return function (a, b) { return f(b) - f(a); }; };
    var fo = fw.slice().sort(by(off)), dOff = df.slice().sort(by(offD));
    var fd = fw.slice().sort(by(def)), dDef = df.slice().sort(by(def));
    return {
      pp: [{ f: fo.slice(0, 3), d: dOff.slice(0, 2) }, { f: fo.slice(3, 6), d: dOff.slice(2, 4) }],
      pk: [{ f: fd.slice(0, 2), d: dDef.slice(0, 2) }, { f: fd.slice(2, 4), d: dDef.slice(2, 4) }]
    };
  }

  /* Eigene Bewertung: gewichteter Schnitt der Attribut-Gruppen, sonst OVR. */
  /* Groesse in cm aus 6' 1" */
  function heightCm(h) { var m = /(\d+)'\s*(\d+)/.exec(h || ''); return m ? Math.round(((+m[1]) * 12 + (+m[2])) * 2.54) : 0; }
  /* Groesse als Wert, sanft ansteigend und ohne harte Grenze bei 2 m:
     Feldspieler 1,70 m = 40, 1,85 m = 61, 2,00 m = 83, 2,10 m = 97
     Goalies     1,78 m = 40, 1,88 m = 58, 2,00 m = 80, 2,08 m = 94 */
  function sizeScore(p) {
    var cm = heightCm(p.hgt); if (!cm) return 60;
    var base = p.k === 'g' ? 178 : 170, step = p.k === 'g' ? 1.8 : 1.43;
    return Math.max(0, Math.min(99, 40 + (cm - base) * step));
  }
  /* Eigene Bewertung: gewichteter Schnitt aus OVR, Attributgruppen und Groesse.
     Fehlt ein Gewicht, zaehlt OVR normal (1), Groesse egal (0). */
  function rating(weights) {
    weights = weights || {};
    var wOf = function (k, d) { return weights[k] == null || weights[k] === '' ? d : +weights[k] || 0; };
    var keys = Object.keys(GROUPS), wO = wOf('ovr', 1), wS = wOf('size', 0) * 0.5, wG = wOf('gsize', 0) * 0.35, sum = wO + wS;
    keys.forEach(function (k) { sum += wOf(k, 0); });
    return function (p) {
      if (p.k !== 's') { var gs = wO + wG; if (!wG || !gs) return p.ovr; return Math.round((wO * p.ovr + wG * sizeScore(p)) / gs * 10) / 10; }
      if (!sum) return p.ovr;
      var v = wO * p.ovr + wS * sizeScore(p);
      keys.forEach(function (k) { var w = wOf(k, 0); if (w) v += w * avg(p, GROUPS[k]); });
      return Math.round(v / sum * 10) / 10;
    };
  }

  /* Gespeicherte Aufstellung (Listen von Kartenschluesseln) neu bewerten */
  function evaluate(data, lines, opts, byKey) {
    var val = opts.val || function (p) { return p.ovr; };
    var get = function (arr) { return arr.map(function (k) { return byKey[k]; }).filter(Boolean); };
    var fC = combosFor(data, 'forwards', opts.coach), dC = combosFor(data, 'defense', opts.coach);
    var res = {
      forwards: (lines.f || []).map(get).filter(function (a) { return a.length === 3; }).map(function (a) { return evalLine(a, fC, val); }),
      defense: (lines.d || []).map(get).filter(function (a) { return a.length === 2; }).map(function (a) { return evalLine(a, dC, val); }),
      goalies: get(lines.g || [])
    };
    var ctx = { w: opts.w || { ovr: 1, ap: 0.5, sal: 0.25 }, val: val, locks: {}, captain: null };
    if (lines.c) {
      var cap = (data.captains || []).filter(function (c) { return c.k + c.id === lines.c; })[0];
      if (cap) { ctx.captain = cap; ctx.capTeams = captainTeams(cap, data); }
    }
    finalizeLines(res);
    res.totals = totals(res, ctx);
    res.capBase = opts.cap > 0 ? opts.cap : 0;
    res.missing = { f: 0, d: 0, g: 0 };
    return res;
  }

  /* Reihenfolge eines Paars fuer die Anzeige: [LV, RV]. off = Linksschuetze rechts (One-Timer), on = Linksschuetze links */
  function sidesD(players, mode) {
    var ps = players.slice();
    if ((mode === 'off' || mode === 'on') && ps.length === 2 && ps[0].hand !== ps[1].hand) {
      var leftHand = mode === 'off' ? 'R' : 'L';
      return ps[0].hand === leftHand ? ps : [ps[1], ps[0]];
    }
    var order = ['LD', 'RD'], out = [null, null], rest = [];
    ps.forEach(function (p) { var i = order.indexOf(p.pos); if (i >= 0 && !out[i]) out[i] = p; else rest.push(p); });
    return out.map(function (p) { return p || rest.shift(); });
  }

  /* Beste Reihenpartner: feste Spieler + freie Plaetze aus einem Pool.
     slots: Liste erlaubter Positionen je freiem Platz (leer = alle).
     Kandidaten je Platz: staerkste Karten + passende Karten fuer jeden Combo-Slot. */
  function bestPartners(data, fixed, slots, pool, opts) {
    var line = opts.line, combos = combosFor(data, line, opts.coach), val = opts.val || function (p) { return p.ovr; };
    var w = opts.w || { ovr: 1, ap: 0.5, sal: 0.25 }, n = opts.n || 3, per = opts.per || 2, cap = opts.cap || (slots.length >= 3 ? 34 : 140);
    var used = {}; fixed.forEach(function (p) { used[p.n] = 1; });
    var cand = slots.map(function (pos) {
      var ok = pool.filter(function (c) { return c.k === 's' && !used[c.n] && (!pos.length || pos.indexOf(c.pos) >= 0); });
      ok.sort(function (a, b) { return val(b) - val(a); });
      var pick = {}, out = [];
      var add = function (c) { var k = key(c); if (!pick[k]) { pick[k] = 1; out.push(c); } };
      ok.slice(0, 15).forEach(add);
      combos.forEach(function (cb) { cb.slots.forEach(function (sl) { var m = 0; for (var i = 0; i < ok.length && m < per; i++) if (slotOk(ok[i], sl)) { add(ok[i]); m++; } }); });
      out.sort(function (a, b) { return val(b) - val(a); });
      return out.slice(0, cap);
    });
    var best = [], seen = {};
    var score = function (l) { return w.ovr * (l.val + l.boosts.overall * l.players.length) + w.ap * l.boosts.ability_points + w.sal * l.boosts.salary; };
    var rec = function (i, chosen) {
      if (i === slots.length) {
        var names = {}; for (var j = 0; j < chosen.length; j++) { if (names[chosen[j].n]) return; names[chosen[j].n] = 1; }
        var ps = fixed.concat(chosen), l = evalLine(ps, combos, val), sc = score(l);
        var sig = chosen.map(key).sort().join('|'); if (seen[sig]) return; seen[sig] = 1;
        if (best.length < n || sc > best[best.length - 1].sc) {
          best.push({ sc: sc, add: chosen.slice(), line: l });
          best.sort(function (a, b) { return b.sc - a.sc; }); if (best.length > n) best.pop();
        }
        return;
      }
      cand[i].forEach(function (c) { chosen.push(c); rec(i + 1, chosen); chosen.pop(); });
    };
    rec(0, []);
    return best;
  }

  root.HUT = { uniqueBoosts: uniqueBoosts, takenElsewhere: takenElsewhere, stripTaken: stripTaken, bestPartners: bestPartners, optimize: optimize, comboMatches: comboMatches, evalLine: evalLine, combosFor: combosFor, upgrades: upgrades,
    nearMisses: nearMisses, fillers: fillers, specialTeams: specialTeams, rating: rating, evaluate: evaluate,
    lineupPlayers: lineupPlayers, key: key, GROUPS: GROUPS, heightCm: heightCm, sizeScore: sizeScore, sidesD: sidesD, mixedPair: mixedPair,
    captainTeams: captainTeams, DIVISIONS: DIVISIONS, bonusUpgrades: bonusUpgrades };
})(typeof window !== 'undefined' ? window : globalThis);
