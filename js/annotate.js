/* 畫記：畫筆（支援壓感）、箭頭、方框、圓圈、定位點 */
(function () {
  'use strict';
  var RT = window.RT = window.RT || {};

  function r4(n) { return Math.round(n * 10000) / 10000; }

  RT.drawPin = function (ctx, x, y, size) {
    ctx.save();
    ctx.fillStyle = '#ff3b6b';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, size / 7);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - size * 0.9, y - size * 1.1, x - size * 0.7, y - size * 2.2, x, y - size * 2.2);
    ctx.bezierCurveTo(x + size * 0.7, y - size * 2.2, x + size * 0.9, y - size * 1.1, x, y);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y - size * 1.45, size * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  RT.drawShapes = function (ctx, shapes, w, h) {
    (shapes || []).forEach(function (s) {
      var lw = Math.max(1, (s.w || 0.004) * w);
      ctx.save();
      ctx.strokeStyle = s.c || '#ffd400';
      ctx.fillStyle = s.c || '#ffd400';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = Math.max(1, lw * 0.6);
      if (s.t === 'pen') {
        var p = s.p || [];
        if (p.length === 1) {
          ctx.beginPath(); ctx.arc(p[0][0] * w, p[0][1] * h, lw * (0.4 + (p[0][2] || 0.5) * 1.2) / 2, 0, Math.PI * 2); ctx.fill();
        }
        for (var i = 1; i < p.length; i++) {
          var pr = ((p[i - 1][2] || 0.5) + (p[i][2] || 0.5)) / 2;
          ctx.lineWidth = lw * (0.4 + pr * 1.2);
          ctx.beginPath();
          ctx.moveTo(p[i - 1][0] * w, p[i - 1][1] * h);
          ctx.lineTo(p[i][0] * w, p[i][1] * h);
          ctx.stroke();
        }
      } else if (s.a) {
        var x1 = s.a[0] * w, y1 = s.a[1] * h, x2 = s.a[2] * w, y2 = s.a[3] * h;
        ctx.lineWidth = lw;
        ctx.beginPath();
        if (s.t === 'rect') ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        else if (s.t === 'ellipse') {
          ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2 || 0.5, Math.abs(y2 - y1) / 2 || 0.5, 0, 0, Math.PI * 2);
        } else if (s.t === 'arrow') {
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
          var ang = Math.atan2(y2 - y1, x2 - x1), head = Math.max(10, lw * 4);
          ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
          ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
        }
        ctx.stroke();
      }
      ctx.restore();
    });
  };

  function Annotator(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = [];          // 目前選取註記的畫記（唯讀）
    this.viewPin = null;
    this.shapes = [];        // 正在編輯的畫記
    this.redoStack = [];
    this.pin = null;
    this.tool = 'pen';
    this.color = '#ffd400';
    this.width = 0.004;
    this.enabled = false;
    this.handlers = {};
    var self = this, cur = null;

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    }
    function pressure(e) {
      if (e.pointerType === 'pen') return e.pressure || 0.5;
      return 0.5;
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (!self.enabled || e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      self.emit('start');
      var p = pos(e);
      if (self.tool === 'pin') {
        self.pin = { x: r4(p[0]), y: r4(p[1]) };
        self.render(); self.emit('change');
        return;
      }
      if (self.tool === 'pen') cur = { t: 'pen', c: self.color, w: self.width, p: [[r4(p[0]), r4(p[1]), r4(pressure(e))]] };
      else cur = { t: self.tool, c: self.color, w: self.width, a: [r4(p[0]), r4(p[1]), r4(p[0]), r4(p[1])] };
      self.shapes.push(cur);
      self.redoStack = [];
      self.render();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!cur) return;
      var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      events.forEach(function (ev) {
        var p = pos(ev);
        if (cur.t === 'pen') {
          var last = cur.p[cur.p.length - 1];
          if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > 0.0025) cur.p.push([r4(p[0]), r4(p[1]), r4(pressure(ev))]);
        } else { cur.a[2] = r4(p[0]); cur.a[3] = r4(p[1]); }
      });
      self.render();
    });
    function end() {
      if (!cur) return;
      if (cur.a && Math.abs(cur.a[2] - cur.a[0]) + Math.abs(cur.a[3] - cur.a[1]) < 0.005) self.shapes.pop();
      cur = null;
      self.render(); self.emit('change');
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
  Annotator.prototype.on = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
  Annotator.prototype.emit = function (ev) { (this.handlers[ev] || []).forEach(function (fn) { fn(); }); };
  Annotator.prototype.resize = function (w, h) {
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.render();
  };
  Annotator.prototype.setEnabled = function (on) {
    this.enabled = on;
    this.canvas.style.pointerEvents = on ? 'auto' : 'none';
    this.canvas.style.cursor = on ? (this.tool === 'pin' ? 'copy' : 'crosshair') : 'default';
  };
  Annotator.prototype.setTool = function (t) { this.tool = t; this.setEnabled(this.enabled); };
  Annotator.prototype.setView = function (shapes, pin) { this.view = shapes || []; this.viewPin = pin || null; this.render(); };
  Annotator.prototype.undo = function () { if (this.shapes.length) { this.redoStack.push(this.shapes.pop()); this.render(); this.emit('change'); } };
  Annotator.prototype.redo = function () { if (this.redoStack.length) { this.shapes.push(this.redoStack.pop()); this.render(); this.emit('change'); } };
  Annotator.prototype.clear = function () { this.shapes = []; this.redoStack = []; this.pin = null; this.render(); this.emit('change'); };
  Annotator.prototype.hasDraft = function () { return this.shapes.length > 0 || !!this.pin; };
  Annotator.prototype.render = function () {
    var c = this.canvas, ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);
    RT.drawShapes(ctx, this.view, c.width, c.height);
    if (this.viewPin) RT.drawPin(ctx, this.viewPin.x * c.width, this.viewPin.y * c.height, 9 * (window.devicePixelRatio || 1));
    if (this.draftHidden) return;
    RT.drawShapes(ctx, this.shapes, c.width, c.height);
    if (this.pin) RT.drawPin(ctx, this.pin.x * c.width, this.pin.y * c.height, 9 * (window.devicePixelRatio || 1));
  };

  RT.Annotator = Annotator;
})();
