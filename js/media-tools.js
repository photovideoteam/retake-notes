/* 字幕（SRT / VTT）與聲音（音量表、整段分析）工具 */
(function () {
  'use strict';
  var RT = window.RT = window.RT || {};

  /* =====================================================================
   * 字幕
   * ===================================================================== */

  /* 讀取文字檔：自動判斷 UTF-8 / UTF-16 / Big5 */
  RT.decodeText = function (buf) {
    var b = new Uint8Array(buf);
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b);
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { /* 不是 UTF-8 */ }
    try { return new TextDecoder('big5').decode(b); } catch (e) { /* 瀏覽器不支援 big5 */ }
    return new TextDecoder('utf-8').decode(b);
  };

  function parseTime(s) {
    var p = s.replace(',', '.').split(':');
    var sec = parseFloat(p.pop()), mult = 60;
    while (p.length) { sec += parseInt(p.pop(), 10) * mult; mult *= 60; }
    return sec;
  }

  /* 解析 SRT / WebVTT → { cues: [{ n, id, start, end, text, raw }], errors: [] } */
  RT.parseSubtitles = function (text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    var isVtt = /^WEBVTT/.test(text);
    var timeRe = /((?:\d+:)?\d{1,2}:\d{1,2}[,.]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}[,.]\d{1,3})/;
    var cues = [], errors = [];
    text.split(/\n[ \t]*\n+/).forEach(function (block, bi) {
      var lines = block.split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!lines.length) return;
      if (isVtt && (/^WEBVTT/.test(lines[0]) || /^(NOTE|STYLE|REGION)\b/.test(lines[0]))) return;
      var ti = -1;
      for (var i = 0; i < lines.length; i++) if (timeRe.test(lines[i])) { ti = i; break; }
      if (ti < 0) { errors.push('第 ' + (bi + 1) + ' 段找不到時間碼：「' + lines[0].slice(0, 30) + '」'); return; }
      var m = timeRe.exec(lines[ti]);
      var raw = lines.slice(ti + 1).join('\n');
      cues.push({ n: cues.length + 1, id: ti > 0 ? lines[ti - 1].trim() : '', start: parseTime(m[1]), end: parseTime(m[2]), raw: raw, text: RT.subPlain(raw) });
    });
    return { cues: cues, errors: errors };
  };

  /* 去掉 <i> <font> {\an8} 等標籤，只留文字 */
  RT.subPlain = function (raw) {
    return String(raw || '').replace(/\{\\[^}]*\}/g, '').replace(/<[^>]+>/g, '');
  };
  /* 顯示用：保留 <i> <b> <u>，其他標籤移除 */
  RT.subHTML = function (raw) {
    var s = String(raw || '').replace(/\{\\[^}]*\}/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/&lt;(\/?)([ibu])&gt;/gi, '<$1$2>').replace(/&lt;\/?[^&]*?&gt;/g, '');
    return s.replace(/\n/g, '<br>');
  };
  RT.subIsTop = function (raw) { return /\{\\an[789]\}/.test(String(raw || '')); };

  var CJK_RE = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;
  function isCJK(s) {
    var letters = s.replace(/[\s\d\p{P}\p{S}]/gu, '');
    if (!letters.length) return false;
    return (s.match(CJK_RE) || []).length / letters.length >= 0.5;
  }

  RT.SUB_RULES_DEFAULT = { cjkCps: 9, cjkLine: 16, latinCps: 20, latinLine: 42, maxLines: 2, minDur: 0.83, maxDur: 7, minGapFrames: 2 };
  RT.subRules = function () {
    var r = Object.assign({}, RT.SUB_RULES_DEFAULT);
    try { Object.assign(r, JSON.parse(localStorage.getItem('rt_sub_rules') || '{}')); } catch (e) { /* ignore */ }
    return r;
  };

  /* 依影片 fps 換算格數，並逐句檢查。offsetFrames：SRT 0 秒對應的格數偏移 */
  RT.checkSubtitles = function (cues, o) {
    var R = o.rules || RT.subRules();
    var fps = o.exactFps, total = o.total || 0;
    cues.forEach(function (c) {
      c.inF = Math.round(c.start * fps) - (o.offsetFrames || 0);
      c.outF = Math.max(c.inF, Math.round(c.end * fps) - 1 - (o.offsetFrames || 0));
      c.dur = c.end - c.start;
      var flat = c.text.replace(/\n/g, '');
      var cjk = isCJK(flat);
      c.cjk = cjk;
      c.chars = cjk ? flat.replace(/[\s\p{P}\p{S}]/gu, '').length : flat.length; // 中文不算標點與空白
      c.cps = c.dur > 0 ? c.chars / c.dur : 0;
      c.lineLens = c.text.split('\n').map(function (l) { return cjk ? l.replace(/[\s\p{P}\p{S}]/gu, '').length : l.length; });
      var w = [];
      if (!c.text.trim()) w.push(['warn', '空白字幕']);
      if (c.dur <= 0) w.push(['err', '結束時間不晚於開始時間']);
      else {
        if (c.dur < R.minDur) w.push(['warn', '顯示太短（' + c.dur.toFixed(2) + ' 秒）']);
        if (c.dur > R.maxDur) w.push(['warn', '顯示太長（' + c.dur.toFixed(1) + ' 秒）']);
        var cpsMax = cjk ? R.cjkCps : R.latinCps;
        if (c.chars && c.cps > cpsMax) w.push(['warn', '閱讀速度太快（每秒 ' + c.cps.toFixed(1) + ' 字，上限 ' + cpsMax + '）']);
      }
      if (c.lineLens.length > R.maxLines) w.push(['warn', c.lineLens.length + ' 行（上限 ' + R.maxLines + ' 行）']);
      var lineMax = cjk ? R.cjkLine : R.latinLine;
      var longest = Math.max.apply(null, c.lineLens.concat([0]));
      if (longest > lineMax) w.push(['warn', '一行 ' + longest + ' 字（上限 ' + lineMax + '）']);
      if (total && c.inF >= total) w.push(['err', '整句超出影片長度']);
      else if (total && c.outF >= total) w.push(['warn', '結束時間超出影片長度']);
      if (c.inF < 0) w.push(['err', '開始時間早於影片開頭']);
      c.warn = w;
    });
    for (var i = 0; i < cues.length - 1; i++) {
      var a = cues[i], b = cues[i + 1];
      if (b.start < a.end) {
        a.warn.push(['err', '和下一句（#' + b.n + '）時間重疊']);
        b.warn.push(['err', '和上一句（#' + a.n + '）時間重疊']);
      } else {
        var gap = b.inF - a.outF - 1;
        if (gap > 0 && gap < R.minGapFrames) a.warn.push(['info', '和下一句只間隔 ' + gap + ' 格']);
      }
      if (b.start < a.start) b.warn.push(['err', '時間比上一句早（順序錯亂）']);
    }
    cues.forEach(function (c) {
      c.level = c.warn.some(function (x) { return x[0] === 'err'; }) ? 'err' : c.warn.some(function (x) { return x[0] === 'warn'; }) ? 'warn' : c.warn.length ? 'info' : '';
    });
    return cues;
  };

  /* =====================================================================
   * 即時音量表（播放時讀取）
   * ===================================================================== */
  var SIZE = 4096; // 48kHz 約 85ms，比每次畫面更新的間隔長，不會漏掉樣本

  function AudioMeter(video) {
    this.video = video;
    this.ctx = null;
    this.handlers = {};
  }
  AudioMeter.prototype.on = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; };
  AudioMeter.prototype.emit = function (ev, a) { (this.handlers[ev] || []).forEach(function (fn) { fn(a); }); };

  /* 接上 Web Audio。注意：一個 video 只能接一次，接上後聲音改由 Web Audio 輸出 */
  AudioMeter.prototype.attach = function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('這個瀏覽器不支援音量表（Web Audio）');
    var ctx = this.ctx = new AC();
    var src = ctx.createMediaElementSource(this.video);
    src.connect(ctx.destination);
    // 先混成立體聲：單聲道 → 左右相同；5.1 → 依標準降混成立體聲
    var mix = ctx.createGain();
    mix.channelCount = 2; mix.channelCountMode = 'explicit'; mix.channelInterpretation = 'speakers';
    var split = ctx.createChannelSplitter(2);
    src.connect(mix); mix.connect(split);
    this.an = [0, 1].map(function (ch) {
      var a = ctx.createAnalyser();
      a.fftSize = SIZE; a.smoothingTimeConstant = 0;
      split.connect(a, ch);
      return a;
    });
    this.buf = new Float32Array(SIZE);
    var self = this;
    this._onPlay = function () { if (self.ctx.state !== 'running') self.ctx.resume(); };
    this.video.addEventListener('play', this._onPlay);
    ctx.resume();
  };

  /* 目前的峰值與 RMS（線性 0–1，可能大於 1） */
  AudioMeter.prototype.read = function () {
    var out = { peak: [0, 0], rms: [0, 0] };
    if (!this.ctx) return out;
    for (var ch = 0; ch < 2; ch++) {
      this.an[ch].getFloatTimeDomainData(this.buf);
      var pk = 0, sum = 0, b = this.buf;
      for (var i = 0; i < b.length; i++) { var v = b[i], a = v < 0 ? -v : v; if (a > pk) pk = a; sum += v * v; }
      out.peak[ch] = pk; out.rms[ch] = Math.sqrt(sum / b.length);
    }
    return out;
  };

  AudioMeter.prototype.close = function () {
    if (!this.ctx) return;
    this.video.removeEventListener('play', this._onPlay);
    try { this.ctx.close(); } catch (e) { /* ignore */ }
    this.ctx = null;
  };

  RT.AudioMeter = AudioMeter;
  RT.toDb = function (lin) { return lin > 0 ? 20 * Math.log10(lin) : -Infinity; };
  RT.fmtDb = function (db, digits) { return isFinite(db) ? (db > 0 ? '+' : '') + db.toFixed(digits === undefined ? 1 : digits) : '-∞'; };

  /* 畫垂直音量表（L / R） */
  RT.drawMeter = function (canvas, st, thrDb) {
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    }
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    var TOP = 26, BOT = 34, MIN = -60, MAX = 3;
    var h = ch - TOP - BOT;
    var y = function (db) { return TOP + (1 - (Math.max(MIN, Math.min(MAX, db)) - MIN) / (MAX - MIN)) * h; };
    var barW = 16, gap = 22, x0 = cw - (barW * 2 + gap) - 8;
    // 刻度
    g.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono');
    g.textAlign = 'right'; g.textBaseline = 'middle';
    [0, -3, -6, -12, -18, -24, -36, -48, -60].forEach(function (d) {
      g.fillStyle = d === 0 ? '#ff4466' : '#7a7a7a';
      g.fillText(String(d), x0 - 4, y(d));
      g.fillStyle = 'rgba(255,255,255,.08)';
      g.fillRect(x0, Math.round(y(d)), barW * 2 + gap, 1);
    });
    // 上限線
    g.fillStyle = 'rgba(255,178,30,.9)';
    g.fillRect(x0 - 2, Math.round(y(thrDb)), barW * 2 + gap + 4, 1);
    ['L', 'R'].forEach(function (lbl, i) {
      var x = x0 + i * (barW + gap);
      g.fillStyle = '#161616'; g.fillRect(x, TOP, barW, h);
      var db = st.peakDb[i];
      if (isFinite(db) && db > MIN) {
        var grad = g.createLinearGradient(0, y(MAX), 0, y(MIN));
        grad.addColorStop(0, '#ff4466');
        grad.addColorStop((MAX - thrDb) / (MAX - MIN), '#ff4466');
        grad.addColorStop((MAX - thrDb) / (MAX - MIN) + 0.0001, '#ffb21e');
        grad.addColorStop((MAX + 12) / (MAX - MIN), '#ffb21e');
        grad.addColorStop((MAX + 12) / (MAX - MIN) + 0.0001, '#2fd27f');
        grad.addColorStop(1, '#2fd27f');
        g.fillStyle = grad;
        g.fillRect(x, y(db), barW, TOP + h - y(db));
      }
      // RMS 細線
      if (isFinite(st.rmsDb[i]) && st.rmsDb[i] > MIN) { g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x, Math.round(y(st.rmsDb[i])), barW, 2); }
      // 峰值保持
      if (isFinite(st.holdDb[i]) && st.holdDb[i] > MIN) {
        g.fillStyle = st.holdDb[i] >= thrDb ? '#ff4466' : '#ffffff';
        g.fillRect(x, Math.round(y(st.holdDb[i])) - 1, barW, 2);
      }
      // 爆音燈
      g.fillStyle = st.clip[i] ? '#ff4466' : st.over[i] ? '#ffb21e' : '#262626';
      g.fillRect(x, 4, barW, 14);
      g.fillStyle = '#9a9a9a'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText(lbl, x + barW / 2, ch - 22);
      g.fillStyle = st.maxDb[i] >= thrDb ? '#ff4466' : '#d8d8d8';
      g.fillText(isFinite(st.maxDb[i]) ? st.maxDb[i].toFixed(1) : '-∞', x + barW / 2, ch - 8);
      g.textAlign = 'right'; g.textBaseline = 'middle';
    });
  };

  /* =====================================================================
   * 整段分析（不用播放，直接解碼整個檔案的聲音）
   * ===================================================================== */
  RT.decodeAudio = async function (src) {
    var ab;
    if (src.file) ab = await src.file.arrayBuffer();
    else {
      var r;
      try { r = await fetch(src.url, { mode: 'cors' }); } catch (e) { throw new Error('這個雲端連結不允許讀取檔案內容，無法整段分析（請改用本機檔案）'); }
      if (!r.ok) throw new Error('下載影片失敗（' + r.status + '）');
      ab = await r.arrayBuffer();
    }
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ctx = new OAC(2, 48000, 48000);
    try { return await ctx.decodeAudioData(ab); }
    catch (e) { throw new Error('無法讀取這個檔案的聲音（可能沒有音軌，或音訊格式瀏覽器不支援）'); }
  };

  /* BS.1770 K 加權濾波係數（依取樣率計算） */
  function kWeight(rate) {
    var f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    var K = Math.tan(Math.PI * f0 / rate), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    var a0 = 1 + K / Q + K * K;
    var s1 = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    f0 = 38.13547087602444; Q = 0.5003270373238773;
    K = Math.tan(Math.PI * f0 / rate);
    var d = 1 + K / Q + K * K;
    var s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / d, (1 - K / Q + K * K) / d] };
    return [s1, s2];
  }

  /* 4 倍超取樣插值係數（估算 True Peak 用；Hann 視窗 sinc，左右各 8 點） */
  var TP_TAPS = 8, TP_COEF = [1, 2, 3].map(function (k) {
    var t = k / 4, row = [];
    for (var j = -TP_TAPS + 1; j <= TP_TAPS; j++) {
      var x = t - j, s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      var w = 0.5 * (1 + Math.cos(Math.PI * x / TP_TAPS));
      row.push(Math.abs(x) >= TP_TAPS ? 0 : s * w);
    }
    return row;
  });

  /* 分析 AudioBuffer。thrDb：上限（超過就列出時間）。onProgress(0–1) */
  RT.analyzeAudio = async function (buffer, thrDb, onProgress) {
    var sr = buffer.sampleRate, nch = buffer.numberOfChannels, len = buffer.length;
    var thr = Math.pow(10, thrDb / 20), clipLin = 0.99989; // 約 -0.001 dBFS 視為爆音（數位滿格）
    var peak = [], tpk = [], clipSamples = [], hits = [];
    var weights = nch === 6 ? [1, 1, 1, 0, 1.41, 1.41] : null;
    var blockLen = Math.round(sr * 0.4), hop = Math.round(sr * 0.1);
    var nBlocks = len >= blockLen ? Math.floor((len - blockLen) / hop) + 1 : 0;
    var blockPow = new Float64Array(nBlocks);
    var shortLen = sr * 3, nShort = len >= shortLen ? Math.floor((len - shortLen) / hop) + 1 : 0;
    var shortPow = new Float64Array(nShort);
    var flt = kWeight(sr);
    var tick = Date.now();

    for (var c = 0; c < nch; c++) {
      var x = buffer.getChannelData(c), pk = 0, tp = 0, clips = 0;
      var wgt = weights ? weights[c] : 1;
      // 峰值、爆音、超過上限的區段
      var runStart = -1, runMax = 0, lastHit = -1e9, mergeGap = Math.round(sr * 0.25);
      for (var i = 0; i < len; i++) {
        var v = x[i], a = v < 0 ? -v : v;
        if (a > pk) pk = a;
        if (a >= clipLin) clips++;
        if (a >= thr) {
          if (runStart < 0 || i - lastHit > mergeGap) {
            if (runStart >= 0) hits.push({ ch: c, start: runStart / sr, end: lastHit / sr, max: runMax });
            runStart = i; runMax = 0;
          }
          if (a > runMax) runMax = a;
          lastHit = i;
        }
        // True Peak：只在接近滿格的地方插值，節省時間
        if (a >= 0.5 && i + TP_TAPS < len && i - TP_TAPS + 1 >= 0) {
          for (var k = 0; k < 3; k++) {
            var row = TP_COEF[k], s = 0;
            for (var j = 0; j < row.length; j++) s += row[j] * x[i - TP_TAPS + 1 + j];
            if (s < 0) s = -s;
            if (s > tp) tp = s;
          }
        }
        if ((i & 0xFFFFF) === 0 && Date.now() - tick > 120) {
          tick = Date.now();
          if (onProgress) onProgress((c + i / len * 0.5) / nch);
          await new Promise(function (r) { setTimeout(r, 0); });
        }
      }
      if (runStart >= 0) hits.push({ ch: c, start: runStart / sr, end: lastHit / sr, max: runMax });
      peak.push(pk); tpk.push(Math.max(tp, pk)); clipSamples.push(clips);

      // 響度：K 加權後計算每個 400ms 區塊的均方值
      if (wgt && nBlocks) {
        var y = new Float32Array(len);
        flt.forEach(function (f) {
          var x1 = 0, x2 = 0, y1 = 0, y2 = 0, src = f === flt[0] ? x : y; // 第二級直接在 y 上原地計算
          for (var n = 0; n < len; n++) {
            var xi = src[n];
            var yi = f.b[0] * xi + f.b[1] * x1 + f.b[2] * x2 - f.a[0] * y1 - f.a[1] * y2;
            x2 = x1; x1 = xi; y2 = y1; y1 = yi;
            y[n] = yi;
          }
        });
        // 前綴和（雙精度）方便算各區塊
        var cum = new Float64Array(len + 1);
        for (var n2 = 0; n2 < len; n2++) cum[n2 + 1] = cum[n2] + y[n2] * y[n2];
        for (var b = 0; b < nBlocks; b++) {
          var st = b * hop;
          blockPow[b] += wgt * (cum[st + blockLen] - cum[st]) / blockLen;
        }
        for (var b3 = 0; b3 < nShort; b3++) {
          var st3 = b3 * hop;
          shortPow[b3] += wgt * (cum[st3 + shortLen] - cum[st3]) / shortLen;
        }
      }
      if (onProgress) onProgress((c + 1) / nch);
      await new Promise(function (r) { setTimeout(r, 0); });
    }

    // 整合響度（EBU R128 / ITU-R BS.1770：-70 LUFS 絕對門檻＋相對 -10 LU 門檻）
    var lufs = -Infinity;
    var L = function (p) { return -0.691 + 10 * Math.log10(p); };
    var abs = [];
    for (var bi = 0; bi < nBlocks; bi++) if (blockPow[bi] > 0 && L(blockPow[bi]) > -70) abs.push(blockPow[bi]);
    if (abs.length) {
      var mean = abs.reduce(function (s, p) { return s + p; }, 0) / abs.length;
      var rel = L(mean) - 10;
      var gated = abs.filter(function (p) { return L(p) > rel; });
      if (gated.length) lufs = L(gated.reduce(function (s, p) { return s + p; }, 0) / gated.length);
    }
    // 短時響度（3 秒視窗）最大值
    var stMax = -Infinity;
    for (var s3 = 0; s3 < nShort; s3++) if (shortPow[s3] > 0) { var l3 = L(shortPow[s3]); if (l3 > stMax) stMax = l3; }
    hits.sort(function (a, b) { return a.start - b.start || a.ch - b.ch; });
    return {
      sampleRate: sr, channels: nch, duration: len / sr,
      peakDb: peak.map(RT.toDb), truePeakDb: tpk.map(RT.toDb), clipSamples: clipSamples,
      lufs: lufs, shortTermMax: stMax, hits: hits, thrDb: thrDb
    };
  };
})();
