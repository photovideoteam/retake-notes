/* Retake Notes — 審閱頁：播放器、時間軸、畫記、註記、回覆、比對 */
(function () {
  'use strict';
  const RT = window.RT;
  const cfg = window.RT_CONFIG || {};
  const TC = RTCore.TC;
  const { esc, $, $$ } = RT;
  const COLORS = ['#ffd400', '#ff3b6b', '#3ecf8e', '#4c9dff', '#ffffff', '#b072ff'];
  const WIDTHS = [[0.0025, '細'], [0.004, '中'], [0.007, '粗']];
  const STATUS_VAR = { '待修改': 'var(--s-todo)', '修改中': 'var(--s-doing)', '已修改': 'var(--s-fixed)', '已確認': 'var(--s-ok)', '不修改': 'var(--s-skip)' };

  const escText = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  RT.pageReview = async function (vid, q) {
    const main = RT.shell('projects', '<div class="dim" style="padding:30px">載入中…</div>');
    let data;
    try { data = await RT.call('getReview', { versionId: vid }); }
    catch (e) { RT.fail(e); main.innerHTML = `<div class="page"><div class="empty">${esc(e.message)}</div></div>`; return; }
    const version = data.versions.find((v) => v.id === vid);
    const project = data.project;
    const user = RT.user();
    const isAdmin = RT.isAdmin(), isGuest = RT.isGuest();
    const canComment = !isGuest || RT.session.share.canComment;
    const peopleMap = {};
    data.people.forEach((p) => { peopleMap[p.username.toLowerCase()] = p; });
    document.title = `${version.label} · ${project.name} — ${cfg.SITE_NAME || 'Retake Notes'}`;

    const S = {
      notes: data.notes, sel: q.note || null, inF: null, outF: null, draftFrame: null, attach: [], drawMode: false,
      guide: localStorage.getItem('rt_guide') || '', filters: { status: new Set(RTCore.NOTE_STATUS), q: '', assignee: '', tag: '' },
      sort: 'tc', replyDraft: {}, replyAttach: {}, compare: null, timers: [], loopOn: false, lastSig: ''
    };

    /* ---------------- 版面 ---------------- */
    const statusSel = isGuest ? RT.statusPill(version.status)
      : `<select id="verStatus" title="版本狀態">${RTCore.VERSION_STATUS.map((s) => `<option ${s === version.status ? 'selected' : ''} ${s === '已核准' && !isAdmin ? 'disabled' : ''}>${s}</option>`).join('')}</select>`;
    main.innerHTML = `<div class="review">
      <div class="rv-top">
        <a class="btn ghost sm" href="#/p/${esc(project.id)}">‹ 專案</a>
        <span class="title" title="${esc(project.name)}">${esc(project.name)}</span>
        <select id="verSel" title="切換版本">${data.versions.slice().reverse().map((v) => `<option value="${esc(v.id)}" ${v.id === vid ? 'selected' : ''}>${esc(v.label)}${v.remark ? '・' + esc(v.remark) : ''}</option>`).join('')}</select>
        ${statusSel}
        <span class="sp"></span>
        <button class="btn sm" id="srcBtn" title="更換或重新載入影片">影片來源</button>
        <button class="btn sm" id="cmpBtn" ${data.versions.length < 2 ? 'disabled title="需要兩個以上的版本"' : ''}>並排比對</button>
        <button class="btn sm" id="expBtn">匯出 ▾</button>
        <button class="btn sm icon" id="helpBtn" title="快捷鍵">?</button>
      </div>
      <div id="warnbar"></div>
      <div class="rv-main">
        <div class="rv-left" id="rvLeft">
          <div class="stage" id="stage">
            <div class="panes" id="panes">
              <div class="pane" id="paneA"><video id="vA"></video>
                <div class="vlayer" id="layerA"><canvas class="guides"></canvas><canvas class="annot"></canvas><div class="wm hidden"></div></div>
                <div class="pane-label hidden"></div><div class="tc-burn"></div></div>
              <div class="pane hidden" id="paneB"><video id="vB" muted></video>
                <div class="vlayer" id="layerB"><canvas class="guides"></canvas><div class="wm hidden"></div></div>
                <div class="pane-label"></div><div class="tc-burn"></div>
                <button class="btn sm" id="cmpClose" style="position:absolute;bottom:8px;right:8px">結束比對</button></div>
            </div>
            <div class="loader" id="loader"></div>
          </div>
          <div class="timeline" id="tl"><div class="tl-track"><div class="tl-fill"></div></div><div class="tl-marks"></div>
            <div class="tl-io hidden" id="tlSel"></div><div class="tl-io tl-loop hidden" id="tlIO"></div><div class="tl-head"></div><div class="tl-hover hidden"></div></div>
          <div class="transport">
            <button class="btn icon" data-t="start" title="開頭 (Home)">⏮</button>
            <button class="btn icon" data-t="-s" title="後退 1 秒 (Shift+←)">«</button>
            <button class="btn icon" data-t="-1" title="上一格 (←)">‹</button>
            <button class="btn icon" data-t="play" id="btnPlay" title="播放 / 暫停 (Space)" style="width:42px">▶</button>
            <button class="btn icon" data-t="+1" title="下一格 (→)">›</button>
            <button class="btn icon" data-t="+s" title="前進 1 秒 (Shift+→)">»</button>
            <button class="btn icon" data-t="end" title="結尾 (End)">⏭</button>
            <div class="tcbox" title="目前時間碼"><span class="tc" id="tcMain">--:--:--:--</span>
              <span class="fr"><span id="frNum">0</span> / <span id="frTot">0</span><br><span id="fpsLbl"></span></span></div>
            <input type="text" class="tcjump" id="tcJump" placeholder="跳至 TC / 格數" title="輸入時間碼（01:00:10:12）或格數後按 Enter">
            <select id="rateSel" title="播放速度">${[0.1, 0.25, 0.5, 0.75, 1, 1.5, 2].map((r) => `<option value="${r}" ${r === 1 ? 'selected' : ''}>${r}×</option>`).join('')}</select>
            <span class="vsep"></span>
            <button class="btn sm" data-t="in" title="設定入點 (I)">入點 I</button>
            <button class="btn sm" data-t="out" title="設定出點 (O)">出點 O</button>
            <button class="btn sm" data-t="loop" id="btnLoop" title="入出點之間循環播放 (R)">⟲ 循環</button>
            <span class="sp"></span>
            <select id="guideSel" title="安全框 / 比例遮罩 (G)">${RT.GUIDES.map((g) => `<option value="${g.id}" ${g.id === S.guide ? 'selected' : ''}>${g.label}</option>`).join('')}</select>
            <button class="btn sm" data-t="fs" title="全螢幕 (F)">⛶ 全螢幕</button>
          </div>
          ${canComment ? `<div class="drawbar">
            <button class="btn sm" id="btnDraw" title="畫記模式 (D)">✎ 畫記</button>
            <span id="drawTools" class="row wrap" style="gap:6px">
              ${[['pen', '畫筆'], ['arrow', '箭頭'], ['rect', '方框'], ['ellipse', '圓圈'], ['pin', '定位點']].map((t) => `<button class="btn sm" data-tool="${t[0]}">${t[1]}</button>`).join('')}
              <span class="vsep"></span>
              ${COLORS.map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" aria-label="顏色 ${c}"></button>`).join('')}
              <span class="vsep"></span>
              <select id="widthSel">${WIDTHS.map((w) => `<option value="${w[0]}" ${w[0] === 0.004 ? 'selected' : ''}>${w[1]}</option>`).join('')}</select>
              <button class="btn sm icon" data-d="undo" title="復原 (Ctrl+Z)">↶</button>
              <button class="btn sm icon" data-d="redo" title="重做 (Ctrl+Shift+Z)">↷</button>
              <button class="btn sm" data-d="clear">清除</button>
            </span>
            <span class="dim" style="font-size:12px" id="drawHint"></span>
          </div>` : ''}
        </div>
        <aside class="rv-side">
          ${canComment ? `<div class="composer" id="composer">
            <div class="at"><span>於</span><span class="mono" id="cTC">--</span><span id="cRange" class="dim"></span><span class="sp"></span>
              <button class="btn sm ghost hidden" id="cClearIO">清除入出點</button></div>
            <div style="position:relative"><textarea id="cText" placeholder="輸入修改說明…  @提及成員  #標籤（Ctrl+Enter 送出）"></textarea></div>
            <div class="attach-list" id="cAttach"></div>
            <div class="opts">
              <span class="dim" style="font-size:12px" id="cDrawInfo"></span>
              <button class="btn sm" id="cAttachBtn" title="附加參考圖片（也可直接貼上）">📎 圖片</button><input type="file" id="cAttachFile" accept="image/*" multiple hidden>
              ${isGuest ? '' : `<select id="cAssignee" title="負責人"><option value="">負責人</option>${data.people.map((p) => `<option value="${esc(p.username.toLowerCase())}">${esc(p.displayName)}</option>`).join('')}</select>
              <input type="date" id="cDue" title="截止日">`}
              ${isAdmin ? '<label class="chk" title="內部註記：廠商與訪客看不到" style="font-size:12.5px"><input type="checkbox" id="cInternal"> 內部</label>' : ''}
              <span class="sp"></span>
              <button class="btn primary sm" id="cSend">送出註記</button>
            </div>
          </div>` : '<div class="composer dim" style="font-size:13px">此分享連結僅能檢視。</div>'}
          <div class="filters">
            <div class="row"><input type="search" id="fQ" class="grow" placeholder="搜尋內容、@成員、#標籤"><select id="fSort"><option value="tc">依時間碼</option><option value="new">最新建立</option><option value="upd">最近更新</option></select></div>
            <div class="row wrap" style="gap:4px" id="fStatus">${RTCore.NOTE_STATUS.map((s) => `<button class="fchip on" data-st="${s}" style="color:${STATUS_VAR[s]}">${s} <span data-cnt="${s}"></span></button>`).join('')}</div>
            <div class="row"><select id="fAssignee" class="grow"><option value="">所有負責人</option><option value="__me">指派給我</option><option value="__none">未指派</option>${data.people.map((p) => `<option value="${esc(p.username.toLowerCase())}">${esc(p.displayName)}</option>`).join('')}</select>
              <select id="fTag" class="grow"><option value="">所有標籤</option></select></div>
          </div>
          <div class="notes" id="notes"></div>
          <div class="side-foot"><span id="noteCount"></span><span class="sp"></span><button class="btn sm ghost" id="refreshBtn" title="重新整理註記">⟳</button></div>
        </aside>
      </div>
    </div>`;

    /* ---------------- 播放器 ---------------- */
    const vA = $('#vA'), layerA = $('#layerA');
    const player = new RT.Player(vA);
    const annot = new RT.Annotator($('canvas.annot', layerA));
    let pB = null;
    player.setMeta({ fps: version.fps, df: version.dropFrame, startTC: version.startTC, total: version.durationFrames });
    $('#fpsLbl').textContent = version.fps + (player.df ? ' DF' : '') + ' fps';

    // 浮水印
    if (project.watermark && !isAdmin) {
      const txt = `${user.displayName}　${RT.todayStr()}`;
      $$('.wm').forEach((w) => { w.classList.remove('hidden'); w.innerHTML = '<div>' + Array(60).fill(`<span>${esc(txt)}</span>`).join('') + '</div>'; });
    }

    function layout() {
      [[player, layerA, $('#paneA')], [pB, $('#layerB'), $('#paneB')]].forEach(([p, layer, pane]) => {
        if (!p || pane.classList.contains('hidden')) return;
        const r = p.contentRect();
        Object.assign(layer.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        const g = $('canvas.guides', layer), dpr = window.devicePixelRatio || 1;
        g.width = Math.max(1, Math.round(r.w * dpr)); g.height = Math.max(1, Math.round(r.h * dpr));
        RT.drawGuides(g, S.guide);
        if (p === player) annot.resize(r.w, r.h);
      });
      renderMarks();
    }
    const ro = new ResizeObserver(() => layout());
    ro.observe($('#stage'));
    vA.addEventListener('loadedmetadata', layout);

    function updateFrameUI() {
      const f = player.frame;
      const tc = player.loaded() ? player.tc(f) : '--:--:--:--';
      $('#tcMain').textContent = tc;
      $('#frNum').textContent = f;
      $('#frTot').textContent = player.total ? player.total - 1 : 0;
      $('.tc-burn', $('#paneA')).textContent = tc;
      const total = Math.max(1, player.total - 1);
      const pct = Math.min(100, f / total * 100);
      $('.tl-head').style.left = pct + '%';
      $('.tl-fill').style.width = pct + '%';
      updateComposerTC();
      updateOverlay();
    }
    player.on('frame', () => {
      updateFrameUI();
      if (S.compare && pB && pB.loaded()) {
        if (!player.playing) pB.seekFrame(player.frame);
        else if (Math.abs(pB.frame - player.frame) > 3 && !pB.video.seeking) pB.seekFrame(player.frame);
      }
    });
    player.on('state', (p) => {
      $('#btnPlay').textContent = p ? '❚❚' : '▶';
      if (S.compare && pB && pB.loaded()) {
        if (p && !player.reverse) { pB.setRate(player.rate); pB.play(); }
        else { pB.pause(); pB.seekFrame(player.frame); }
      }
      if (p && S.drawMode) setDrawMode(false);
    });
    player.on('rate', (r) => {
      const sel = $('#rateSel');
      if ([...sel.options].some((o) => Number(o.value) === r)) sel.value = String(r);
      if (S.compare && pB && r > 0) pB.setRate(r);
    });

    /* ---------------- 影片載入 ---------------- */
    const loader = $('#loader');
    function showLoader(msg, errMsg) {
      loader.classList.remove('hidden');
      if (msg) { loader.innerHTML = `<div class="box"><div class="dim">${esc(msg)}</div></div>`; return; }
      const local = version.fileName;
      loader.innerHTML = `<div class="box">
        <h2>載入 ${esc(version.label)} 的影片</h2>
        ${errMsg ? `<p class="err">${esc(errMsg)}</p>` : ''}
        ${local ? `<p class="muted" style="margin:8px 0 0">此版本的本機檔案：<b>${esc(version.fileName)}</b>${version.fileSize ? `（${(version.fileSize / 1048576).toFixed(1)} MB）` : ''}</p>` : ''}
        <div class="drop" id="drop">拖曳影片到這裡，或<br><button class="btn primary" id="pickFile" style="margin-top:10px">選擇本機檔案</button>
          <input type="file" id="pickInput" accept="video/mp4,video/quicktime,video/*" hidden></div>
        <div class="row" style="margin-top:12px"><input type="url" id="srcUrl" class="grow" placeholder="或貼上雲端連結（Google Drive / Dropbox / mp4 網址）" value="${esc(version.url || '')}"><button class="btn" id="srcUrlBtn">載入</button></div>
        <p style="margin-top:14px"><button class="btn ghost sm" id="skipVideo">先不載入，只看註記 →</button></p>
      </div>`;
      $('#pickFile').onclick = () => $('#pickInput').click();
      $('#pickInput').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };
      $('#srcUrlBtn').onclick = () => { const u = $('#srcUrl').value.trim(); if (u) loadUrl(u, true); };
      $('#srcUrl').onkeydown = (e) => { if (e.key === 'Enter') $('#srcUrlBtn').click(); };
      $('#skipVideo').onclick = () => {
        loader.innerHTML = `<div class="box"><p class="muted">尚未載入影片。可以瀏覽、回覆右側的註記；要新增註記請先載入影片。</p><button class="btn" id="reopenLoader">載入影片</button></div>`;
        $('#reopenLoader').onclick = () => showLoader();
      };
      const drop = $('#drop');
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
    }

    async function loadFile(file) {
      if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v)$/i.test(file.name)) { RT.toast('請選擇影片檔（mp4 / mov）', 'bad'); return; }
      RT.pendingFiles[vid] = file;
      await loadSource({ file }, file.name);
      if (!player.loaded()) return;
      const warn = [];
      if (version.fileName && version.fileName !== file.name) warn.push(`檔名與版本記錄不同（記錄：${version.fileName}）`);
      else if (version.fileSize && Math.abs(version.fileSize - file.size) > 0) warn.push(`檔案大小與版本記錄不同，可能不是同一個輸出檔`);
      if (warn.length) addWarn(warn.join('；'));
      if (!version.fileName && !isGuest) {
        RT.call('saveVersion', { version: { id: vid, fileName: file.name, fileSize: file.size, sourceType: version.url ? 'url' : 'local' } })
          .then(() => { version.fileName = file.name; version.fileSize = file.size; }).catch(() => {});
      }
    }
    async function loadUrl(url, save) {
      const real = RT.normalizeVideoUrl(url);
      await loadSource({ url: real }, '雲端影片');
      if (save && url !== version.url && !isGuest && player.loaded()) {
        if (await RT.confirm('把這個雲端連結記錄到此版本，讓其他人也能直接播放？', '記錄')) {
          RT.call('saveVersion', { version: { id: vid, url, sourceType: 'url' } }).then(() => { version.url = url; RT.toast('已記錄雲端連結', 'ok'); }).catch(RT.fail);
        }
      }
    }
    async function loadSource(src, label) {
      showLoader('載入影片中…');
      try {
        await player.load(src);
      } catch (e) { showLoader(null, e.message); return; }
      let info = null;
      try { info = await RT.probeMp4(src); } catch (e) { info = null; }
      const total = (info && info.frames) || version.durationFrames || 0;
      player.setMeta({ fps: version.fps, df: version.dropFrame, startTC: version.startTC, total });
      if (info && Math.abs(info.fps - version.fps) > 0.01) {
        addWarn(`影片偵測為 ${info.fps} fps，但版本設定為 ${version.fps} fps，時間碼可能不準。`,
          isGuest ? null : [`改用 ${info.fps} fps`, async () => {
            await RT.call('saveVersion', { version: { id: vid, fps: info.fps, dropFrame: version.dropFrame && TC.isDFCapable(info.fps), durationFrames: info.frames } });
            version.fps = info.fps;
            player.setMeta({ fps: info.fps, df: version.dropFrame, total: info.frames });
            $('#fpsLbl').textContent = info.fps + (player.df ? ' DF' : '') + ' fps';
            RT.toast('已更新 fps', 'ok');
            renderNotes(); renderMarks();
          }]);
      }
      if (info && info.variable) addWarn('此影片可能是可變幀率 (VFR)，逐格位置可能有誤差。建議輸出固定幀率的檔案。');
      if (info && !isGuest && (!version.durationFrames || !version.width)) {
        RT.call('saveVersion', { version: { id: vid, durationFrames: info.frames, width: info.width, height: info.height } }).catch(() => {});
        version.durationFrames = info.frames;
      }
      if (player.tainted) addWarn('此雲端連結不允許跨網域讀取，可以播放但無法自動截圖；註記仍會記錄畫記與時間碼。');
      loader.classList.add('hidden');
      $('.pane-label', $('#paneA')).textContent = version.label + '・' + label;
      layout();
      const sel = S.sel && S.notes.find((n) => n.id === S.sel);
      player.seekFrame(sel ? sel.inFrame : 0);
      updateFrameUI();
      renderNotes();
    }

    function addWarn(msg, action) {
      const bar = RT.el(`<div class="warnbar"><span class="grow">⚠ ${esc(msg)}</span>${action ? `<button class="btn sm">${esc(action[0])}</button>` : ''}<button class="btn sm ghost" data-x>✕</button></div>`);
      $('#warnbar').appendChild(bar);
      $('[data-x]', bar).onclick = () => { bar.remove(); layout(); };
      if (action) $('.btn:not([data-x])', bar).onclick = async () => { try { await action[1](); bar.remove(); layout(); } catch (e) { RT.fail(e); } };
      layout();
    }

    /* ---------------- 傳輸控制 ---------------- */
    const secFrames = () => TC.nominal(player.fps);
    function transport(t) {
      if (!player.loaded() && t !== 'fs') return;
      switch (t) {
        case 'play': player.toggle(); break;
        case '-1': player.step(-1); break;
        case '+1': player.step(1); break;
        case '-s': player.step(-secFrames()); break;
        case '+s': player.step(secFrames()); break;
        case 'start': player.pause(); player.seekFrame(0); break;
        case 'end': player.pause(); player.seekFrame(player.total - 1); break;
        case 'in': setIn(player.frame); break;
        case 'out': setOut(player.frame); break;
        case 'loop': toggleLoop(); break;
        case 'fs': toggleFs(); break;
      }
    }
    $('.transport').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) transport(b.dataset.t); });
    $('#rateSel').onchange = (e) => player.setRate(Number(e.target.value));
    $('#tcJump').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const f = player.parseTC(e.target.value);
      if (!isFinite(f) || f < 0) { RT.toast('時間碼格式錯誤', 'bad'); return; }
      player.pause(); player.seekFrame(f); e.target.value = ''; e.target.blur();
    };
    $('#guideSel').onchange = (e) => { S.guide = e.target.value; localStorage.setItem('rt_guide', S.guide); layout(); };

    function setIn(f) {
      S.inF = f;
      if (S.outF !== null && S.outF < f) S.outF = null;
      ioChanged();
    }
    function setOut(f) {
      if (S.inF === null) S.inF = Math.min(f, player.frame);
      S.outF = Math.max(f, S.inF);
      ioChanged();
    }
    function clearIO() { S.inF = null; S.outF = null; ioChanged(); }
    function ioChanged() {
      player.loop.inF = S.inF; player.loop.outF = S.outF;
      renderIO(); updateComposerTC();
    }
    function toggleLoop() {
      S.loopOn = !S.loopOn;
      player.loop.on = S.loopOn;
      $('#btnLoop').classList.toggle('on', S.loopOn);
      if (S.loopOn && S.inF === null) RT.toast('循環整段影片（設定入出點可只循環一段）');
    }
    function toggleFs() {
      const el = $('#rvLeft');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => RT.toast('瀏覽器不允許全螢幕', 'bad'));
    }
    const onFs = () => setTimeout(layout, 60);
    document.addEventListener('fullscreenchange', onFs);

    /* ---------------- 時間軸 ---------------- */
    const tl = $('#tl');
    const frameAtX = (x) => {
      const r = tl.getBoundingClientRect();
      return Math.round(Math.min(1, Math.max(0, (x - r.left) / r.width)) * Math.max(0, player.total - 1));
    };
    let scrubbing = false;
    tl.addEventListener('pointerdown', (e) => {
      if (!player.loaded()) return;
      const mk = e.target.closest('.tl-mark');
      if (mk) { selectNote(mk.dataset.id, true); return; }
      scrubbing = true; tl.setPointerCapture(e.pointerId);
      player.pause(); player.seekFrame(frameAtX(e.clientX));
    });
    tl.addEventListener('pointermove', (e) => {
      const hv = $('.tl-hover', tl);
      if (!player.loaded()) return;
      const f = frameAtX(e.clientX);
      hv.classList.remove('hidden');
      hv.style.left = (e.clientX - tl.getBoundingClientRect().left) + 'px';
      const mk = e.target.closest('.tl-mark');
      const n = mk && S.notes.find((x) => x.id === mk.dataset.id);
      hv.textContent = n ? player.tc(n.inFrame) + '　' + String(n.text || '（畫記）').slice(0, 30) : player.tc(f);
      if (scrubbing) player.seekFrame(f);
    });
    tl.addEventListener('pointerup', () => { scrubbing = false; });
    tl.addEventListener('pointerleave', () => { $('.tl-hover', tl).classList.add('hidden'); });

    function pctOf(f) { return Math.min(100, Math.max(0, f / Math.max(1, player.total - 1) * 100)); }
    function renderMarks() {
      const box = $('.tl-marks', tl);
      if (!player.total) { box.innerHTML = ''; return; }
      box.innerHTML = filtered().map((n) => {
        const left = pctOf(n.inFrame), w = n.outFrame > n.inFrame ? pctOf(n.outFrame) - left : 0;
        return `<div class="tl-mark ${n.id === S.sel ? 'sel' : ''}" data-id="${esc(n.id)}" style="left:${left}%;${w ? `width:calc(${w}% + 8px);` : ''}background:${STATUS_VAR[n.status]}"></div>`;
      }).join('');
      renderIO();
    }
    function renderIO() {
      const io = $('#tlIO');
      if (S.inF !== null && player.total) {
        const out = S.outF !== null ? S.outF : S.inF;
        io.classList.remove('hidden');
        io.style.left = pctOf(S.inF) + '%';
        io.style.width = Math.max(0.3, pctOf(out) - pctOf(S.inF)) + '%';
      } else io.classList.add('hidden');
      const selEl = $('#tlSel');
      const n = S.sel && S.notes.find((x) => x.id === S.sel);
      if (n && n.outFrame > n.inFrame && player.total) {
        selEl.classList.remove('hidden');
        selEl.style.left = pctOf(n.inFrame) + '%';
        selEl.style.width = (pctOf(n.outFrame) - pctOf(n.inFrame)) + '%';
      } else selEl.classList.add('hidden');
    }

    /* ---------------- 畫記 ---------------- */
    annot.color = localStorage.getItem('rt_color') || COLORS[0];
    function setDrawMode(on) {
      if (!canComment) return;
      if (on && !player.loaded()) { RT.toast('請先載入影片'); return; }
      S.drawMode = on;
      if (on) {
        player.pause();
        if (S.draftFrame !== null && S.draftFrame !== player.frame) player.seekFrame(S.draftFrame);
      }
      annot.setEnabled(on);
      $('#btnDraw').classList.toggle('on', on);
      $('#drawTools').style.opacity = on ? 1 : 0.45;
      $('#drawHint').textContent = on ? '在畫面上畫出需要修改的地方，按 Esc 結束' : '按 D 開始畫記';
      updateToolUI();
    }
    function updateToolUI() {
      if (!canComment) return;
      $$('[data-tool]').forEach((b) => b.classList.toggle('on', S.drawMode && b.dataset.tool === annot.tool));
      $$('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === annot.color));
    }
    if (canComment) {
      $('#btnDraw').onclick = () => setDrawMode(!S.drawMode);
      $('.drawbar').addEventListener('click', (e) => {
        const t = e.target.closest('[data-tool]'), c = e.target.closest('[data-color]'), d = e.target.closest('[data-d]');
        if (t) { annot.setTool(t.dataset.tool); if (!S.drawMode) setDrawMode(true); updateToolUI(); }
        if (c) { annot.color = c.dataset.color; localStorage.setItem('rt_color', annot.color); if (!S.drawMode) setDrawMode(true); updateToolUI(); }
        if (d) { if (d.dataset.d === 'undo') annot.undo(); if (d.dataset.d === 'redo') annot.redo(); if (d.dataset.d === 'clear') annot.clear(); }
      });
      $('#widthSel').onchange = (e) => { annot.width = Number(e.target.value); };
      setDrawMode(false);
    }
    annot.on('start', () => {
      if (S.draftFrame !== null && S.draftFrame !== player.frame) { S.draftFrame = player.frame; }
      annot.draftHidden = false;
    });
    annot.on('change', () => {
      if (annot.hasDraft()) { if (S.draftFrame === null) S.draftFrame = player.frame; }
      else S.draftFrame = null;
      updateComposerTC();
    });
    function updateOverlay() {
      const f = player.frame;
      const n = S.sel && S.notes.find((x) => x.id === S.sel);
      if (n && f >= n.inFrame && f <= Math.max(n.inFrame, n.outFrame)) annot.view = n.drawing || [], annot.viewPin = n.pinX !== null && n.pinX !== undefined ? { x: n.pinX, y: n.pinY } : null;
      else { annot.view = []; annot.viewPin = null; }
      annot.draftHidden = S.draftFrame !== null && S.draftFrame !== f;
      annot.render();
    }

    /* ---------------- 新增註記 ---------------- */
    function noteFrames() {
      let inF = S.inF !== null ? S.inF : (S.draftFrame !== null ? S.draftFrame : player.frame);
      let outF = S.outF !== null ? S.outF : inF;
      if (outF < inF) [inF, outF] = [outF, inF];
      return [inF, outF];
    }
    function updateComposerTC() {
      if (!canComment || !$('#cTC')) return;
      if (!player.loaded()) { $('#cTC').textContent = '（請先載入影片）'; $('#cRange').textContent = ''; return; }
      const [inF, outF] = noteFrames();
      $('#cTC').textContent = player.tc(inF);
      $('#cRange').textContent = outF > inF ? `→ ${player.tc(outF)}（${outF - inF + 1} 格）` : '';
      $('#cClearIO').classList.toggle('hidden', S.inF === null);
      const parts = [];
      if (annot.shapes.length) parts.push(`畫記 ${annot.shapes.length} 筆`);
      if (annot.pin) parts.push('定位點');
      $('#cDrawInfo').textContent = parts.join('・');
    }
    function renderAttach(list, box, onRemove) {
      box.innerHTML = list.map((a, i) => `<div class="a" data-i="${i}"><img src="${a.dataUrl}"><button data-rm="${i}" aria-label="移除">✕</button></div>`).join('');
      box.onclick = (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) { list.splice(Number(rm.dataset.rm), 1); onRemove(); return; }
        const a = e.target.closest('[data-i]');
        if (a) RT.lightbox(list[Number(a.dataset.i)].dataUrl);
      };
    }
    async function addImages(files, list, rerender) {
      for (const f of files) {
        if (!/^image\//.test(f.type)) continue;
        if (list.length >= 6) { RT.toast('最多 6 張圖片'); break; }
        try { list.push({ name: f.name || 'image.jpg', dataUrl: await RT.imageToDataUrl(f, 1600) }); } catch (e) { RT.fail(e); }
      }
      rerender();
    }
    if (canComment) {
      const ta = $('#cText');
      const rerenderC = () => renderAttach(S.attach, $('#cAttach'), rerenderC);
      $('#cAttachBtn').onclick = () => $('#cAttachFile').click();
      $('#cAttachFile').onchange = (e) => { addImages([...e.target.files], S.attach, rerenderC); e.target.value = ''; };
      ta.addEventListener('paste', (e) => {
        const files = [...(e.clipboardData || {}).items || []].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
        if (files.length) { e.preventDefault(); addImages(files, S.attach, rerenderC); }
      });
      ta.addEventListener('focus', () => { if (player.playing) player.pause(); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendNote(); } });
      attachMention(ta);
      $('#cSend').onclick = sendNote;
      $('#cClearIO').onclick = clearIO;
    }

    function seekAndWait(f) {
      return new Promise((resolve) => {
        if (player.frame === f && !vA.seeking) { resolve(); return; }
        let done = false;
        const fin = () => { if (done) return; done = true; vA.removeEventListener('seeked', h); setTimeout(resolve, 40); };
        const h = () => { if (!vA.seeking && player.pendingSeek === null) fin(); };
        vA.addEventListener('seeked', h);
        player.seekFrame(f);
        setTimeout(fin, 2500);
      });
    }

    async function sendNote() {
      const btn = $('#cSend');
      if (btn.disabled) return;
      if (!player.loaded()) { RT.toast('請先載入影片，才能在畫面上新增註記'); return; }
      const text = $('#cText').value.trim();
      if (!text && !annot.hasDraft()) { RT.toast('請輸入註記內容或畫記'); $('#cText').focus(); return; }
      const [inF, outF] = noteFrames();
      await RT.busy(btn, async () => {
        try {
          player.pause();
          await seekAndWait(inF);
          const thumb = RT.captureFrame(vA, annot.shapes, annot.pin, 480);
          const res = await RT.call('saveNote', {
            note: {
              versionId: vid, inFrame: inF, outFrame: outF, text, drawing: annot.shapes.length ? annot.shapes : null,
              pinX: annot.pin ? annot.pin.x : null, pinY: annot.pin ? annot.pin.y : null,
              assignee: $('#cAssignee') ? $('#cAssignee').value : '', dueDate: $('#cDue') ? $('#cDue').value : '',
              internal: $('#cInternal') ? $('#cInternal').checked : false, thumbData: thumb, attachData: S.attach
            }
          });
          if (thumb && res.note.thumbId) RT.putFileCache(res.note.thumbId, thumb);
          S.notes.push(res.note);
          $('#cText').value = ''; S.attach = []; $('#cAttach').innerHTML = '';
          if ($('#cInternal')) $('#cInternal').checked = false;
          annot.clear(); S.draftFrame = null; setDrawMode(false);
          clearIO();
          renderNotes(); renderMarks(); updateFilterOptions();
          RT.toast('註記已送出', 'ok');
        } catch (e) { RT.fail(e); }
      });
    }

    /* @提及自動完成 */
    function attachMention(ta) {
      const pop = RT.el('<div class="menu mention-pop hidden"></div>');
      ta.parentElement.appendChild(pop);
      let items = [], idx = 0;
      const close = () => { pop.classList.add('hidden'); items = []; };
      const pick = (p) => {
        const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@([\w.-]*)$/, '@' + p.username + ' ');
        ta.value = before + ta.value.slice(pos);
        ta.selectionStart = ta.selectionEnd = before.length;
        close(); ta.focus();
      };
      ta.addEventListener('input', () => {
        const m = ta.value.slice(0, ta.selectionStart).match(/@([\w.-]*)$/);
        if (!m) { close(); return; }
        const qq = m[1].toLowerCase();
        items = data.people.filter((p) => p.username.toLowerCase().includes(qq) || p.displayName.toLowerCase().includes(qq)).slice(0, 6);
        if (!items.length) { close(); return; }
        idx = 0;
        pop.innerHTML = items.map((p, i) => `<button type="button" data-i="${i}">${esc(p.displayName)} <span class="dim">@${esc(p.username)}</span></button>`).join('');
        pop.style.left = '0'; pop.style.top = (ta.offsetHeight + 2) + 'px';
        pop.classList.remove('hidden');
      });
      ta.addEventListener('keydown', (e) => {
        if (!items.length || pop.classList.contains('hidden')) return;
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[idx]); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; }
        else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + items.length - 1) % items.length; }
        else if (e.key === 'Escape') { e.stopPropagation(); close(); }
        $$('button', pop).forEach((b, i) => b.style.background = i === idx ? 'var(--bg4)' : '');
      });
      pop.addEventListener('mousedown', (e) => { e.preventDefault(); const b = e.target.closest('[data-i]'); if (b) pick(items[Number(b.dataset.i)]); });
      ta.addEventListener('blur', () => setTimeout(close, 150));
    }

    /* ---------------- 註記列表 ---------------- */
    function fmtText(s) {
      return escText(s)
        .replace(/@([A-Za-z0-9_.-]{2,32})/g, (m, u) => peopleMap[u.toLowerCase()] ? `<span class="mention">@${esc(peopleMap[u.toLowerCase()].displayName)}</span>` : m)
        .replace(/#([\w一-鿿぀-ヿ-]{1,30})/g, '<span class="tag">#$1</span>');
    }
    function tcOf(n, which) { return RT.noteTC(n, version, which); }
    function filtered() {
      const f = S.filters, me = user.username.toLowerCase();
      const qq = f.q.trim().toLowerCase();
      let list = S.notes.filter((n) => {
        if (!f.status.has(n.status)) return false;
        if (f.assignee === '__me' && String(n.assignee).toLowerCase() !== me && !(n.mentions || []).includes(me)) return false;
        if (f.assignee === '__none' && n.assignee) return false;
        if (f.assignee && f.assignee[0] !== '_' && String(n.assignee).toLowerCase() !== f.assignee) return false;
        if (f.tag && !(n.tags || []).includes(f.tag)) return false;
        if (qq) {
          const hay = [n.text, n.authorName, (n.tags || []).map((t) => '#' + t).join(' '), (n.mentions || []).map((t) => '@' + t).join(' '),
            (n.replies || []).map((r) => r.text).join(' '), tcOf(n)].join(' ').toLowerCase();
          if (!hay.includes(qq)) return false;
        }
        return true;
      });
      if (S.sort === 'new') list.sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
      else if (S.sort === 'upd') list.sort((a, b) => (a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1);
      else list.sort((a, b) => a.inFrame - b.inFrame || (a.createdAt < b.createdAt ? -1 : 1));
      return list;
    }
    function numberOf(n) {
      const byTc = S.notes.slice().sort((a, b) => a.inFrame - b.inFrame || (a.createdAt < b.createdAt ? -1 : 1));
      return byTc.indexOf(n) + 1;
    }
    function statusControl(n) {
      if (isGuest) return RT.statusPill(n.status);
      const allowed = isAdmin ? RTCore.NOTE_STATUS : RTCore.VENDOR_NOTE_STATUS;
      const opts = RTCore.NOTE_STATUS.filter((s) => allowed.includes(s) || s === n.status);
      return `<select class="pill st-${esc(n.status)}" data-status="${esc(n.id)}" style="height:22px;padding:0 4px;border:1px solid transparent">${opts.map((s) => `<option ${s === n.status ? 'selected' : ''} ${allowed.includes(s) ? '' : 'disabled'}>${s}</option>`).join('')}</select>`;
    }
    function noteHTML(n) {
      const sel = n.id === S.sel;
      const today = RT.todayStr();
      const done = RTCore.NOTE_DONE.includes(n.status);
      const assignee = n.assignee ? (peopleMap[String(n.assignee).toLowerCase()] || {}).displayName || n.assignee : '';
      const canEdit = isAdmin || n.author === user.username;
      let html = `<div class="note ${sel ? 'sel' : ''}" data-note="${esc(n.id)}">
        <div class="head"><span class="num">#${numberOf(n)}</span><span class="tcl">${esc(tcOf(n))}${n.outFrame > n.inFrame ? ' → ' + esc(tcOf(n, 'out')) : ''}</span>
          ${n.internal ? '<span class="internal-badge">內部</span>' : ''}${n.carriedFrom ? `<span class="carry-badge">沿用 ${esc(n.carriedFrom.split(':')[0])}</span>` : ''}
          <span class="sp"></span>${statusControl(n)}</div>
        <div class="body">
          ${n.thumbId ? `<div class="thumb"><img data-file="${esc(n.thumbId)}" alt=""></div>` : (n.drawing || n.pinX !== null ? '<div class="thumb">✎ 畫記</div>' : '')}
          <div class="grow"><div class="txt">${fmtText(n.text) || '<span class="dim">（僅畫記）</span>'}</div></div>
        </div>
        <div class="meta"><span>${esc(n.authorName)}</span><span>${esc(RT.fmtTime(n.createdAt))}</span>
          ${assignee ? `<span>負責 ${esc(assignee)}</span>` : ''}
          ${n.dueDate ? `<span class="${!done && n.dueDate < today ? 'overdue' : ''}">截止 ${esc(n.dueDate)}</span>` : ''}
          ${n.attachIds.length ? `<span>📎 ${n.attachIds.length}</span>` : ''}
          ${n.replies.length ? `<span>💬 ${n.replies.filter((r) => r.text || (r.attachIds && r.attachIds.length)).length}</span>` : ''}</div>`;
      if (sel) {
        html += `<div class="detail">
          ${n.attachIds.length ? `<div class="attach-list" style="margin-bottom:8px">${n.attachIds.map((id) => `<div class="a" data-zoom="${esc(id)}"><img data-file="${esc(id)}"></div>`).join('')}</div>` : ''}
          ${n.replies.map((r) => `<div class="reply">
            <div class="who">${esc(r.authorName)}・${esc(RT.fmtTime(r.createdAt))}${r.internal ? ' <span class="internal-badge">內部</span>' : ''}
              ${(isAdmin || r.author === user.username) && (r.text || (r.attachIds && r.attachIds.length)) ? `<button class="btn sm ghost" data-delreply="${esc(r.id)}" style="height:18px;padding:0 4px;font-size:11px">刪除</button>` : ''}</div>
            ${r.statusChange ? `<div class="sc">狀態 ${esc(r.statusChange)}</div>` : ''}
            ${r.text ? `<div class="txt">${fmtText(r.text)}</div>` : ''}
            ${r.attachIds && r.attachIds.length ? `<div class="attach-list">${r.attachIds.map((id) => `<div class="a" data-zoom="${esc(id)}"><img data-file="${esc(id)}"></div>`).join('')}</div>` : ''}
          </div>`).join('')}
          ${canComment ? `<div class="reply-box">
            <textarea data-reply="${esc(n.id)}" placeholder="回覆，或回報修改進度…（Ctrl+Enter 送出）">${esc(S.replyDraft[n.id] || '')}</textarea>
            <div class="attach-list" data-rattach="${esc(n.id)}"></div>
            <div class="row wrap" style="margin-top:6px">
              <button class="btn sm" data-rimg="${esc(n.id)}">📎 圖片</button>
              ${isGuest ? '' : `<select data-rstatus="${esc(n.id)}" style="height:26px;font-size:12.5px"><option value="">狀態不變</option>${(isAdmin ? RTCore.NOTE_STATUS : RTCore.VENDOR_NOTE_STATUS).filter((s) => s !== n.status).map((s) => `<option>${s}</option>`).join('')}</select>`}
              ${isAdmin ? `<label class="chk" style="font-size:12px"><input type="checkbox" data-rinternal="${esc(n.id)}"> 內部</label>` : ''}
              <span class="sp"></span><button class="btn sm primary" data-rsend="${esc(n.id)}">回覆</button>
            </div></div>` : ''}
          <div class="row wrap" style="margin-top:8px">
            ${!isGuest ? `<button class="btn sm ghost" data-assign="${esc(n.id)}">指派／截止日</button>` : ''}
            ${canEdit ? `<button class="btn sm ghost" data-edit="${esc(n.id)}">編輯</button><button class="btn sm ghost danger" data-del="${esc(n.id)}">刪除</button>` : ''}
            <span class="sp"></span>
            ${n.outFrame > n.inFrame ? `<button class="btn sm ghost" data-loopnote="${esc(n.id)}">循環此段</button>` : ''}
          </div>
        </div>`;
      }
      return html + '</div>';
    }

    function renderNotes() {
      const list = filtered();
      const box = $('#notes');
      const st = box.scrollTop;
      box.innerHTML = list.length ? list.map(noteHTML).join('')
        : `<div class="empty" style="margin:10px">${S.notes.length ? '沒有符合篩選條件的註記' : (canComment ? '還沒有註記。<br>暫停在需要修改的畫面，在上方輸入說明，或按 D 在畫面上畫記。' : '還沒有註記。')}</div>`;
      box.scrollTop = st;
      $('#noteCount').textContent = `共 ${S.notes.length} 則` + (list.length !== S.notes.length ? `・顯示 ${list.length}` : '');
      RTCore.NOTE_STATUS.forEach((s) => { const c = $(`[data-cnt="${s}"]`); if (c) c.textContent = S.notes.filter((n) => n.status === s).length; });
      const ids = $$('img[data-file]', box).map((i) => i.dataset.file);
      if (ids.length) RT.getFiles(ids).then((files) => {
        $$('img[data-file]', box).forEach((img) => { const d = files[img.dataset.file]; if (d && img.src !== d) img.src = d; });
      });
      $$('[data-rattach]', box).forEach((el) => {
        const id = el.dataset.rattach;
        S.replyAttach[id] = S.replyAttach[id] || [];
        const rr = () => renderAttach(S.replyAttach[id], el, rr);
        rr();
      });
      $$('textarea[data-reply]', box).forEach((ta) => attachMention(ta));
      renderMarks();
      updateOverlay();
    }

    function updateFilterOptions() {
      const tags = [...new Set(S.notes.flatMap((n) => n.tags || []))].sort();
      const sel = $('#fTag'), cur = sel.value;
      sel.innerHTML = '<option value="">所有標籤</option>' + tags.map((t) => `<option value="${esc(t)}" ${t === cur ? 'selected' : ''}>#${esc(t)}</option>`).join('');
    }

    function selectNote(id, seek) {
      S.sel = S.sel === id && !seek ? null : id;
      const n = S.notes.find((x) => x.id === id);
      if (n && seek !== false && player.loaded()) { player.pause(); player.seekFrame(n.inFrame); }
      renderNotes();
      const el = $(`[data-note="${CSS.escape(id)}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function replaceNote(n) {
      const i = S.notes.findIndex((x) => x.id === n.id);
      if (i >= 0) S.notes[i] = n; else S.notes.push(n);
    }

    $('#notes').addEventListener('change', async (e) => {
      const s = e.target.closest('[data-status]');
      if (s) {
        try {
          const res = await RT.call('saveNote', { note: { id: s.dataset.status, status: s.value } });
          replaceNote(res.note); renderNotes(); RT.toast('狀態：' + res.note.status, 'ok');
        } catch (er) { RT.fail(er); renderNotes(); }
      }
    });
    $('#notes').addEventListener('input', (e) => { const t = e.target.closest('[data-reply]'); if (t) S.replyDraft[t.dataset.reply] = t.value; });
    $('#notes').addEventListener('keydown', (e) => {
      const t = e.target.closest('[data-reply]');
      if (t && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendReply(t.dataset.reply); }
    });
    $('#notes').addEventListener('paste', (e) => {
      const t = e.target.closest('[data-reply]');
      if (!t) return;
      const files = [...(e.clipboardData || {}).items || []].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); const id = t.dataset.reply; addImages(files, S.replyAttach[id], renderNotes); }
    });
    $('#notes').addEventListener('click', async (e) => {
      const t = e.target;
      const b = t.closest('button, [data-zoom], select, textarea, input, label');
      if (b) {
        if (b.dataset.zoom) { const f = await RT.getFiles([b.dataset.zoom]); if (f[b.dataset.zoom]) RT.lightbox(f[b.dataset.zoom]); return; }
        if (b.dataset.rsend) return sendReply(b.dataset.rsend);
        if (b.dataset.rimg) {
          const id = b.dataset.rimg, inp = RT.el('<input type="file" accept="image/*" multiple>');
          inp.onchange = () => addImages([...inp.files], S.replyAttach[id], renderNotes);
          inp.click(); return;
        }
        if (b.dataset.del) {
          if (await RT.confirm('刪除這則註記與所有回覆？無法復原。', '刪除', true)) {
            try { await RT.call('deleteNote', { id: b.dataset.del }); S.notes = S.notes.filter((n) => n.id !== b.dataset.del); S.sel = null; renderNotes(); } catch (er) { RT.fail(er); }
          }
          return;
        }
        if (b.dataset.delreply) {
          if (await RT.confirm('刪除這則回覆？', '刪除', true)) {
            try {
              await RT.call('deleteReply', { id: b.dataset.delreply });
              S.notes.forEach((n) => { n.replies = n.replies.filter((r) => r.id !== b.dataset.delreply); });
              renderNotes();
            } catch (er) { RT.fail(er); }
          }
          return;
        }
        if (b.dataset.edit) return editNote(S.notes.find((n) => n.id === b.dataset.edit));
        if (b.dataset.assign) return assignNote(S.notes.find((n) => n.id === b.dataset.assign));
        if (b.dataset.loopnote) {
          const n = S.notes.find((x) => x.id === b.dataset.loopnote);
          S.inF = n.inFrame; S.outF = n.outFrame; ioChanged();
          if (!S.loopOn) toggleLoop();
          player.seekFrame(n.inFrame); player.play();
          return;
        }
        return;
      }
      const card = t.closest('[data-note]');
      if (card) {
        if (t.closest('.detail')) return;
        selectNote(card.dataset.note, card.dataset.note !== S.sel);
      }
    });

    async function sendReply(id) {
      const ta = $(`textarea[data-reply="${CSS.escape(id)}"]`);
      const st = $(`[data-rstatus="${CSS.escape(id)}"]`);
      const internal = $(`[data-rinternal="${CSS.escape(id)}"]`);
      const btn = $(`[data-rsend="${CSS.escape(id)}"]`);
      const text = ta.value.trim(), status = st ? st.value : '';
      const attach = S.replyAttach[id] || [];
      if (!text && !status && !attach.length) { RT.toast('請輸入回覆內容'); return; }
      await RT.busy(btn, async () => {
        try {
          const res = await RT.call('addReply', { noteId: id, text, status, internal: internal ? internal.checked : false, attachData: attach });
          replaceNote(res.note);
          S.replyDraft[id] = ''; S.replyAttach[id] = [];
          renderNotes();
          RT.toast('已回覆', 'ok');
        } catch (e) { RT.fail(e); }
      });
    }

    function editNote(n) {
      RT.modal({
        title: '編輯註記 ' + tcOf(n),
        body: `<label class="field"><span>內容</span><textarea name="text" rows="5">${esc(n.text)}</textarea></label>
          ${player.loaded() ? `<div class="grid2">
            <label class="field"><span>入點</span><input type="text" class="mono" name="in" value="${esc(tcOf(n))}"></label>
            <label class="field"><span>出點</span><input type="text" class="mono" name="out" value="${esc(tcOf(n, 'out'))}"></label></div>` : ''}
          ${isAdmin ? `<label class="chk"><input type="checkbox" name="internal" ${n.internal ? 'checked' : ''}> 內部註記（廠商與訪客看不到）</label>` : ''}
          ${n.drawing || n.pinX !== null ? '<label class="chk" style="margin-top:8px"><input type="checkbox" name="clearDraw"> 移除畫記與定位點</label>' : ''}`,
        okText: '儲存', noEnter: true,
        onOk: async (m) => {
          const patch = { id: n.id, text: $('[name=text]', m).value };
          if ($('[name=in]', m)) {
            const inF = player.parseTC($('[name=in]', m).value), outF = player.parseTC($('[name=out]', m).value);
            if (!isFinite(inF) || !isFinite(outF) || inF < 0) throw new Error('時間碼格式錯誤');
            patch.inFrame = Math.min(inF, outF); patch.outFrame = Math.max(inF, outF);
          }
          if ($('[name=internal]', m)) patch.internal = $('[name=internal]', m).checked;
          if ($('[name=clearDraw]', m) && $('[name=clearDraw]', m).checked) { patch.drawing = null; patch.pinX = null; patch.pinY = null; }
          const res = await RT.call('saveNote', { note: patch });
          replaceNote(res.note); renderNotes(); updateFilterOptions();
        }
      });
    }
    function assignNote(n) {
      RT.modal({
        title: '指派與截止日',
        body: `<label class="field"><span>負責人</span><select name="a"><option value="">未指派</option>${data.people.map((p) => `<option value="${esc(p.username.toLowerCase())}" ${String(n.assignee).toLowerCase() === p.username.toLowerCase() ? 'selected' : ''}>${esc(p.displayName)}</option>`).join('')}</select></label>
          <label class="field"><span>截止日</span><input type="date" name="d" value="${esc(n.dueDate || '')}"></label>`,
        okText: '儲存',
        onOk: async (m) => {
          const res = await RT.call('saveNote', { note: { id: n.id, assignee: $('[name=a]', m).value, dueDate: $('[name=d]', m).value } });
          replaceNote(res.note); renderNotes();
        }
      });
    }

    /* 篩選 */
    $('#fQ').oninput = (e) => { S.filters.q = e.target.value; renderNotes(); };
    $('#fSort').onchange = (e) => { S.sort = e.target.value; renderNotes(); };
    $('#fAssignee').onchange = (e) => { S.filters.assignee = e.target.value; renderNotes(); };
    $('#fTag').onchange = (e) => { S.filters.tag = e.target.value; renderNotes(); };
    $('#fStatus').onclick = (e) => {
      const b = e.target.closest('[data-st]');
      if (!b) return;
      const st = b.dataset.st;
      if (e.altKey || e.shiftKey) { S.filters.status = new Set([st]); }
      else if (S.filters.status.has(st)) S.filters.status.delete(st); else S.filters.status.add(st);
      $$('[data-st]').forEach((x) => x.classList.toggle('on', S.filters.status.has(x.dataset.st)));
      renderNotes();
    };

    /* ---------------- 自動更新 ---------------- */
    async function refresh(manual) {
      try {
        const res = await RT.call('listNotes', { versionId: vid });
        const sig = JSON.stringify(res.notes);
        if (sig === S.lastSig && !manual) return;
        S.lastSig = sig;
        const active = document.activeElement;
        if (!manual && active && $('#notes').contains(active) && active.tagName === 'TEXTAREA') return; // 正在打字，稍後再更新
        S.notes = res.notes;
        renderNotes(); updateFilterOptions();
        if (manual) RT.toast('已更新');
      } catch (e) { if (manual || e.code === 'AUTH') RT.fail(e); }
    }
    $('#refreshBtn').onclick = () => refresh(true);
    S.lastSig = JSON.stringify(S.notes);
    if (!RT.isDemo && cfg.REFRESH_SECONDS > 0) {
      S.timers.push(setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, cfg.REFRESH_SECONDS * 1000));
    }

    /* ---------------- 上方工具列 ---------------- */
    $('#verSel').onchange = (e) => { location.hash = '#/r/' + e.target.value; };
    if ($('#verStatus')) $('#verStatus').onchange = async (e) => {
      try { await RT.call('saveVersion', { version: { id: vid, status: e.target.value } }); version.status = e.target.value; RT.toast('版本狀態：' + e.target.value, 'ok'); }
      catch (er) { RT.fail(er); e.target.value = version.status; }
    };
    $('#srcBtn').onclick = () => { player.pause(); showLoader(); };
    $('#expBtn').onclick = (e) => {
      e.stopPropagation();
      const old = $('.rv-top .menu'); if (old) { old.remove(); return; }
      const menu = RT.el('<div class="menu" style="position:absolute;right:50px;top:44px"><button data-k="xlsx">匯出 Excel（含截圖）</button><button data-k="pdf">匯出 PDF</button></div>');
      $('.rv-top').style.position = 'relative';
      $('.rv-top').appendChild(menu);
      menu.onclick = (ev) => { const k = ev.target.dataset.k; menu.remove(); if (k) RT.exportDialog(data, k, vid); };
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
    };
    $('#helpBtn').onclick = showHelp;
    function showHelp() {
      const rows = [['Space / K', '播放 / 暫停'], ['J / L', '倒轉 / 快轉（連按加速）'], ['← / →', '上一格 / 下一格'], ['Shift + ← / →', '後退 / 前進 1 秒'],
        ['Home / End', '開頭 / 結尾'], ['↑ / ↓', '上一則 / 下一則註記'], ['I / O', '設定入點 / 出點'], ['Alt + X', '清除入出點'], ['R', '循環播放'],
        ['D', '畫記模式'], ['Ctrl + Z / Ctrl + Shift + Z', '復原 / 重做畫記'], ['G', '切換安全框 / 遮罩'], ['F', '全螢幕'], ['C', '輸入註記'], ['Ctrl + Enter', '送出註記 / 回覆'], ['Esc', '結束畫記 / 取消選取']];
      RT.modal({ title: '快捷鍵', body: `<table class="table">${rows.map((r) => `<tr><td><span class="kbd">${esc(r[0])}</span></td><td>${esc(r[1])}</td></tr>`).join('')}</table>`, okText: null, cancelText: '關閉', noFocus: true });
    }

    /* ---------------- 並排比對 ---------------- */
    $('#cmpBtn').onclick = () => {
      const others = data.versions.filter((v) => v.id !== vid);
      RT.modal({
        title: '並排比對',
        body: `<label class="field"><span>要和 ${esc(version.label)} 比對的版本</span><select name="v">${others.slice().reverse().map((v) => `<option value="${esc(v.id)}">${esc(v.label)}${v.remark ? '・' + esc(v.remark) : ''}</option>`).join('')}</select></label>
          <div class="field"><span>影片來源</span><input type="file" name="file" accept="video/*"><div class="hint" data-hint></div></div>`,
        okText: '開始比對',
        onOpen: (m) => {
          const hint = () => {
            const v = others.find((x) => x.id === $('[name=v]', m).value);
            $('[data-hint]', m).textContent = v.url ? '此版本有雲端連結，不選檔案也可以自動載入。' : v.fileName ? `請選擇本機檔案：${v.fileName}` : '請選擇此版本的影片檔';
          };
          $('[name=v]', m).onchange = hint; hint();
        },
        onOk: async (m) => {
          const v = others.find((x) => x.id === $('[name=v]', m).value);
          const file = $('[name=file]', m).files[0] || RT.pendingFiles[v.id];
          if (!file && !v.url) throw new Error('請選擇影片檔');
          await startCompare(v, file ? { file } : { url: RT.normalizeVideoUrl(v.url) });
        }
      });
    };
    async function startCompare(v, src) {
      if (!player.loaded()) throw new Error('請先載入目前版本的影片');
      $('#paneB').classList.remove('hidden');
      $('#panes').classList.add('compare');
      $('.pane-label', $('#paneA')).classList.remove('hidden');
      if (!pB) pB = new RT.Player($('#vB'));
      pB.video.muted = true;
      await pB.load(src);
      pB.setMeta({ fps: v.fps, df: v.dropFrame, startTC: v.startTC, total: v.durationFrames });
      if (src.file) RT.pendingFiles[v.id] = src.file;
      pB.on('frame', (f) => { $('.tc-burn', $('#paneB')).textContent = pB.tc(f); });
      S.compare = v;
      $('.pane-label', $('#paneB')).textContent = v.label + '（比對）';
      $('#paneB .wm').classList.toggle('hidden', !(project.watermark && !isAdmin));
      pB.seekFrame(player.frame);
      setTimeout(layout, 30);
    }
    $('#cmpClose').onclick = () => {
      S.compare = null;
      if (pB) pB.unload();
      $('#paneB').classList.add('hidden');
      $('#panes').classList.remove('compare');
      $('.pane-label', $('#paneA')).classList.add('hidden');
      setTimeout(layout, 30);
    };

    /* ---------------- 快捷鍵 ---------------- */
    function onKey(e) {
      if ($('.modal-back')) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) annot.redo(); else annot.undo(); return; }
      if (ctrl && k === 'y') { e.preventDefault(); annot.redo(); return; }
      if (ctrl) return;
      const list = filtered();
      const idx = list.findIndex((n) => n.id === S.sel);
      const handled = () => e.preventDefault();
      switch (k) {
        case ' ': handled(); transport('play'); break;
        case 'k': case 'K': handled(); player.shuttle(0); break;
        case 'j': case 'J': handled(); player.shuttle(-1); break;
        case 'l': case 'L': handled(); player.shuttle(1); break;
        case 'ArrowLeft': case ',': handled(); transport(e.shiftKey ? '-s' : '-1'); break;
        case 'ArrowRight': case '.': handled(); transport(e.shiftKey ? '+s' : '+1'); break;
        case 'Home': handled(); transport('start'); break;
        case 'End': handled(); transport('end'); break;
        case 'ArrowUp': handled(); if (list.length) selectNote(list[Math.max(0, idx - 1)].id, true); break;
        case 'ArrowDown': handled(); if (list.length) selectNote(list[idx < 0 ? 0 : Math.min(list.length - 1, idx + 1)].id, true); break;
        case 'i': case 'I': handled(); transport('in'); break;
        case 'o': case 'O': handled(); transport('out'); break;
        case 'x': case 'X': if (e.altKey) { handled(); clearIO(); } break;
        case '≈': handled(); clearIO(); break; // Mac 上 Alt+X
        case 'r': case 'R': handled(); toggleLoop(); break;
        case 'd': case 'D': handled(); setDrawMode(!S.drawMode); break;
        case 'g': case 'G': {
          handled();
          const ids = RT.GUIDES.map((g) => g.id);
          S.guide = ids[(ids.indexOf(S.guide) + 1) % ids.length];
          $('#guideSel').value = S.guide; localStorage.setItem('rt_guide', S.guide); layout();
          break;
        }
        case 'f': case 'F': handled(); toggleFs(); break;
        case 'c': case 'C': if ($('#cText')) { handled(); $('#cText').focus(); } break;
        case '?': handled(); showHelp(); break;
        case 'Escape':
          if (S.drawMode) setDrawMode(false);
          else if (S.sel) { S.sel = null; renderNotes(); }
          break;
      }
    }
    document.addEventListener('keydown', onKey);

    /* ---------------- 清理 ---------------- */
    RT.cleanup = () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      ro.disconnect();
      S.timers.forEach(clearInterval);
      player.unload();
      if (pB) pB.unload();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };

    /* ---------------- 開始 ---------------- */
    updateFilterOptions();
    renderNotes();
    updateFrameUI();
    if (RT.pendingFiles[vid]) loadFile(RT.pendingFiles[vid]);
    else if (version.url) loadUrl(version.url, false);
    else showLoader();
    if (S.sel) setTimeout(() => { const el = $(`[data-note="${CSS.escape(S.sel)}"]`); if (el) el.scrollIntoView({ block: 'center' }); }, 50);
  };
})();
