/* Gaudio web — l'uscita audio (chiamata da alsa_out_webaudio.c).
 *
 * AudioWorklet con una CODA: il firmware rende a pezzi da 1024 frame sul
 * thread principale (Module._gaudio_web_audio_render) e li manda al
 * worklet (postMessage, buffer trasferiti: niente SharedArrayBuffer, niente
 * header speciali del server). Il worklet suona dalla coda e chiede altro
 * quando scende sotto la profondita' scelta (?buf=, default 4096 frame =
 * 85 ms a 48 kHz). A pezzi piccoli il render non blocca il disegno per
 * 20 ms di fila come i 4096 frame in un colpo dello ScriptProcessor, e la
 * coda assorbe un fotogramma lento del pannello.
 *
 * SOTTOCARICO (la coda vuota quando la scheda chiede suono): invece del
 * silenzio secco il worklet ripete l'ultimo blocco in dissolvenza (~20 ms)
 * e rientra con una salita di 64 campioni: un "sospiro" invece di un clic.
 * Si contano (gaudioAudioStats.under) e la diagnostica li mostra.
 *
 * Ripiego: ScriptProcessorNode (Safari senza AudioWorklet), dove un blocco
 * arrivato tardi si riconosce da ev.playbackTime < currentTime. */
(function () {
  'use strict';
  var CH = 1024;
  var WORKLET = [
    "class GaudioOut extends AudioWorkletProcessor {",
    "  constructor(o) {",
    "    super();",
    "    this.target = o.processorOptions.target; this.q = []; this.qf = 0; this.off = 0;",
    "    this.recv = 0; this.under = 0; this.dry = false; this.g = 1; this.rise = 64;",
    "    this.lastL = new Float32Array(128); this.lastR = new Float32Array(128); this.tick = 0;",
    "    this.port.onmessage = (e) => { const d = e.data; if (d.L) { this.q.push(d); this.qf += d.L.length; this.recv += d.L.length; } };",
    "  }",
    "  process(inp, out) {",
    "    const L = out[0][0], R = out[0][1] || out[0][0], n = L.length; let i = 0;",
    "    while (i < n && this.q.length) {",
    "      const b = this.q[0], k = Math.min(n - i, b.L.length - this.off);",
    "      L.set(b.L.subarray(this.off, this.off + k), i); R.set(b.R.subarray(this.off, this.off + k), i);",
    "      i += k; this.off += k; this.qf -= k;",
    "      if (this.off >= b.L.length) { this.q.shift(); this.off = 0; }",
    "    }",
    "    if (i < n) {",
    "      if (!this.dry) { this.under++; this.dry = true; }",
    "      for (let j = i; j < n; j++) { this.g *= 0.996; L[j] = this.lastL[j] * this.g; R[j] = this.lastR[j] * this.g; }",
    "    } else if (this.dry) {",
    "      this.dry = false;",
    "      for (let j = 0; j < n && j < this.rise; j++) { const r = j / this.rise; L[j] *= r; R[j] *= r; }",
    "      this.g = 1;",
    "    }",
    "    if (!this.dry) { this.lastL.set(L); this.lastR.set(R); this.g = 1; }",
    "    if (++this.tick >= 4 || this.qf < this.target / 2) {",
    "      this.tick = 0;",
    "      this.port.postMessage({ have: this.qf, recv: this.recv, under: this.under });",
    "    }",
    "    return true;",
    "  }",
    "}",
    "registerProcessor('gaudio-out', GaudioOut);"
  ].join('\n');

  window.gaudioAudioStart = function (buf, fs, nullout) {
    var st = { frames: 0, ms: 0, maxMs: 0, callbacks: 0, late: 0, under: 0, last: 0, fs: fs, buf: buf, mode: '' };
    window.gaudioAudioStats = st;
    function render(n) {
      var t0 = performance.now();
      var p = Module._gaudio_web_audio_render(n) >> 2;
      var dt = performance.now() - t0;
      st.frames += n; st.ms += dt; st.callbacks++;
      if (dt > st.maxMs) st.maxMs = dt;
      if (dt > 1000 * n / fs) st.late++;
      st.last = dt;
      return p;
    }
    if (nullout) {
      st.mode = 'null';
      var per = 1000 * buf / fs, next = performance.now();
      Module.gaudioNullTimer = setInterval(function () {
        var now = performance.now(), k = 0;
        while (next <= now && k++ < 4) { render(buf); next += per; }
        if (now - next > 500) next = now;
      }, Math.max(4, per / 4));
      return 0;
    }
    var ctx = Module.gaudioCtx;
    if (!ctx) return -1;

    function startScriptProcessor() {
      st.mode = 'ScriptProcessor';
      var spb = Math.min(8192, Math.max(1024, 1 << Math.round(Math.log2(buf))));  /* potenza di 2 */
      var node = ctx.createScriptProcessor(spb, 0, 2);
      var nextT = 0;
      node.onaudioprocess = function (ev) {
        var ob = ev.outputBuffer, n = ob.length;
        var L = ob.getChannelData(0), R = ob.getChannelData(1);
        var p = render(n), H = Module.HEAPF32;
        L.set(H.subarray(p, p + n));
        R.set(H.subarray(p + n, p + 2 * n));
        /* un buco: il blocco suona piu' tardi di dove finiva il precedente */
        var t = ev.playbackTime || 0;
        if (nextT && t > nextT + 0.002) st.under++;
        nextT = t + n / ctx.sampleRate;
      };
      node.connect(ctx.destination);
      Module.gaudioNode = node;
    }

    var forceSP = /[?&]sp=1/.test(location.search);
    if (!forceSP && ctx.audioWorklet && window.AudioWorkletNode) {
      var url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      ctx.audioWorklet.addModule(url).then(function () {
        var target = buf;
        var node = new AudioWorkletNode(ctx, 'gaudio-out', {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
          processorOptions: { target: target }
        });
        var sent = 0;
        function push(n) {
          var p = render(n), H = Module.HEAPF32;
          var L = H.slice(p, p + n), R = H.slice(p + n, p + 2 * n);
          node.port.postMessage({ L: L, R: R }, [L.buffer, R.buffer]);
          sent += n;
        }
        var lastMsg = 0;
        node.port.onmessage = function (e) {
          var d = e.data, now = performance.now();
          /* la pausa piu' lunga del thread principale vista dall'audio */
          if (lastMsg && now - lastMsg > (st.gapMax || 0)) st.gapMax = Math.round(now - lastMsg);
          lastMsg = now;
          st.under = d.under;
          var inflight = sent - d.recv;
          var deficit = target - (d.have + inflight);
          var k = 0;
          while (deficit > 0 && k++ < 8) { push(CH); deficit -= CH; }
        };
        for (var f = 0; f < target; f += CH) push(CH);    /* la coda piena prima di partire */
        node.connect(ctx.destination);
        Module.gaudioNode = node;
        st.mode = 'AudioWorklet';
        if (window.gaudioDiag) window.gaudioDiag('audio: AudioWorklet, coda ' + target + ' frame (' + Math.round(1000 * target / fs) + ' ms)');
      }).catch(function (e) {
        if (window.gaudioDiag) window.gaudioDiag('audio: AudioWorklet non parte (' + e + '), ScriptProcessor', true);
        startScriptProcessor();
      });
    } else startScriptProcessor();
    return Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * fs) | 0;
  };

  window.gaudioAudioStop = function () {
    if (Module.gaudioNullTimer) { clearInterval(Module.gaudioNullTimer); Module.gaudioNullTimer = 0; }
    if (Module.gaudioNode) { try { Module.gaudioNode.disconnect(); } catch (e) {} Module.gaudioNode = null; }
  };
})();
