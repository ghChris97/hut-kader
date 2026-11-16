/* Reihen-Optimierer: reine Logik ohne DOM, damit sie auch in Node testbar ist. */
(function (root) {
  'use strict';

  var F_POS = ['LW', 'C', 'RW'];
  var D_POS = ['LD', 'RD'];

  function reqOk(p, r) {
    if (r.kind === 'card') return r.ids.indexOf(p.ct) >= 0;
    if (r.kind === 'team') return r.ids.indexOf(p.tm) >= 0;
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

  function evalLine(players, combos) {
    var b = { overall: 0, ability_points: 0, salary: 0 }, active = [];
    for (var i = 0; i < combos.length; i++) {
      if (comboMatches(combos[i], players)) { b[combos[i].type] += combos[i].boost; active.push(combos[i]); }
    }
    var ovr = 0, sal = 0;
    players.forEach(function (p) { ovr += p.ovr; sal += p.sal || 0; });
    return { players: players, boosts: b, active: active, ovr: ovr, sal: sal };
  }

  function candidates(pool, slots, strict, combos) {
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
        out.push(evalLine(ordered, combos));
        return;
      }
      for (var j = start; j < pool.length; j++) rec(j + 1, picked.concat([pool[j]]));
    }
    rec(0, []);
    return out;
  }

  function lineScore(l, w, lambda) {
    return w.ovr * (l.ovr + l.boosts.overall * l.players.length) +
      w.ap * l.boosts.ability_points + w.sal * l.boosts.salary -
      lambda * (l.sal - l.boosts.salary);
  }

  /* k disjunkte Reihen mit maximaler Punktesumme (Branch and Bound ueber die besten Kandidaten). */
  function pickDisjoint(cands, k, w, lambda, banned) {
    var arr = cands.map(function (l) { return { l: l, s: lineScore(l, w, lambda) }; })
      .filter(function (x) { return !x.l.players.some(function (p) { return banned[p.n]; }); })
      .sort(function (a, b) { return b.s - a.s; });
    if (arr.length > 1500) arr = arr.slice(0, 1500);
    var best = null, bestScore = -Infinity, nodes = 0, LIMIT = 400000;
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

  function pickMost(cands, kMax, w, lambda, banned) {
    for (var k = kMax; k >= 1; k--) {
      var r = pickDisjoint(cands, k, w, lambda, banned);
      if (r) return r;
    }
    return [];
  }

  function build(ctx, lambda) {
    var w = ctx.w;
    var f = pickMost(ctx.fCands, 4, w, lambda, {});
    var used = {};
    f.forEach(function (l) { l.players.forEach(function (p) { used[p.n] = 1; }); });
    var d = pickMost(ctx.dCands, 3, w, lambda, used);
    d.forEach(function (l) { l.players.forEach(function (p) { used[p.n] = 1; }); });
    var g = [], gNames = {};
    ctx.goalies.slice().sort(function (a, b) {
      return (w.ovr * b.ovr - lambda * (b.sal || 0)) - (w.ovr * a.ovr - lambda * (a.sal || 0)) || (b.aovr || 0) - (a.aovr || 0);
    }).forEach(function (p) { if (g.length < 2 && !gNames[p.n]) { g.push(p); gNames[p.n] = 1; } });
    var byAvg = function (a, b) { return (b.ovr + b.boosts.overall * b.players.length) - (a.ovr + a.boosts.overall * a.players.length); };
    f.sort(byAvg); d.sort(byAvg);
    var t = { ovrSum: 0, n: 0, boostOvr: 0, ap: 0, salBoost: 0, sal: 0 };
    f.concat(d).forEach(function (l) {
      t.ovrSum += l.ovr + l.boosts.overall * l.players.length; t.n += l.players.length;
      t.boostOvr += l.boosts.overall; t.ap += l.boosts.ability_points; t.salBoost += l.boosts.salary; t.sal += l.sal;
    });
    g.forEach(function (p) { t.ovrSum += p.ovr; t.n += 1; t.sal += p.sal || 0; });
    t.avg = t.n ? t.ovrSum / t.n : 0;
    t.raw = w.ovr * t.ovrSum + w.ap * t.ap + w.sal * t.salBoost;
    return { forwards: f, defense: d, goalies: g, totals: t };
  }

  function totals(res, w) {
    var t = { ovrSum: 0, n: 0, boostOvr: 0, ap: 0, salBoost: 0, sal: 0 };
    res.forwards.concat(res.defense).forEach(function (l) {
      t.ovrSum += l.ovr + l.boosts.overall * l.players.length; t.n += l.players.length;
      t.boostOvr += l.boosts.overall; t.ap += l.boosts.ability_points; t.salBoost += l.boosts.salary; t.sal += l.sal;
    });
    res.goalies.forEach(function (p) { t.ovrSum += p.ovr; t.n += 1; t.sal += p.sal || 0; });
    t.avg = t.n ? t.ovrSum / t.n : 0;
    t.raw = w.ovr * t.ovrSum + w.ap * t.ap + w.sal * t.salBoost;
    return t;
  }

  /* Nachbessern: einzelne Spieler gegen Bankspieler tauschen, solange der Wert steigt und der Cap haelt. */
  function improve(res, ctx, capBase) {
    var w = ctx.w;
    var fits = function (t) { return !(capBase > 0) || t.sal - t.salBoost <= capBase + 1e-9; };
    var groups = [
      { key: 'forwards', pool: ctx.fPool, combos: ctx.fC },
      { key: 'defense', pool: ctx.dPool, combos: ctx.dC }
    ];
    var cur = totals(res, w), changed = true, rounds = 0;
    while (changed && rounds++ < 40) {
      changed = false;
      var used = {};
      res.forwards.concat(res.defense).forEach(function (l) { l.players.forEach(function (p) { used[p.n] = 1; }); });
      res.goalies.forEach(function (p) { used[p.n] = 1; });
      for (var gi = 0; gi < groups.length && !changed; gi++) {
        var g = groups[gi], lines = res[g.key];
        for (var li = 0; li < lines.length && !changed; li++) {
          for (var si = 0; si < lines[li].players.length && !changed; si++) {
            var old = lines[li], out = old.players[si];
            for (var bi = 0; bi < g.pool.length; bi++) {
              var b = g.pool[bi];
              if (used[b.n] || (ctx.strict && b.pos !== out.pos)) continue;
              var np = old.players.slice(); np[si] = b;
              lines[li] = evalLine(np, g.combos);
              var t = totals(res, w);
              var better = fits(t) && (t.raw > cur.raw + 1e-9 || (!fits(cur)));
              if (better) { cur = t; changed = true; break; }
              lines[li] = old;
            }
          }
        }
      }
    }
    res.totals = cur;
    return res;
  }

  /* owned: Kartenobjekte des Kaders. opts: {coach, strict, cap, w:{ovr,ap,sal}} */
  function optimize(data, owned, opts) {
    var strict = opts.strict !== false;
    var fPool = owned.filter(function (c) { return c.k === 's' && F_POS.indexOf(c.pos) >= 0; });
    var dPool = owned.filter(function (c) { return c.k === 's' && D_POS.indexOf(c.pos) >= 0; });
    var goalies = owned.filter(function (c) { return c.k === 'g'; });
    var cap = function (pool, max) {
      return pool.slice().sort(function (a, b) { return b.ovr - a.ovr || (b.aovr || 0) - (a.aovr || 0); }).slice(0, max);
    };
    // Sehr grosse Kader begrenzen, damit die Rechnung auf dem Handy fluessig bleibt.
    fPool = cap(fPool, strict ? 60 : 30); dPool = cap(dPool, 40);
    var fC = usable(combosFor(data, 'forwards', opts.coach), fPool);
    var dC = usable(combosFor(data, 'defense', opts.coach), dPool);
    var ctx = {
      w: opts.w || { ovr: 1, ap: 0.5, sal: 0.25 },
      strict: strict, fPool: fPool, dPool: dPool, fC: fC, dC: dC,
      fCands: candidates(fPool, F_POS, strict, fC),
      dCands: candidates(dPool, D_POS, strict, dC),
      goalies: goalies
    };
    var res = build(ctx, 0);
    var capBase = opts.cap > 0 ? opts.cap : 0;
    var over = function (r) { return capBase > 0 && r.totals.sal - r.totals.salBoost > capBase + 1e-9; };
    res.capBase = capBase;
    if (over(res)) {
      var lo = 0, hi = 0.5, bestFeasible = null, tries = 0;
      var r = build(ctx, hi);
      while (over(r) && tries++ < 8) { hi *= 2.5; r = build(ctx, hi); }
      if (!over(r)) bestFeasible = r;
      for (var i = 0; i < 9 && bestFeasible; i++) {
        var mid = (lo + hi) / 2;
        r = build(ctx, mid);
        if (over(r)) lo = mid; else { hi = mid; if (r.totals.raw >= bestFeasible.totals.raw) bestFeasible = r; }
      }
      if (bestFeasible) { res = bestFeasible; res.capBase = capBase; res.capAdjusted = true; }
      else { res.capFailed = true; }
    }
    if (!res.capFailed) {
      improve(res, ctx, capBase);
      var byAvg2 = function (a, b) { return (b.ovr + b.boosts.overall * b.players.length) - (a.ovr + a.boosts.overall * a.players.length); };
      res.forwards.sort(byAvg2); res.defense.sort(byAvg2);
    }
    res.pools = { f: fPool.length, d: dPool.length, g: goalies.length };
    res.missing = {
      f: Math.max(0, 4 - res.forwards.length), d: Math.max(0, 3 - res.defense.length), g: Math.max(0, 2 - res.goalies.length)
    };
    return res;
  }

  root.HUT = { optimize: optimize, comboMatches: comboMatches, evalLine: evalLine, combosFor: combosFor };
})(typeof window !== 'undefined' ? window : globalThis);
