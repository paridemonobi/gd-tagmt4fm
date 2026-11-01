/* Gaudio web — impaginazione della pagina e MPK VIRTUALE.
 *
 * L'iPad e' 4:3, il pannello di Gaudio 16:9: il canvas del firmware sta in
 * alto e la fascia libera (sotto in orizzontale, meta' schermo in
 * verticale) diventa un MPK mini 3 da toccare. Gli eventi entrano nel
 * firmware dalla STESSA porta della tastiera del Mac (midi_web.c,
 * gaudio_web_midi -> midi_sim_inject -> midi_poll nel render audio ->
 * midi_cb): il pannello non sa che l'MPK e' virtuale.
 *
 *   PAD      ch10, banco A note 36-43 (le tracce), banco B 44-51 (B1-B7 le
 *            funzioni del banco B, B8 = 51 = SHIFT), come l'MPK vero; col
 *            PROG acceso mandano PROGRAM CHANGE 0-7 / 8-15 (SCENE / LISTA).
 *   SHIFT    tiene la nota 51 (il pad B8) mentre si suona altro: multitouch.
 *   MANOPOLE CC70-77 sul ch1, RELATIVE come l'MPK in modo relativo: un
 *            passo = 1 (avanti) / 127 (indietro), 2-3 se il dito corre.
 *            Trascinamento verticale (su = avanti) o circolare intorno.
 *   TASTIERA ch1, velocity VEL (20..127), OTTAVA -/+ (C4 = 60 di base).
 *   JOYSTICK X = pitch bend (nel firmware: JOY X / MODULA), Y su = CC1
 *            (mod), giu' = CC2 (FILTRO MASTER del PUNCH); torna al centro.
 *   PLAY / REC / SUST (CC64).
 * Spento di serie (decisione utente: basta il tocco): il canvas prende tutto
 * lo schermo; ?mpk=1 nell'indirizzo lo accende. */
