/* Karten auf einem Screenshot oder Foto der Aufstellung finden (reine Bildlogik, kein Netz). */
(function (root) {
  'use strict';

  /* img: {width,height,data(RGBA)} – am besten auf ca. 640 px Breite verkleinert.
     Ergebnis: Rechtecke {x,y,w,h} in Bruchteilen der Bildbreite/-hoehe, zeilenweise sortiert. */
  function findCards(img) {
    var W = img.width, H = img.height, d = img.data, n = W * H;
    var v = new Uint8Array(n), hist = new Uint32Array(256), i, x, y;
    for (i = 0; i < n; i++) { var m = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); v[i] = m; hist[m]++; }
    var acc = 0, med = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.4) { med = i; break; } }
    var T = Math.min(200, med * 1.3 + 22);
    // Dichte heller Pixel in einem kleinen Fenster: schliesst dunkle Stellen innerhalb einer Karte
    var S = new Uint32Array((W + 1) * (H + 1));
    for (y = 0; y < H; y++) { var row = 0; for (x = 0; x < W; x++) { row += v[y * W + x] > T ? 1 : 0; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
    var r = Math.max(2, Math.round(W * 0.006)), mask = new Uint8Array(n);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      var sum = S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
      mask[y * W + x] = sum > (x1 - x0) * (y1 - y0) * 0.42 ? 1 : 0;
    }
    // zusammenhaengende Flaechen
    var lab = new Int32Array(n), comps = [], stack = new Int32Array(n);
    for (i = 0; i < n; i++) {
      if (!mask[i] || lab[i]) continue;
      var id = comps.length + 1, sp = 0, c = { x0: W, y0: H, x1: 0, y1: 0, a: 0 };
      stack[sp++] = i; lab[i] = id;
      while (sp) {
        var p = stack[--sp], px = p % W, py = (p - px) / W; c.a++;
        if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px; if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
        if (px > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (px < W - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (py > 0 && mask[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
        if (py < H - 1 && mask[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
      }
      comps.push(c);
    }
    var boxes = comps.map(function (c) { return { x: c.x0, y: c.y0, w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1, a: c.a }; })
      .filter(function (b) { return b.w > W * 0.035 && b.h > H * 0.06 && b.a > b.w * b.h * 0.45; });
    // typische Kartengroesse aus den Flaechen mit Kartenformat (hoeher als breit)
    var good = boxes.filter(function (b) { var q = b.h / b.w; return q > 1.15 && q < 1.75; });
    if (!good.length) return [];
    var ws = good.map(function (b) { return b.w; }).sort(function (a, b) { return a - b; });
    var hs = good.map(function (b) { return b.h; }).sort(function (a, b) { return a - b; });
    var cw = ws[ws.length >> 1], ch = hs[hs.length >> 1], out = [];
    boxes.forEach(function (b) {
      var kx = Math.round(b.w / cw), ky = Math.round(b.h / ch);
      if (kx < 1 || ky < 1 || kx > 6 || ky > 6) return;
      if (Math.abs(b.w / kx - cw) > cw * 0.3 || Math.abs(b.h / ky - ch) > ch * 0.3) return;
      // verschmolzene Nachbarn gleichmaessig teilen
      for (var iy = 0; iy < ky; iy++) for (var ix = 0; ix < kx; ix++) {
        out.push({ x: (b.x + ix * b.w / kx) / W, y: (b.y + iy * b.h / ky) / H, w: b.w / kx / W, h: b.h / ky / H });
      }
    });
    out.sort(function (a, b) { return Math.abs(a.y - b.y) < a.h * 0.5 ? a.x - b.x : a.y - b.y; });
    return out;
  }

  root.HUTSCAN = { findCards: findCards };
})(typeof window !== 'undefined' ? window : globalThis);
