/* 自動字幕：用 Whisper 在這台電腦上辨識語音（聲音不會上傳），輸出成字幕句子 */
(function () {
  'use strict';
  var RT = window.RT = window.RT || {};
  var SR = 16000;
  var WORKER_URL = (document.currentScript && document.currentScript.src || 'js/asr.js').replace(/asr\.js/, 'asr-worker.js');
  var OPENCC_URL = 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/cn2t.js';

  /* 模型：gpu = 有 WebGPU 時；gpu16 = 顯示卡支援半精度時；cpu = 沒有 WebGPU 時（null = 不支援） */
  var MODELS = {
    fast: {
      id: 'onnx-community/whisper-base', label: '快速', desc: '速度最快，適合先看大概內容，中文錯字較多',
      gpu: { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, mb: 210 },
      cpu: { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, mb: 80 }
    },
    std: {
      id: 'onnx-community/whisper-small', label: '標準', desc: '速度與準確度平衡',
      gpu: { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, mb: 590 },
      gpu16: { dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, mb: 410 },
      cpu: { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, mb: 250 }
    },
    best: {
      id: 'onnx-community/whisper-large-v3-turbo', label: '準確', desc: '最準確，需要支援 WebGPU 的顯示卡（Chrome / Edge）',
      gpu: { dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, mb: 760 }, // 實測中文和 fp16（1.6GB）一樣準，下載量少一半
      cpu: null
    }
  };
  var LANGS = [['english', '英文'], ['chinese', '中文'], ['japanese', '日文'], ['', '自動偵測（中英夾雜時用，較不穩定）']];

  var hw = null;
  async function detect() {
    if (hw) return hw;
    hw = { gpu: false, f16: false };
    try {
      var a = navigator.gpu && await navigator.gpu.requestAdapter();
      if (a) { hw.gpu = true; hw.f16 = a.features.has('shader-f16'); }
    } catch (e) { /* 沒有 WebGPU */ }
    return hw;
  }
  function variant(key, h) {
    var m = MODELS[key];
    if (h.gpu) return h.f16 && m.gpu16 ? { device: 'webgpu', v: m.gpu16 } : { device: 'webgpu', v: m.gpu };
    return m.cpu ? { device: 'wasm', v: m.cpu } : null;
  }

  /* ---------------- 背景程式 ---------------- */
  var worker = null, waiters = {}, seq = 0, onDownload = null, loadedKey = '';
  function getWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL, { type: 'module' });
    worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'download') { if (onDownload) onDownload(m.loaded, m.total); return; }
      var key = m.type === 'ready' || (m.type === 'error' && m.id === undefined) ? 'load' : m.id;
      var w = waiters[key];
      if (!w) return;
      delete waiters[key];
      if (m.type === 'error') w.reject(new Error(m.message)); else w.resolve(m);
    };
    worker.onerror = function (e) {
      var err = new Error('語音辨識程式無法啟動：' + (e.message || '未知錯誤'));
      Object.keys(waiters).forEach(function (k) { waiters[k].reject(err); });
      waiters = {};
    };
    return worker;
  }
  function ask(key, msg, transfer) {
    return new Promise(function (resolve, reject) {
      waiters[key] = { resolve: resolve, reject: reject };
      getWorker().postMessage(msg, transfer || []);
    });
  }
  function stopWorker() {
    if (worker) worker.terminate();
    worker = null; loadedKey = '';
    var err = new Error('已取消'); err.cancelled = true;
    Object.keys(waiters).forEach(function (k) { waiters[k].reject(err); });
    waiters = {};
  }

  /* ---------------- 聲音處理 ---------------- */
  async function toMono16k(buf) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ctx = new OAC(1, Math.max(1, Math.ceil(buf.duration * SR)), SR);
    var s = ctx.createBufferSource();
    s.buffer = buf; s.connect(ctx.destination); s.start();
    var r = await ctx.startRendering();
    return r.getChannelData(0);
  }
  var FR = 320; // 20ms
  function rmsFrames(x) {
    var n = Math.ceil(x.length / FR), out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0, a = i * FR, b = Math.min(x.length, a + FR);
      for (var j = a; j < b; j++) s += x[j] * x[j];
      out[i] = Math.sqrt(s / Math.max(1, b - a));
    }
    return out;
  }
  /* 切成最長 maxSec 秒的段落，盡量切在最安靜的地方（避免切斷句子）。
   * 自動偵測語言時切短一點，讓每一段各自判斷語言（中英夾雜的影片才不會被翻譯成同一種語言） */
  function splitWindows(x, rms, maxSec, minSec) {
    var MAXF = Math.floor(maxSec * SR / FR), MINF = Math.floor(minSec * SR / FR), n = rms.length, wins = [], pos = 0;
    while (pos < n) {
      var end;
      if (n - pos <= MAXF) end = n;
      else {
        var best = -1, bestV = Infinity;
        for (var f = pos + MINF; f < pos + MAXF; f++) {
          var v = 0;
          for (var k = -5; k <= 5; k++) v += rms[Math.min(n - 1, Math.max(0, f + k))];
          if (v < bestV) { bestV = v; best = f; }
        }
        end = best;
      }
      var peak = 0;
      for (var g = pos; g < end; g++) if (rms[g] > peak) peak = rms[g];
      wins.push({ a: pos * FR, b: Math.min(x.length, end * FR), silent: peak < 0.004 });
      pos = end;
    }
    return wins;
  }
  /* 估計底噪，用來判斷「有聲音」的門檻 */
  function speechThreshold(rms) {
    var s = Array.prototype.slice.call(rms).sort(function (a, b) { return a - b; });
    var floor = s[Math.floor(s.length * 0.15)] || 0;
    return Math.max(0.006, floor * 3);
  }
  /* 把一句的開頭、結尾對齊到實際有聲音的地方（去掉前後的空白） */
  function trimToSpeech(rms, thr, a, b) {
    var fa = Math.max(0, Math.floor(a * SR / FR)), fb = Math.min(rms.length - 1, Math.ceil(b * SR / FR));
    // 找出有聲音的區段（中間停頓不到 0.16 秒視為同一段）
    var runs = [], s = -1, last = -1;
    for (var f = fa; f <= fb; f++) {
      if (rms[f] < thr) continue;
      if (s < 0) s = f; else if (f - last > 8) { runs.push([s, last]); s = f; }
      last = f;
    }
    if (s >= 0) runs.push([s, last]);
    // 頭尾很短的聲音（多半是上一句的尾巴、下一句的開頭）不算
    while (runs.length > 1 && runs[0][1] - runs[0][0] < 15) runs.shift();
    while (runs.length > 1 && runs[runs.length - 1][1] - runs[runs.length - 1][0] < 15) runs.pop();
    if (!runs.length) return [a, b];
    var i = runs[0][0], j = runs[runs.length - 1][1];
    if (j - i < 10) return [a, b]; // 找不到明顯的聲音（例如有背景音樂）→ 不調整
    return [Math.max(a, i * FR / SR - 0.1), Math.min(b, (j + 1) * FR / SR + 0.15)];
  }
  function meanRms(rms, t0, t1) {
    var a = Math.max(0, Math.floor(t0 * SR / FR)), b = Math.min(rms.length, Math.ceil(t1 * SR / FR));
    if (b <= a) return 0;
    var s = 0;
    for (var i = a; i < b; i++) s += rms[i];
    return s / (b - a);
  }

  /* ---------------- 文字處理 ---------------- */
  var cc = null;
  function loadOpenCC() {
    if (cc) return Promise.resolve(cc);
    return new Promise(function (resolve) {
      if (window.OpenCC) { cc = window.OpenCC.Converter({ from: 'cn', to: 'twp' }); resolve(cc); return; }
      var s = document.createElement('script');
      s.src = OPENCC_URL;
      s.onload = function () { try { cc = window.OpenCC.Converter({ from: 'cn', to: 'twp' }); } catch (e) { cc = null; } resolve(cc); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
  }
  // Whisper 在沒人說話（純音樂、靜音）時常出現的幻覺句
  var SPAM = /(字幕|字幕組|字幕由|Amara|點贊|点赞|訂閱|订阅|打賞|打赏|明鏡|明镜|請不吝|请不吝|感謝觀看|感谢观看|Subtitles by|Thanks for watching|Thank you for watching)/i;
  var CJK_RE = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;
  function isCJK(s) {
    var letters = s.replace(/[\s\d\p{P}\p{S}]/gu, '');
    return !!letters.length && (s.match(CJK_RE) || []).length / letters.length >= 0.5;
  }
  function cjkLen(s) { return s.replace(/[\s\p{P}\p{S}]/gu, '').length; }
  function cjkSlice(s, n) { // 取前 n 個字（不算標點），回傳 [前段, 後段]
    var c = 0;
    for (var i = 0; i < s.length; i++) {
      if (!/[\s\p{P}\p{S}]/u.test(s[i])) { c++; if (c > n) return [s.slice(0, i), s.slice(i)]; }
    }
    return [s, ''];
  }
  /* 詞彙修正（專有名詞常被聽錯）：每行「聽錯的字=正確的字」，存在這台電腦 */
  var FIX_DEFAULT = '宏奇=宏碁\n宏基=宏碁\n鴻基=宏碁\n鴻碁=宏碁\n洪基=宏碁';
  function fixesText() { try { var v = localStorage.getItem('rt_asr_fixes'); return v === null ? FIX_DEFAULT : v; } catch (e) { return FIX_DEFAULT; } }
  function applyFixes(s) {
    fixesText().split('\n').forEach(function (line) {
      var i = line.indexOf('=');
      if (i <= 0) return;
      var from = line.slice(0, i).trim(), to = line.slice(i + 1).trim();
      if (from) s = s.split(from).join(to);
    });
    return s;
  }
  function cleanCjkLine(s) { return s.replace(/[，。、；,;]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* 一段辨識結果 → 符合字幕規範的多句（依字數平均分配時間） */
  function segToLines(text, R) {
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return [];
    if (isCJK(text)) {
      var max = R.cjkLine || 16, out = [], cur = '';
      text.split(/(?<=[，。！？；、,.!?;：:])/).forEach(function (p) {
        p = p.trim();
        if (!p) return;
        if (cjkLen(cur + p) <= max) { cur += p; return; }
        if (cur) out.push(cur);
        while (cjkLen(p) > max) { var sp = cjkSlice(p, max); out.push(sp[0]); p = sp[1]; }
        cur = p;
      });
      if (cur) out.push(cur);
      return out.map(cleanCjkLine).filter(Boolean);
    }
    var maxL = R.latinLine || 42, lines = Math.max(1, Math.min(2, R.maxLines || 2)), cues = [];
    text.split(/(?<=[.!?])\s+/).forEach(function (sent) {
      var ls = [], line = '';
      sent.split(' ').forEach(function (w) {
        if (!w) return;
        if (line && (line + ' ' + w).length > maxL) { ls.push(line); line = w; } else line = line ? line + ' ' + w : w;
      });
      if (line) ls.push(line);
      for (var i = 0; i < ls.length; i += lines) cues.push(ls.slice(i, i + lines).join('\n'));
    });
    return cues;
  }

  function buildCues(segs, total, R) {
    var cues = [];
    segs.forEach(function (s) {
      var parts = segToLines(s.text, R);
      if (!parts.length) return;
      var dur = Math.min(s.end - s.start, Math.max(R.maxDur || 7, 1) * parts.length);
      var weights = parts.map(function (p) { return Math.max(1, isCJK(p) ? cjkLen(p) : p.length); });
      var sum = weights.reduce(function (a, b) { return a + b; }, 0), t = s.start;
      parts.forEach(function (p, i) {
        var d = dur * weights[i] / sum;
        cues.push({ start: t, end: Math.min(t + d, t + (R.maxDur || 7)), text: p });
        t += d;
      });
    });
    cues.sort(function (a, b) { return a.start - b.start; });
    var minDur = R.minDur || 0.83;
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i], next = cues[i + 1];
      var limit = next ? next.start : total;
      if (c.end - c.start < minDur) c.end = Math.min(c.start + minDur, limit);
      if (c.end > limit) c.end = limit;
      if (c.end <= c.start) c.end = c.start + 0.04;
    }
    return cues;
  }

  RT.srtTime = function (sec) {
    var ms = Math.max(0, Math.round(sec * 1000));
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(ms % 1000, 3);
  };
  RT.buildSrt = function (cues) {
    return cues.map(function (c, i) {
      return (i + 1) + '\n' + RT.srtTime(c.start) + ' --> ' + RT.srtTime(c.end) + '\n' + (c.raw != null ? c.raw : c.text);
    }).join('\n\n') + '\n';
  };

  /* ---------------- 對外 ---------------- */
  var running = false;
  RT.asr = {
    MODELS: MODELS, LANGS: LANGS, detect: detect,
    fixesText: fixesText,
    setFixes: function (t) { try { if (t === null) localStorage.removeItem('rt_asr_fixes'); else localStorage.setItem('rt_asr_fixes', t); } catch (e) { /* ignore */ } },
    FIX_DEFAULT: FIX_DEFAULT,
    variant: function (key) { return hw ? variant(key, hw) : null; },
    get running() { return running; },
    cancel: stopWorker,
    /* src = { file } 或 { url }；onProgress(stage, ratio, info)；回傳 { srt, cues, device } */
    transcribe: async function (src, opt, onProgress) {
      if (running) throw new Error('已經在辨識中');
      running = true;
      var prog = onProgress || function () {};
      try {
        var h = await detect();
        var vr = variant(opt.model, h);
        if (!vr) throw new Error('這台電腦的瀏覽器不支援 WebGPU，無法使用「' + MODELS[opt.model].label + '」模式，請改選「標準」或「快速」');
        prog('decode', 0);
        var buf = await RT.decodeAudio(src);
        var x = await toMono16k(buf);
        var total = x.length / SR;
        var rms = rmsFrames(x);

        prog('model', 0);
        var key = MODELS[opt.model].id + '|' + vr.device + '|' + JSON.stringify(vr.v.dtype);
        if (loadedKey !== key) {
          onDownload = function (l, t) { prog('model', t ? l / t : 0, { loaded: l, total: t }); };
          try {
            await ask('load', { type: 'load', model: MODELS[opt.model].id, device: vr.device, dtype: vr.v.dtype });
          } catch (e) {
            if (e.cancelled || vr.device !== 'webgpu' || !MODELS[opt.model].cpu) throw e;
            // WebGPU 失敗 → 改用 CPU
            vr = { device: 'wasm', v: MODELS[opt.model].cpu };
            key = MODELS[opt.model].id + '|wasm|' + JSON.stringify(vr.v.dtype);
            await ask('load', { type: 'load', model: MODELS[opt.model].id, device: 'wasm', dtype: vr.v.dtype });
          }
          loadedKey = key;
          onDownload = null;
        }

        var wins = opt.language ? splitWindows(x, rms, 28, 14) : splitWindows(x, rms, 12, 3);
        var thr = speechThreshold(rms), segs = [], t0 = Date.now(), doneSec = 0;
        var speechSec = wins.reduce(function (s, w) { return s + (w.silent ? 0 : (w.b - w.a) / SR); }, 0) || 1;
        prog('asr', 0, { segs: segs, total: total });
        for (var i = 0; i < wins.length; i++) {
          var w = wins[i];
          if (w.silent) continue;
          var chunk = x.slice(w.a, w.b);
          var res = await ask(++seq, { type: 'run', id: seq, audio: chunk, language: opt.language || null }, [chunk.buffer]);
          var off = w.a / SR, wEnd = w.b / SR;
          (res.chunks || []).forEach(function (c) {
            var a = off + (c.ts && c.ts[0] != null ? c.ts[0] : 0);
            var b = c.ts && c.ts[1] != null ? off + c.ts[1] : wEnd;
            var text = String(c.text || '').trim();
            if (!text || b <= a) return;
            if (SPAM.test(text) && text.length < 40) return;
            if (/^[(\[（【♪♫*].*[)\]）】♪♫*]$/.test(text) || /^[♪♫\s.。…]+$/.test(text)) return; // (音樂)、[Music]、♪ 之類的聲音標記
            if (meanRms(rms, a, b) < 0.003) return; // 幾乎無聲 → 幻覺
            var prev = segs[segs.length - 1], prev2 = segs[segs.length - 2];
            if (prev && prev2 && prev.text === text && prev2.text === text) return; // 重複鬼打牆
            var tr = trimToSpeech(rms, thr, Math.max(off, a), Math.min(wEnd, Math.max(b, a + 0.2)));
            segs.push({ start: tr[0], end: tr[1], text: text });
          });
          doneSec += (w.b - w.a) / SR;
          var el = (Date.now() - t0) / 1000;
          prog('asr', doneSec / speechSec, { segs: segs, total: total, eta: doneSec ? el / doneSec * (speechSec - doneSec) : null });
        }

        prog('finish', 1);
        var conv = await loadOpenCC();
        segs.forEach(function (s) { s.text = applyFixes(conv ? conv(s.text) : s.text); });
        var cues = buildCues(segs, total, RT.subRules());
        return { cues: cues, srt: RT.buildSrt(cues), device: vr.device, segs: segs.length, total: total };
      } finally {
        running = false; onDownload = null;
      }
    }
  };
})();
