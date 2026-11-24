/* 逐格精準播放器 */
(function () {
  'use strict';
  var RT = window.RT = window.RT || {};
  var TC = RTCore.TC;

  function Player(video) {
    this.video = video;
    this.fps = 24; this.exactFps = 24; this.df = false; this.startFrames = 0; this.total = 0;
    this.frame = 0; this.playing = false; this.rate = 1; this.reverse = 0;
    this.loop = { on: false, inF: null, outF: null };
    this.handlers = {};
    this.pendingSeek = null;
    this.objectUrl = null;
    var self = this;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('play', function () { self._setPlaying(true); });
    video.addEventListener('pause', function () { if (!self.reverse) self._setPlaying(false); });
    video.addEventListener('ended', function () {
      if (self.loop.on) { self.seekFrame(self.loop.inF !== null ? self.loop.inF : 0); self.video.play(); }
      else self._setPlaying(false);
    });
    video.addEventListener('seeked', function () {
      if (self.pendingSeek !== null) {
        var f = self.pendingSeek; self.pendingSeek = null; self._doSeek(f);
      } else self.emit('seeked', self.frame);
    });
    video.addEventListener('loadedmetadata', function () { self.emit('meta'); });
    video.addEventListener('timeupdate', function () {
      if (!self.hasRVFC && self.playing) self._updateFromTime();
    });
    this.hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    if (this.hasRVFC) {
      var cb = function (now, meta) {
        if (self.playing && !self.reverse) {
          var f = Math.round(meta.mediaTime * self.exactFps);
          self._setFrame(f);
        }
        video.requestVideoFrameCallback(cb);
      };
      video.requestVideoFrameCallback(cb);
    }
  }

  Player.prototype.on = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; };
  Player.prototype.emit = function (ev, a) { (this.handlers[ev] || []).forEach(function (fn) { fn(a); }); };

  Player.prototype.load = function (src) {
    var self = this, v = this.video;
    this.unload();
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok() { if (done) return; done = true; cleanup(); resolve(); }
      function fail() {
        if (done) return;
        // 跨網域失敗時，改成不帶 CORS 再試一次（可以播放，但無法自動截圖）
        if (src.url && v.crossOrigin) {
          v.removeAttribute('crossorigin');
          self.tainted = true;
          v.src = src.url; v.load();
          return;
        }
        done = true; cleanup();
        reject(new Error('影片無法載入：請確認檔案是瀏覽器可播放的 mp4（H.264/H.265）或連結可公開存取'));
      }
      function cleanup() { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', fail); }
      v.addEventListener('loadeddata', ok);
      v.addEventListener('error', fail);
      self.tainted = false;
      if (src.file) {
        v.removeAttribute('crossorigin');
        self.objectUrl = URL.createObjectURL(src.file);
        v.src = self.objectUrl;
      } else {
        v.crossOrigin = 'anonymous';
        v.src = src.url;
      }
      v.load();
    });
  };

  Player.prototype.unload = function () {
    this.pause();
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.video.removeAttribute('src');
    try { this.video.load(); } catch (e) { /* ignore */ }
    this.frame = 0;
  };

  Player.prototype.loaded = function () { return this.video.readyState >= 1 && !!this.video.currentSrc; };

  Player.prototype.setMeta = function (m) {
    if (m.fps) { this.fps = Number(m.fps); this.exactFps = TC.exact(this.fps); }
    if (m.df !== undefined) this.df = !!m.df && TC.isDFCapable(this.fps);
    if (m.startTC !== undefined) {
      var s = TC.tcToFrames(m.startTC || '00:00:00:00', this.fps, this.df);
      this.startFrames = isFinite(s) ? s : 0;
    }
    var fromDuration = this.video.duration && isFinite(this.video.duration) ? Math.round(this.video.duration * this.exactFps) : 0;
    this.total = m.total || fromDuration || this.total || 0;
    this.emit('frame', this.frame);
  };

  Player.prototype.tc = function (frame) {
    return TC.framesToTC(this.startFrames + (frame === undefined ? this.frame : frame), this.fps, this.df);
  };
  Player.prototype.parseTC = function (str) {
    str = String(str || '').trim();
    if (/^\d{1,6}$/.test(str)) return Number(str); // 純數字 = 格數
    var f = TC.tcToFrames(str, this.fps, this.df);
    if (!isFinite(f)) return NaN;
    return f - this.startFrames;
  };

  Player.prototype._setFrame = function (f) {
    f = Math.max(0, Math.min(this.total ? this.total - 1 : f, f));
    if (this.loop.on && this.playing && !this.reverse && this.loop.outF !== null && f >= this.loop.outF) {
      this.seekFrame(this.loop.inF !== null ? this.loop.inF : 0);
      return;
    }
    if (f !== this.frame) { this.frame = f; this.emit('frame', f); }
  };
  Player.prototype._updateFromTime = function () {
    this._setFrame(Math.floor(this.video.currentTime * this.exactFps + 1e-4));
  };
  Player.prototype._setPlaying = function (p) {
    if (this.playing === p) return;
    this.playing = p;
    this.emit('state', p);
  };

  Player.prototype._doSeek = function (f) {
    this.video.currentTime = (f + 0.5) / this.exactFps; // 對準該格中間，避免浮點誤差跳到前一格
  };
  Player.prototype.seekFrame = function (f) {
    if (!this.loaded()) return;
    f = Math.round(f);
    if (this.total) f = Math.max(0, Math.min(this.total - 1, f));
    else f = Math.max(0, f);
    this.frame = f;
    this.emit('frame', f);
    if (this.video.seeking) this.pendingSeek = f;
    else this._doSeek(f);
  };
  Player.prototype.step = function (n) {
    this.pause();
    this.seekFrame((this.pendingSeek !== null ? this.pendingSeek : this.frame) + n);
  };

  Player.prototype.play = function () {
    if (!this.loaded()) return;
    this._stopReverse();
    if (this.loop.on && this.loop.inF !== null && this.loop.outF !== null && (this.frame >= this.loop.outF || this.frame < this.loop.inF)) {
      this.seekFrame(this.loop.inF);
    } else if (this.total && this.frame >= this.total - 1) {
      this.seekFrame(0);
    }
    this.video.playbackRate = this.rate;
    var p = this.video.play();
    if (p && p.catch) p.catch(function () { /* 使用者尚未互動 */ });
  };
  Player.prototype.pause = function () {
    var wasReverse = !!this.reverse;
    var wasPlaying = !this.video.paused;
    this._stopReverse();
    if (wasPlaying) this.video.pause();
    if (wasReverse) this._setPlaying(false);
    if (wasPlaying && this.loaded() && !this.video.seeking) {
      // 停下來後對齊到整格
      this._updateFromTime();
      this._doSeek(this.frame);
    }
  };
  Player.prototype.toggle = function () { if (this.playing) this.pause(); else this.play(); };

  Player.prototype.setRate = function (r) {
    this.rate = r;
    this.video.playbackRate = r;
    this.emit('rate', r);
  };

  /* J / K / L */
  Player.prototype.shuttle = function (dir) {
    if (!this.loaded()) return;
    if (dir === 0) { this.pause(); this.setRate(1); return; }
    if (dir > 0) {
      if (this.playing && !this.reverse) this.setRate(Math.min(8, this.rate * 2));
      else { this.setRate(1); this.play(); }
      return;
    }
    // 倒轉：以逐格跳的方式模擬（瀏覽器不支援負速度）
    var speed = this.reverse ? Math.min(8, this.reverse * 2) : 1;
    this._stopReverse();
    if (!this.video.paused) this.video.pause();
    this.reverse = speed;
    this.emit('rate', -speed);
    this._setPlaying(true);
    var self = this, last = performance.now(), acc = 0;
    var tick = function (t) {
      if (!self.reverse) return;
      acc += (t - last) / 1000 * self.exactFps * self.reverse; last = t;
      if (acc >= 1 && !self.video.seeking) {
        var n = Math.floor(acc); acc -= n;
        if (self.frame <= 0) { self.pause(); return; }
        self.seekFrame(self.frame - n);
      }
      self.reverseRaf = requestAnimationFrame(tick);
    };
    this.reverseRaf = requestAnimationFrame(tick);
  };
  Player.prototype._stopReverse = function () {
    if (this.reverse) { this.reverse = 0; cancelAnimationFrame(this.reverseRaf); this.emit('rate', this.rate); }
  };

  /* 影片實際顯示區域（扣掉黑邊），相對於容器 */
  Player.prototype.contentRect = function () {
    var v = this.video, cw = v.clientWidth, ch = v.clientHeight;
    var vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    var scale = Math.min(cw / vw, ch / vh);
    var w = vw * scale, h = vh * scale;
    return { x: v.offsetLeft + (cw - w) / 2, y: v.offsetTop + (ch - h) / 2, w: w, h: h };
  };

  RT.Player = Player;

  /* ---------------- 安全框 / 比例遮罩 ---------------- */
  RT.GUIDES = [
    { id: '', label: '無輔助線' },
    { id: 'safe', label: '安全框 93% / 90%' },
    { id: 'r239', label: '遮罩 2.39:1', ratio: 2.39 },
    { id: 'r185', label: '遮罩 1.85:1', ratio: 1.85 },
    { id: 'r43', label: '遮罩 4:3', ratio: 4 / 3 },
    { id: 'r11', label: '遮罩 1:1', ratio: 1 },
    { id: 'r45', label: '遮罩 4:5', ratio: 4 / 5 },
    { id: 'r916', label: '遮罩 9:16', ratio: 9 / 16 },
    { id: 'thirds', label: '三分線' }
  ];
  RT.drawGuides = function (canvas, id) {
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var g = RT.GUIDES.filter(function (x) { return x.id === id; })[0];
    if (!g || !g.id) return;
    var dpr = window.devicePixelRatio || 1;
    ctx.lineWidth = 1 * dpr;
    if (g.id === 'safe') {
      [[0.93, 'rgba(255,255,255,.55)'], [0.9, 'rgba(255,220,0,.6)']].forEach(function (s) {
        var sw = w * s[0], sh = h * s[0];
        ctx.strokeStyle = s[1];
        ctx.strokeRect((w - sw) / 2, (h - sh) / 2, sw, sh);
      });
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.beginPath(); ctx.moveTo(w / 2 - 10 * dpr, h / 2); ctx.lineTo(w / 2 + 10 * dpr, h / 2);
      ctx.moveTo(w / 2, h / 2 - 10 * dpr); ctx.lineTo(w / 2, h / 2 + 10 * dpr); ctx.stroke();
      return;
    }
    if (g.id === 'thirds') {
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.beginPath();
      [1, 2].forEach(function (i) {
        ctx.moveTo(w * i / 3, 0); ctx.lineTo(w * i / 3, h);
        ctx.moveTo(0, h * i / 3); ctx.lineTo(w, h * i / 3);
      });
      ctx.stroke();
      return;
    }
    var r = g.ratio, cur = w / h, bw = w, bh = h;
    if (r > cur) bh = w / r; else bw = h * r;
    var x = (w - bw) / 2, y = (h - bh) / 2;
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(0, 0, w, y); ctx.fillRect(0, y + bh, w, h - y - bh);
    ctx.fillRect(0, y, x, bh); ctx.fillRect(x + bw, y, w - x - bw, bh);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.strokeRect(x, y, bw, bh);
  };

  /* ---------------- 截圖（含畫記） ---------------- */
  RT.captureFrame = function (video, shapes, pin, maxW) {
    if (!video.videoWidth) return null;
    maxW = maxW || 480;
    var scale = Math.min(1, maxW / video.videoWidth);
    var w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    try {
      ctx.drawImage(video, 0, 0, w, h);
      if (shapes && shapes.length) RT.drawShapes(ctx, shapes, w, h);
      if (pin) RT.drawPin(ctx, pin.x * w, pin.y * h, Math.max(10, w / 40));
      return c.toDataURL('image/jpeg', 0.78);
    } catch (e) {
      return null; // 跨網域影片無法截圖
    }
  };
})();
