/* 匯出 Excel（含截圖）與 PDF（瀏覽器列印） */
(function () {
  'use strict';
  var RT = window.RT = window.RT || {};
  var TC = RTCore.TC;
  var EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url; s.onload = resolve; s.onerror = function () { reject(new Error('無法載入 Excel 元件，請檢查網路')); };
      document.head.appendChild(s);
    });
  }

  RT.noteTC = function (note, v, which) {
    var start = TC.tcToFrames(v.startTC || '00:00:00:00', v.fps, v.dropFrame);
    if (!isFinite(start)) start = 0;
    return TC.framesToTC(start + (which === 'out' ? note.outFrame : note.inFrame), v.fps, v.dropFrame);
  };

  function peopleMap(people) {
    var m = {};
    (people || []).forEach(function (p) { m[String(p.username).toLowerCase()] = p.displayName; });
    return m;
  }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  RT.fmtTime = fmtTime;

  function historyText(n) {
    return (n.replies || []).map(function (r) {
      var s = fmtTime(r.createdAt) + ' ' + r.authorName + '：';
      if (r.statusChange) s += '［' + r.statusChange + '］';
      if (r.text) s += r.text;
      if (r.attachIds && r.attachIds.length) s += '（附件 ' + r.attachIds.length + '）';
      return s;
    }).join('\n');
  }

  function sortNotes(notes, versions) {
    var order = {};
    versions.forEach(function (v, i) { order[v.id] = i; });
    return notes.slice().sort(function (a, b) { return (order[a.versionId] - order[b.versionId]) || (a.inFrame - b.inFrame); });
  }

  /* opts: { project, versions, notes, people, user, includeThumbs } */
  RT.exportExcel = function (opts) {
    var ready = window.ExcelJS ? Promise.resolve() : loadScript(EXCELJS_URL);
    var notes = sortNotes(opts.notes, opts.versions);
    var vmap = {};
    opts.versions.forEach(function (v) { vmap[v.id] = v; });
    var pm = peopleMap(opts.people);
    var thumbIds = notes.map(function (n) { return n.thumbId; }).filter(Boolean);
    return ready.then(function () {
      return opts.includeThumbs === false ? {} : RT.getFiles(thumbIds);
    }).then(function (files) {
      var wb = new window.ExcelJS.Workbook();
      wb.creator = 'Retake Notes';
      wb.created = new Date();

      /* 總覽 */
      var s1 = wb.addWorksheet('總覽');
      s1.columns = [{ width: 18 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }];
      s1.addRow(['專案', opts.project.name]).font = { bold: true, size: 14 };
      s1.addRow(['狀態', opts.project.status]);
      s1.addRow(['截止日', opts.project.dueDate || '']);
      s1.addRow(['說明', opts.project.description || '']);
      s1.addRow(['匯出時間', fmtTime(new Date().toISOString())]);
      s1.addRow(['匯出者', opts.user ? opts.user.displayName : '']);
      s1.addRow([]);
      var head = s1.addRow(['版本', '版本狀態', '註記數'].concat(RTCore.NOTE_STATUS));
      head.font = { bold: true };
      head.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAED' } }; });
      opts.versions.forEach(function (v) {
        var vn = notes.filter(function (n) { return n.versionId === v.id; });
        s1.addRow([v.label, v.status, vn.length].concat(RTCore.NOTE_STATUS.map(function (st) {
          return vn.filter(function (n) { return n.status === st; }).length;
        })));
      });

      /* 註記 */
      var s2 = wb.addWorksheet('註記', { views: [{ state: 'frozen', ySplit: 1 }] });
      var cols = [
        ['版本', 8], ['#', 5], ['截圖', 34], ['入點 TC', 13], ['出點 TC', 13], ['格數', 8], ['狀態', 9], ['註記內容', 45],
        ['標籤', 14], ['負責人', 12], ['截止日', 11], ['建立者', 12], ['建立時間', 16], ['最後更新', 16], ['討論紀錄', 50], ['內部', 6]
      ];
      s2.columns = cols.map(function (c) { return { header: c[0], width: c[1] }; });
      s2.getRow(1).font = { bold: true };
      s2.getRow(1).eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAED' } }; });
      var counter = {};
      var statusColor = { '待修改': 'FFFDE2E1', '修改中': 'FFFFF1D6', '已修改': 'FFE6E1FF', '已確認': 'FFDDF4E4', '不修改': 'FFEDEDED' };
      notes.forEach(function (n) {
        var v = vmap[n.versionId];
        counter[v.id] = (counter[v.id] || 0) + 1;
        var row = s2.addRow([
          v.label, counter[v.id], '', RT.noteTC(n, v), n.outFrame > n.inFrame ? RT.noteTC(n, v, 'out') : '',
          n.inFrame, n.status, n.text, (n.tags || []).join(' '), pm[String(n.assignee || '').toLowerCase()] || n.assignee || '',
          n.dueDate || '', n.authorName, fmtTime(n.createdAt), fmtTime(n.updatedAt), historyText(n), n.internal ? '是' : ''
        ]);
        row.alignment = { vertical: 'top', wrapText: true };
        row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor[n.status] || 'FFFFFFFF' } };
        var img = n.thumbId && files[n.thumbId];
        if (img) {
          var ext = /^data:image\/png/.test(img) ? 'png' : 'jpeg';
          var imgId = wb.addImage({ base64: img, extension: ext });
          s2.addImage(imgId, { tl: { col: 2.05, row: row.number - 1 + 0.08 }, ext: { width: 228, height: 128 }, editAs: 'oneCell' });
          row.height = 104;
        } else {
          row.height = Math.max(30, Math.min(160, 15 * (1 + Math.floor(String(n.text || '').length / 30))));
        }
      });
      s2.autoFilter = { from: 'A1', to: 'P1' };
      return wb.xlsx.writeBuffer();
    }).then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      var d = new Date();
      var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
      a.href = URL.createObjectURL(blob);
      a.download = (opts.project.name || 'retake').replace(/[\\\/:*?"<>|]/g, '_') + '_retake_' + stamp + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
  };

  /* PDF：產生列印版面，交給瀏覽器「另存為 PDF」 */
  RT.exportPdf = function (opts) {
    var notes = sortNotes(opts.notes, opts.versions);
    var vmap = {};
    opts.versions.forEach(function (v) { vmap[v.id] = v; });
    var pm = peopleMap(opts.people);
    var esc = RT.esc;
    return RT.getFiles(notes.map(function (n) { return n.thumbId; }).filter(Boolean)).then(function (files) {
      var html = '<div class="pr-head"><h1>' + esc(opts.project.name) + '</h1><div>' + esc(opts.project.status) +
        (opts.project.dueDate ? '　截止 ' + esc(opts.project.dueDate) : '') + '　匯出 ' + esc(fmtTime(new Date().toISOString())) +
        (opts.user ? '　' + esc(opts.user.displayName) : '') + '</div></div>';
      opts.versions.forEach(function (v) {
        var vn = notes.filter(function (n) { return n.versionId === v.id; });
        if (!vn.length) return;
        html += '<h2>' + esc(v.label) + '　<small>' + esc(v.status) + '・' + vn.length + ' 則註記・' + esc(v.fileName || v.url || '') + '</small></h2>';
        vn.forEach(function (n, i) {
          var img = n.thumbId && files[n.thumbId];
          html += '<div class="pr-note"><div class="pr-img">' + (img ? '<img src="' + img + '">' : '<div class="pr-noimg">無截圖</div>') + '</div>' +
            '<div class="pr-body"><div class="pr-meta"><b>#' + (i + 1) + '　' + esc(RT.noteTC(n, v)) +
            (n.outFrame > n.inFrame ? ' → ' + esc(RT.noteTC(n, v, 'out')) : '') + '</b>　<span class="pr-st">' + esc(n.status) + '</span>' +
            (n.internal ? '　<span class="pr-st">內部</span>' : '') + '</div>' +
            '<div class="pr-text">' + esc(n.text) + '</div>' +
            '<div class="pr-sub">' + esc(n.authorName) + '・' + esc(fmtTime(n.createdAt)) +
            (n.assignee ? '　負責：' + esc(pm[n.assignee] || n.assignee) : '') + (n.dueDate ? '　截止：' + esc(n.dueDate) : '') + '</div>' +
            (n.replies && n.replies.length ? '<div class="pr-hist">' + esc(historyText(n)).replace(/\n/g, '<br>') + '</div>' : '') +
            '</div></div>';
        });
      });
      var area = document.getElementById('printArea');
      area.innerHTML = html;
      var imgs = area.querySelectorAll('img');
      return Promise.all(Array.prototype.map.call(imgs, function (im) {
        return im.complete ? null : new Promise(function (r) { im.onload = im.onerror = r; });
      }));
    }).then(function () {
      setTimeout(function () { window.print(); }, 100);
    });
  };
})();
