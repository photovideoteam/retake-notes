/* 讀取 MP4/MOV 檔頭，取得精確的 fps、總格數、解析度。
 * 支援本機 File 物件，以及支援 HTTP Range 的雲端網址。 */
(function () {
  'use strict';
  var RT = window.RT = window.RT || {};

  function reader(src) {
    if (src.file) {
      return {
        size: Promise.resolve(src.file.size),
        read: function (start, len) {
          return src.file.slice(start, start + len).arrayBuffer().then(function (b) { return new DataView(b); });
        }
      };
    }
    var total = null;
    function rangeFetch(start, len) {
      return fetch(src.url, { headers: { Range: 'bytes=' + start + '-' + (start + len - 1) } }).then(function (r) {
        if (r.status !== 206) {
          try { r.body && r.body.cancel(); } catch (e) { /* ignore */ }
          throw new Error('伺服器不支援分段讀取');
        }
        var cr = r.headers.get('Content-Range');
        if (cr && /\/(\d+)$/.test(cr)) total = Number(RegExp.$1);
        return r.arrayBuffer().then(function (b) { return new DataView(b); });
      });
    }
    var first = rangeFetch(0, 16);
    return {
      size: first.then(function () { return total || Infinity; }),
      read: function (start, len) { return start === 0 && len === 16 ? first : rangeFetch(start, len); }
    };
  }

  function type(dv, off) {
    return String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
  }
  function u64(dv, off) { return dv.getUint32(off) * 4294967296 + dv.getUint32(off + 4); }

  // 在 [start,end) 範圍內列出子 box
  function children(dv, start, end) {
    var out = [], off = start;
    while (off + 8 <= end) {
      var size = dv.getUint32(off), t = type(dv, off + 4), hdr = 8;
      if (size === 1) { size = u64(dv, off + 8); hdr = 16; }
      else if (size === 0) size = end - off;
      if (size < hdr || off + size > end) break;
      out.push({ type: t, start: off, body: off + hdr, end: off + size });
      off += size;
    }
    return out;
  }
  function find(dv, box, path) {
    var cur = [box];
    for (var i = 0; i < path.length; i++) {
      var next = [];
      cur.forEach(function (b) { children(dv, b.body, b.end).forEach(function (c) { if (c.type === path[i]) next.push(c); }); });
      cur = next;
    }
    return cur;
  }

  function parseMoov(dv) {
    var moov = { body: 0, end: dv.byteLength };
    var traks = find(dv, moov, ['trak']);
    for (var i = 0; i < traks.length; i++) {
      var tr = traks[i];
      var hdlr = find(dv, tr, ['mdia', 'hdlr'])[0];
      if (!hdlr || type(dv, hdlr.body + 8) !== 'vide') continue;
      var mdhd = find(dv, tr, ['mdia', 'mdhd'])[0];
      var stts = find(dv, tr, ['mdia', 'minf', 'stbl', 'stts'])[0];
      var tkhd = find(dv, tr, ['tkhd'])[0];
      if (!mdhd || !stts) continue;
      var v = dv.getUint8(mdhd.body);
      var timescale = v === 1 ? dv.getUint32(mdhd.body + 20) : dv.getUint32(mdhd.body + 12);
      var count = dv.getUint32(stts.body + 4);
      var samples = 0, dur = 0, deltas = {};
      for (var e = 0; e < count; e++) {
        var p = stts.body + 8 + e * 8;
        var c = dv.getUint32(p), d = dv.getUint32(p + 4);
        samples += c; dur += c * d;
        deltas[d] = (deltas[d] || 0) + c;
      }
      // 以出現最多次的 sample delta 計算 fps（避免最後一格長度不同造成誤差）
      var best = 0, bestD = 0;
      Object.keys(deltas).forEach(function (k) { if (deltas[k] > best) { best = deltas[k]; bestD = Number(k); } });
      var fps = bestD ? timescale / bestD : (dur ? timescale * samples / dur : 0);
      var width = 0, height = 0;
      if (tkhd) {
        var tv = dv.getUint8(tkhd.body);
        var wOff = tkhd.body + (tv === 1 ? 88 : 76);
        if (wOff + 8 <= tkhd.end) { width = dv.getUint32(wOff) / 65536; height = dv.getUint32(wOff + 4) / 65536; }
      }
      return {
        fps: RTCore.TC.snap(fps), rawFps: fps, frames: samples, width: Math.round(width), height: Math.round(height),
        variable: Object.keys(deltas).length > 2
      };
    }
    throw new Error('找不到影像軌');
  }

  /* src: { file: File } 或 { url: string } → Promise<{fps, frames, width, height}> */
  RT.probeMp4 = function (src) {
    var r = reader(src);
    return r.size.then(function (size) {
      var off = 0, guard = 0;
      function next() {
        if (off >= size || guard++ > 64) throw new Error('找不到 moov');
        return r.read(off, 16).then(function (dv) {
          if (dv.byteLength < 8) throw new Error('檔案結構錯誤');
          var bsize = dv.getUint32(0), t = type(dv, 4), hdr = 8;
          if (bsize === 1) { bsize = u64(dv, 8); hdr = 16; }
          else if (bsize === 0) bsize = size - off;
          if (bsize < 8) throw new Error('檔案結構錯誤');
          if (t === 'moov') {
            if (bsize > 200 * 1024 * 1024) throw new Error('moov 過大');
            return r.read(off + hdr, bsize - hdr).then(parseMoov);
          }
          off += bsize;
          return next();
        });
      }
      return next();
    });
  };
})();