(function () {
  'use strict';
  var CY = '#59F4FF', TXT = '#B2FAFF', DIM = '#649599', FAINT = '#2A4042',
      BG = '#050506', PANEL = '#0A0D0E', PANEL2 = '#11181A';
  var FONT = '"JetBrains Mono", "Menlo", monospace';
  var q = new URLSearchParams(location.search);
  var MPK_ON = q.get('mpk') === '1';

  var cv = document.getElementById('canvas');
  var mk = document.getElementById('mpk');
  var ctx = mk.getContext('2d');
  var dpr = 1, W = 0, H = 0, scale = 1;   /* scale = canvas css / 1920 */

  /* ------------------------------------------------ impaginazione */
  var bootFixed = false;
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    var cw, ch, top = 0, left = 0;
    if (!MPK_ON) {
      cw = Math.min(vw, vh * 16 / 9); ch = cw * 9 / 16;
      left = (vw - cw) / 2; top = (vh - ch) / 2;
    } else if (vw >= vh) {
      var m = Math.max(170, Math.min(270, vh * 0.25));
      cw = Math.min(vw, (vh - m) * 16 / 9); ch = cw * 9 / 16;
      left = (vw - cw) / 2;
    } else {
      cw = vw; ch = cw * 9 / 16;
    }
    cw = Math.floor(cw); ch = Math.floor(ch);
    cv.style.left = left + 'px'; cv.style.top = top + 'px';
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    if (!bootFixed) {
      /* i pixel del canvas WebGL si fissano all'avvio (gpu_output_web.c) */
      var bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
      if (bw > 3840) { bw = 3840; bh = 2160; }
      if (bw < 960) { bw = 960; bh = 540; }
      cv.width = bw; cv.height = bh;
      bootFixed = true;
    }
    scale = cw / 1920;
    if (!MPK_ON) { mk.style.display = 'none'; return; }
    var my = top + ch;
    W = vw; H = Math.max(0, vh - my);
    mk.style.display = H > 40 ? 'block' : 'none';
    mk.style.left = '0px'; mk.style.top = my + 'px';
    mk.style.width = W + 'px'; mk.style.height = H + 'px';
    mk.width = Math.round(W * dpr); mk.height = Math.round(H * dpr);
    build(vw >= vh);
    dirty = true;
  }

  /* ------------------------------------------------ stato */
  var bank = 0, prog = false, oct = 0, vel = 100, sust = false;
  var shiftHeld = 0;
  var els = [];                  /* {kind, x,y,w,h, ...} */
  var dirty = true;
  var touches = {};              /* pointerId -> {el, ...} */
  var flash = {};                /* id -> tempo dell'ultimo lampo */

  function midi(s, a, b) {
    if (typeof Module !== 'undefined' && Module._gaudio_web_midi && Module.gaudioFsReady)
      Module._gaudio_web_midi(s, a, b);
  }
  function call(fn) {
    if (typeof Module !== 'undefined' && Module[fn] && Module.gaudioFsReady) Module[fn]();
  }

  /* ------------------------------------------------ costruzione */
  function box(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }
  function add(kind, r, o) {
    var e = o || {};
    e.kind = kind; e.x = r.x; e.y = r.y; e.w = r.w; e.h = r.h;
    e.id = kind + els.length;
    els.push(e);
    return e;
  }

  function buildButtons(r, cols, rows) {
    var list = [
      { t: 'PLAY', act: 'play' }, { t: 'REC', act: 'rec' },
      { t: 'SHIFT', act: 'shift' }, { t: 'SUST', act: 'sust' },
      { t: 'BANCO', act: 'bank' }, { t: 'PROG', act: 'prog' },
      { t: 'OTT −', act: 'octd' }, { t: 'OTT +', act: 'octu' },
      { t: 'VEL −', act: 'veld' }, { t: 'VEL +', act: 'velu' }
    ];
    var g = 6, bw = (r.w - g * (cols - 1)) / cols, bh = (r.h - g * (rows - 1)) / rows;
    for (var i = 0; i < list.length && i < cols * rows; i++) {
      var c = i % cols, rr = Math.floor(i / cols);
      add('btn', box(r.x + c * (bw + g), r.y + rr * (bh + g), bw, bh), list[i]);
    }
  }
  function buildKnobs(r, cols, rows) {
    var cw = r.w / cols, chh = r.h / rows;
    for (var i = 0; i < 8; i++) {
      var c = i % cols, rr = Math.floor(i / cols);
      add('knob', box(r.x + c * cw, r.y + rr * chh, cw, chh), { n: i, ang: -2.2, glow: 0 });
    }
  }
  function buildPads(r, cols, rows) {
    var g = 8, pw = (r.w - g * (cols - 1)) / cols, ph = (r.h - g * (rows - 1)) / rows;
    for (var i = 0; i < 8; i++) {
      /* come l'MPK: 1-4 sotto, 5-8 sopra (in 4x2); in 8x1 in fila */
      var c = i % cols, rr = rows === 2 ? (i < 4 ? 1 : 0) : 0;
      if (rows === 2) c = i % 4;
      add('pad', box(r.x + c * (pw + g), r.y + rr * (ph + g), pw, ph), { n: i });
    }
  }
  function buildKeys(r, whites) {
    var ww = r.w / whites;
    var pat = [0, 2, 4, 5, 7, 9, 11];
    for (var i = 0; i < whites; i++) {
      var semi = 12 * Math.floor(i / 7) + pat[i % 7];
      add('key', box(r.x + i * ww, r.y, ww, r.h), { semi: semi, black: false });
    }
    for (var j = 0; j < whites - 1; j++) {
      var d = j % 7;
      if (d === 2 || d === 6) continue;
      var s2 = 12 * Math.floor(j / 7) + pat[d] + 1;
      add('key', box(r.x + (j + 1) * ww - ww * 0.32, r.y, ww * 0.64, r.h * 0.6), { semi: s2, black: true });
    }
  }

  function build(land) {
    els = [];
    var P = Math.max(8, Math.round(Math.min(W, H) * 0.035)), g = P;
    var x = P, y = P, w = W - 2 * P, h = H - 2 * P;
    if (land) {
      /* fascia: [tasti funzione 2x5] [joystick] [manopole 4x2] [pad 4x2] [tastiera] */
      var bW = Math.min(h * 1.0, w * 0.125), jW = Math.min(h * 0.8, w * 0.085);
      var kW = Math.min(h * 1.7, w * 0.19), pW = Math.min(h * 1.9, w * 0.21);
      var keyW = w - bW - jW - kW - pW - 4 * g;
      buildButtons(box(x, y, bW, h), 2, 5); x += bW + g;
      add('joy', box(x, y, jW, h), { jx: 0, jy: 0 }); x += jW + g;
      buildKnobs(box(x, y, kW, h), 4, 2); x += kW + g;
      buildPads(box(x, y, pW, h), 4, 2); x += pW + g;
      var wk = Math.max(8, Math.min(15, Math.round(keyW / 36)));
      buildKeys(box(x, y, keyW, h), wk);
    } else {
      /* verticale: [manopole 4x2 | joystick] / [pad 4x2 | tasti] / tastiera */
      var r1 = h * 0.33, r2 = h * 0.33, r3 = h - r1 - r2 - 2 * g;
      var jw = Math.min(r1, w * 0.26);
      buildKnobs(box(x, y, w - jw - g, r1), 4, 2);
      add('joy', box(x + w - jw, y, jw, r1), { jx: 0, jy: 0 });
      y += r1 + g;
      var bw2 = w * 0.36;
      buildPads(box(x, y, w - bw2 - g, r2), 4, 2);
      buildButtons(box(x + w - bw2, y, bw2, r2), 2, 5);
      y += r2 + g;
      buildKeys(box(x, y, w, r3), 15);
    }
  }

  /* ------------------------------------------------ disegno */
  function fpx(px) { return Math.max(12, Math.round(px)); }
  function brackets(x, y, w, h, len, col, lw) {
    ctx.strokeStyle = col; ctx.lineWidth = lw || 2;
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
    ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
    ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
    ctx.stroke();
  }
  function dots(x, y, w, h, step, col) {
    ctx.fillStyle = col;
    for (var yy = y + step / 2; yy < y + h; yy += step)
      for (var xx = x + step / 2; xx < x + w; xx += step) ctx.fillRect(xx, yy, 1.2, 1.2);
  }
  function label(t, x, y, size, col, align, weight) {
    ctx.font = (weight || '500') + ' ' + fpx(size) + 'px ' + FONT;
    ctx.fillStyle = col; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, x, y);
  }
  function lit(id, ms) { var t = flash[id]; return t && performance.now() - t < (ms || 140); }

  var PAD_A = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
  var PAD_B = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'SHIFT'];
  var NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function heldBy(e) {
    for (var k in touches) if (touches[k].el === e) return true;
    return false;
  }

  function draw() {
    if (!MPK_ON || H <= 40) return;
    var now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    dots(0, 0, W, H, 14, 'rgba(89,244,255,0.07)');
    ctx.fillStyle = 'rgba(89,244,255,0.22)'; ctx.fillRect(0, 0, W, 1);
    var fs = Math.max(13, Math.min(20, H * 0.075));
    for (var i = 0; i < els.length; i++) {
      var e = els[i], on = heldBy(e);
      if (e.kind === 'btn') {
        var act = e.act;
        var st = on || (act === 'shift' && shiftHeld) || (act === 'sust' && sust) ||
                 (act === 'prog' && prog) || (act === 'bank' && bank === 1) || lit(e.id, 180);
        ctx.fillStyle = st ? 'rgba(89,244,255,0.20)' : PANEL;
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.strokeStyle = st ? CY : FAINT; ctx.lineWidth = 1;
        ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
        if (st) brackets(e.x - 2, e.y - 2, e.w + 4, e.h + 4, Math.min(10, e.h * 0.3), CY, 2);
        var t = e.t;
        if (act === 'bank') t = 'BANCO ' + (bank ? 'B' : 'A');
        label(t, e.x + e.w / 2, e.y + e.h / 2, Math.min(fs * 0.8, e.h * 0.5), st ? TXT : DIM);
      } else if (e.kind === 'pad') {
        var hot = on || lit(e.id, 120);
        var gx = ctx.createLinearGradient(0, e.y, 0, e.y + e.h);
        gx.addColorStop(0, hot ? 'rgba(89,244,255,0.55)' : PANEL2);
        gx.addColorStop(1, hot ? 'rgba(89,244,255,0.18)' : PANEL);
        ctx.fillStyle = gx; ctx.fillRect(e.x, e.y, e.w, e.h);
        dots(e.x, e.y, e.w, e.h, 8, hot ? 'rgba(178,250,255,0.35)' : 'rgba(89,244,255,0.10)');
        ctx.strokeStyle = hot ? CY : FAINT; ctx.lineWidth = hot ? 2 : 1;
        ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
        brackets(e.x + 4, e.y + 4, e.w - 8, e.h - 8, Math.min(12, e.w * 0.18), hot ? TXT : DIM, 2);
        var pl = prog ? 'P' + (bank * 8 + e.n + 1) : (bank ? PAD_B : PAD_A)[e.n];
        if (!prog && bank === 0 && shiftHeld) pl = 'SEL ' + (e.n + 1);
        label(pl, e.x + e.w / 2, e.y + e.h / 2, Math.min(fs, e.h * 0.32), hot ? '#FFFFFF' : TXT, 'center', '600');
        label(String(prog ? 'PC' : (bank ? 44 : 36) + e.n), e.x + e.w - 8, e.y + e.h - 10,
              Math.min(fs * 0.62, e.h * 0.2), DIM, 'right');
      } else if (e.kind === 'knob') {
        var cx = e.x + e.w / 2, cy = e.y + e.h * 0.44;
        var r = Math.min(e.w * 0.36, e.h * 0.34);
        e.glow *= 0.9;
        ctx.fillStyle = PANEL2;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        /* la corsa: anello di tacche, quelle vicine all'indice accese */
        for (var k = 0; k < 24; k++) {
          var a = -Math.PI * 1.25 + k * (Math.PI * 2.5 / 23);
          var d = Math.abs(((a - e.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          var al = d < 0.35 ? 1 : d < 0.8 ? 0.5 : 0.18;
          ctx.strokeStyle = 'rgba(89,244,255,' + (al * (0.55 + 0.45 * Math.min(1, e.glow + (on ? 1 : 0)))) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
          ctx.lineTo(cx + Math.cos(a) * (r + 9), cy + Math.sin(a) * (r + 9));
          ctx.stroke();
        }
        ctx.strokeStyle = on ? CY : FAINT; ctx.lineWidth = on ? 2 : 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = on || e.glow > 0.1 ? TXT : CY; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(e.ang) * r * 0.25, cy + Math.sin(e.ang) * r * 0.25);
        ctx.lineTo(cx + Math.cos(e.ang) * r * 0.9, cy + Math.sin(e.ang) * r * 0.9);
        ctx.stroke();
        label('K' + (e.n + 1), cx, e.y + e.h - Math.min(fs * 0.55, e.h * 0.1),
              Math.min(fs * 0.7, e.h * 0.18), on ? TXT : DIM);
        if (e.glow > 0.02) dirty = true;
      } else if (e.kind === 'key') {
        if (e.black) continue;
        drawKey(e, on);
      } else if (e.kind === 'joy') {
        ctx.fillStyle = PANEL; ctx.fillRect(e.x, e.y, e.w, e.h);
        dots(e.x, e.y, e.w, e.h, 9, 'rgba(89,244,255,0.12)');
        ctx.strokeStyle = FAINT; ctx.lineWidth = 1;
        ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
        var mx = e.x + e.w / 2, my = e.y + e.h / 2;
        ctx.strokeStyle = 'rgba(89,244,255,0.25)';
        ctx.beginPath(); ctx.moveTo(e.x + 6, my); ctx.lineTo(e.x + e.w - 6, my);
        ctx.moveTo(mx, e.y + 6); ctx.lineTo(mx, e.y + e.h - 6); ctx.stroke();
        var px = mx + e.jx * (e.w / 2 - 14), py = my - e.jy * (e.h / 2 - 14);
        ctx.strokeStyle = CY; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(px, py); ctx.stroke();
        ctx.fillStyle = on ? 'rgba(89,244,255,0.5)' : PANEL2;
        ctx.beginPath(); ctx.arc(px, py, Math.min(16, e.w * 0.14), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = on ? TXT : CY; ctx.lineWidth = 2; ctx.stroke();
        brackets(e.x + 3, e.y + 3, e.w - 6, e.h - 6, 10, on ? CY : DIM, 2);
        label('JOY', e.x + 8, e.y + 14, Math.min(fs * 0.6, 14), DIM, 'left');
      }
    }
    /* i neri sopra i bianchi */
    for (var j = 0; j < els.length; j++)
      if (els[j].kind === 'key' && els[j].black) drawKey(els[j], heldBy(els[j]));
    /* ottava e velocity della tastiera, nell'angolo del joystick */
    for (var z = 0; z < els.length; z++) if (els[z].kind === 'joy') {
      var jj = els[z];
      label('C' + (4 + oct) + ' · V' + vel, jj.x + jj.w - 8, jj.y + jj.h - 14,
            Math.min(fs * 0.6, 14), TXT, 'right');
    }
  }
  function drawKey(e, on) {
    var note = 60 + 12 * oct + e.semi;
    var hot = on || lit(e.id, 120);
    if (e.black) {
      ctx.fillStyle = hot ? CY : '#020303';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.strokeStyle = hot ? TXT : DIM; ctx.lineWidth = 1;
      ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
    } else {
      var g = ctx.createLinearGradient(0, e.y, 0, e.y + e.h);
      g.addColorStop(0, hot ? 'rgba(89,244,255,0.6)' : '#0C1416');
      g.addColorStop(1, hot ? 'rgba(89,244,255,0.25)' : '#152225');
      ctx.fillStyle = g; ctx.fillRect(e.x + 1, e.y, e.w - 2, e.h);
      ctx.strokeStyle = hot ? CY : FAINT; ctx.lineWidth = 1;
      ctx.strokeRect(e.x + 1.5, e.y + 0.5, e.w - 3, e.h - 1);
      if (e.semi % 12 === 0)
        label('C' + Math.floor(note / 12 - 1), e.x + e.w / 2, e.y + e.h - 34,
              Math.min(14, e.w * 0.4), hot ? '#fff' : DIM);
    }
  }

  /* ------------------------------------------------ gesti */
  function hit(x, y) {
    /* i neri prima (stanno sopra) */
    for (var i = els.length - 1; i >= 0; i--) {
      var e = els[i];
      if (e.kind === 'key' && !e.black) continue;
      if (x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h) return e;
    }
    for (var j = 0; j < els.length; j++) {
      var f = els[j];
      if (f.kind === 'key' && !f.black && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return f;
    }
    return null;
  }
  function keyNote(e) { return Math.max(0, Math.min(127, 60 + 12 * oct + e.semi)); }

  function press(t, e, x, y) {
    t.el = e; t.x0 = x; t.y0 = y; t.lx = x; t.ly = y; t.acc = 0; t.lt = performance.now();
    flash[e.id] = performance.now();
    if (e.kind === 'pad') {
      if (prog) { midi(0xC9, bank * 8 + e.n, 0); t.note = -1; }
      else { t.note = (bank ? 44 : 36) + e.n; midi(0x99, t.note, 100); }
    } else if (e.kind === 'key') {
      t.note = keyNote(e); midi(0x90, t.note, vel);
    } else if (e.kind === 'joy') {
      joyMove(t, e, x, y);
    } else if (e.kind === 'btn') {
      switch (e.act) {
        case 'play': call('_gaudio_web_play'); break;
        case 'rec': call('_gaudio_web_rec'); break;
        case 'shift': shiftHeld++; midi(0x99, 51, 100); break;
        case 'sust': sust = !sust; midi(0xB0, 64, sust ? 127 : 0); break;
        case 'bank': bank ^= 1; break;
        case 'prog': prog = !prog; break;
        case 'octd': oct = Math.max(-3, oct - 1); break;
        case 'octu': oct = Math.min(3, oct + 1); break;
        case 'veld': vel = Math.max(20, vel - 20); break;
        case 'velu': vel = Math.min(127, vel + 20); break;
      }
    }
    dirty = true;
  }
  function move(t, x, y) {
    var e = t.el;
    if (!e) return;
    if (e.kind === 'knob') {
      /* verticale: su = avanti; un passo ogni ~7 px, 2-3 se il dito corre */
      var dy = (t.ly - y) + (x - t.lx) * 0.35;
      var now = performance.now(), dt = Math.max(1, now - t.lt);
      t.acc += dy; t.lx = x; t.ly = y; t.lt = now;
      var STEP = 7, sp = Math.abs(dy) / dt;          /* px/ms */
      var mag = sp > 1.6 ? 3 : sp > 0.7 ? 2 : 1;
      while (t.acc >= STEP) { t.acc -= STEP; midi(0xB0, 70 + e.n, mag); e.ang += 0.12 * mag; e.glow = 1; }
      while (t.acc <= -STEP) { t.acc += STEP; midi(0xB0, 70 + e.n, 128 - mag); e.ang -= 0.12 * mag; e.glow = 1; }
      dirty = true;
    } else if (e.kind === 'joy') {
      joyMove(t, e, x, y);
    } else if (e.kind === 'key') {
      /* glissando sui tasti: il dito che scivola suona il tasto nuovo */
      var n = hit(x, y);
      if (n && n !== e && n.kind === 'key') {
        midi(0x80, t.note, 0);
        t.el = n; t.note = keyNote(n); midi(0x90, t.note, vel);
        flash[n.id] = performance.now(); dirty = true;
      }
    }
  }
  function release(t) {
    var e = t.el;
    if (!e) return;
    if (e.kind === 'pad' && t.note >= 0) midi(0x89, t.note, 0);
    else if (e.kind === 'key') midi(0x80, t.note, 0);
    else if (e.kind === 'btn' && e.act === 'shift') { shiftHeld = Math.max(0, shiftHeld - 1); if (!shiftHeld) midi(0x89, 51, 0); }
    else if (e.kind === 'joy') {
      e.jx = 0; e.jy = 0;
      midi(0xE0, 0, 64);
      if (t.cc1) midi(0xB0, 1, 0);
      if (t.cc2) midi(0xB0, 2, 0);
    }
    t.el = null;
    dirty = true;
  }
  function joyMove(t, e, x, y) {
    var jx = Math.max(-1, Math.min(1, (x - (e.x + e.w / 2)) / (e.w / 2 - 14)));
    var jy = Math.max(-1, Math.min(1, ((e.y + e.h / 2) - y) / (e.h / 2 - 14)));
    e.jx = jx; e.jy = jy;
    var bend = Math.max(0, Math.min(16383, Math.round(8192 + jx * 8191)));
    if (bend !== t.bend) { t.bend = bend; midi(0xE0, bend & 127, bend >> 7); }
    var v1 = jy > 0 ? Math.round(jy * 127) : 0, v2 = jy < 0 ? Math.round(-jy * 127) : 0;
    if (v1 !== (t.v1 || 0)) { t.v1 = v1; t.cc1 = 1; midi(0xB0, 1, v1); }
    if (v2 !== (t.v2 || 0)) { t.v2 = v2; t.cc2 = 1; midi(0xB0, 2, v2); }
    dirty = true;
  }

  function pos(ev) {
    var r = mk.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }
  mk.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    try { mk.setPointerCapture(ev.pointerId); } catch (e) {}
    var p = pos(ev), e = hit(p[0], p[1]);
    if (!e) return;
    var t = touches[ev.pointerId] = {};
    press(t, e, p[0], p[1]);
  });
  mk.addEventListener('pointermove', function (ev) {
    var t = touches[ev.pointerId];
    if (!t) return;
    ev.preventDefault();
    var p = pos(ev);
    move(t, p[0], p[1]);
  });
  function up(ev) {
    var t = touches[ev.pointerId];
    if (!t) return;
    release(t);
    delete touches[ev.pointerId];
  }
  mk.addEventListener('pointerup', up);
  mk.addEventListener('pointercancel', up);
  mk.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  /* app in secondo piano: niente note appese */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    for (var k in touches) { release(touches[k]); delete touches[k]; }
  });

  /* prove: Gaudio.mpk.tap('pad',0) / .knob(2, +5) */
  window.gaudioMpk = {
    find: function (kind, n) {
      for (var i = 0; i < els.length; i++) if (els[i].kind === kind && (els[i].n === n || n === undefined)) return els[i];
      return null;
    },
    els: function () { return els; }
  };

  function frame() {
    var anyFlash = false, now = performance.now();
    for (var k in flash) if (now - flash[k] < 200) anyFlash = true;
    if (dirty || anyFlash) { dirty = false; draw(); }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 300); });
  layout();
  if (document.fonts && document.fonts.load)
    document.fonts.load('500 16px "JetBrains Mono"').then(function () { dirty = true; }, function () {});
  requestAnimationFrame(frame);
})();
