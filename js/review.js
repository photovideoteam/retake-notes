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

  RT.pendingSubs = RT.pendingSubs || {}; // 已載入的字幕（切換頁面時保留，只存在記憶體）

  RT.pageReview = async function (vid, q) {
    const main = RT.shell('projects', '<div class="dim" style="padding:30px">載入中…</div>');
    let data;
    try { data = await RT.call('getReview', { versionId: vid }); }
    catch (e) { RT.fail(e); main.innerHTML = `<div class="page"><div class="empty">${esc(e.message)}</div></div>`; return; }
    const version = data.versions.find((v) => v.id === vid);
    const project = data.project;
    const user = RT.user();
    // canManage：管理者，或此專案的專案負責人（可核准版本、修改／刪除任何註記與回覆）
    const canManage = !!data.canManage, isGuest = RT.isGuest(), isStaff = RT.isStaff();
    const canComment = !isGuest || RT.session.share.canComment;
    const peopleMap = {};
    data.people.forEach((p) => { peopleMap[p.username.toLowerCase()] = p; });
    document.title = `${version.label} · ${project.name} — ${cfg.SITE_NAME || 'Retake Notes'}`;

    const S = {
      notes: data.notes, sel: q.note || null, inF: null, outF: null, draftFrame: null, attach: [], drawMode: false,
      guide: localStorage.getItem('rt_guide') || '', filters: { status: new Set(RTCore.NOTE_STATUS), q: '', assignee: '', tag: '' },
      sort: 'tc', replyDraft: {}, replyAttach: {}, compare: null, timers: [], loopOn: false, lastSig: '', src: null
    };
    // 字幕狀態
    const SUB = { cues: [], errors: [], name: '', text: '', show: true, offset: false, onlyIssues: false, curKey: '', edit: null };
    let pageAlive = true;

    /* ---------------- 版面 ---------------- */
    const statusSel = isGuest ? RT.statusPill(version.status)
      : `<select id="verStatus" title="版本狀態">${RTCore.VERSION_STATUS.map((s) => `<option ${s === version.status ? 'selected' : ''} ${s === '已核准' && !canManage ? 'disabled' : ''}>${s}</option>`).join('')}</select>`;
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
                <div class="vlayer" id="layerA"><canvas class="guides"></canvas><div class="subs-ov" id="subOv"></div><canvas class="annot"></canvas><div class="wm hidden"></div></div>
                <div class="pane-label hidden"></div><div class="tc-burn"></div></div>
              <div class="pane hidden" id="paneB"><video id="vB" muted></video>
                <div class="vlayer" id="layerB"><canvas class="guides"></canvas><div class="wm hidden"></div></div>
                <div class="pane-label"></div><div class="tc-burn"></div>
                <button class="btn sm" id="cmpClose" style="position:absolute;bottom:8px;right:8px">結束比對</button></div>
            </div>
            <div class="meter hidden" id="meter" title="音量表（dBFS）：上方燈號黃色＝超過上限、紅色＝爆音；下方數字＝目前為止的最大峰值。點一下重設"><canvas></canvas></div>
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
            <button class="btn sm" data-t="subs" id="btnSubs" title="顯示 / 隱藏字幕 (S)">字幕</button>
            <button class="btn sm" data-t="meter" id="btnMeter" title="音量表 (M)">音量表</button>
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
          <div class="side-tabs" id="sideTabs">
            <button data-tab="notes" class="on">註記 <span class="cnt" id="tabCntNotes"></span></button>
            <button data-tab="subs">字幕 <span class="cnt" id="tabCntSubs"></span></button>
            <button data-tab="audio">聲音 <span class="cnt" id="tabCntAudio"></span></button>
          </div>
          <div class="side-pane" data-pane="notes">
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
              ${isStaff ? '<label class="chk" title="內部註記：廠商與訪客看不到" style="font-size:12.5px"><input type="checkbox" id="cInternal"> 內部</label>' : ''}
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
          </div>
          <div class="side-pane hidden" data-pane="subs">
            <div class="tool-head">
              <div class="row"><button class="btn sm primary" id="srtPick">載入字幕檔</button><input type="file" id="srtFile" accept=".srt,.vtt,text/plain" hidden>
                <button class="btn sm" id="asrBtn" title="用語音辨識自動產生字幕（在這台電腦上處理，不會上傳）">自動產生字幕</button>
                <span class="grow dim ellipsis" id="srtName" title="SRT / VTT 只在你的電腦上讀取，不會上傳">尚未載入</span>
                <button class="btn sm ghost hidden" id="srtClear" title="移除字幕">✕</button></div>
              <div id="asrBox" class="asr-box hidden"></div>
              <div class="row wrap" style="gap:4px 14px">
                <label class="chk"><input type="checkbox" id="srtShow" checked> 疊在畫面上</label>
                <label class="chk hidden" id="srtOffsetWrap" title="字幕檔的時間是以影片起始 TC 算起（例如 01:00:00,000 對應影片第一格）"><input type="checkbox" id="srtOffset"> 時間從起始 TC 算起</label>
                <label class="chk"><input type="checkbox" id="srtOnlyIssues"> 只看有問題的</label>
                <span class="sp"></span><button class="btn sm ghost" id="srtRules">檢查規則</button>
              </div>
              <div class="row" style="gap:6px"><button class="btn sm" id="srtAdd" title="在目前畫面的位置新增一句字幕">＋ 新增一句</button>
                <span class="sp"></span><button class="btn sm" id="srtExport" disabled title="把目前的字幕（含修改）存成 SRT 檔">匯出 SRT</button></div>
              <div id="srtSummary" class="tool-summary"></div>
            </div>
            <div class="tool-list" id="srtList"><div class="empty">載入字幕檔，或按「自動產生字幕」用語音辨識產生（一定要校對）。<br>會逐句列出時間碼並自動檢查：重疊、間隔太短、顯示太短 / 太長、閱讀速度、每行字數、行數、超出影片長度。<br>點一句可跳到該格；✎ 可修改文字與入出點；「＋註記」可把那句字幕直接加為註記；改完按「匯出 SRT」。</div></div>
          </div>
          <div class="side-pane hidden" data-pane="audio">
            <div class="tool-head">
              <div class="row wrap" style="gap:6px 10px">
                <button class="btn sm" id="audMeterBtn">顯示音量表</button>
                <label class="row" style="gap:6px;font-size:12.5px">上限 <select id="audThr" style="height:28px">${[0, -0.5, -1, -2, -3, -6].map((d) => `<option value="${d}">${d === 0 ? '0' : d} dBFS</option>`).join('')}</select></label>
                <span class="sp"></span><button class="btn sm ghost" id="audReset">重設</button>
              </div>
              <div class="aud-live" id="audLive"></div>
            </div>
            <div class="tool-list">
              <div class="tool-sec"><div class="row"><b>播放時偵測到的超標</b><span class="sp"></span><span class="dim" style="font-size:12px">時間約 ±2 格</span></div><div id="audEvents"></div></div>
              <div class="tool-sec"><div class="row"><b>整段分析</b><span class="sp"></span><button class="btn sm primary" id="audScan">開始分析</button></div>
                <p class="dim" style="font-size:12.5px;margin:6px 0 0">不用播放，直接讀取整個檔案的聲音：峰值、True Peak、整合響度（LUFS），並列出所有超過上限的時間點。本機檔案最準；雲端連結需允許跨網域讀取。</p>
                <div id="audReport"></div></div>
            </div>
          </div>
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
    if (project.watermark && !isStaff) {
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
        if (p === player) { annot.resize(r.w, r.h); $('#subOv').style.fontSize = Math.max(11, r.h * 0.048) + 'px'; }
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
      if (SUB.cues.length) updateSubs();
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
      const saved = S.savedHandle;
      loader.innerHTML = `<div class="box">
        <h2>載入 ${esc(version.label)} 的影片</h2>
        ${errMsg ? `<p class="err">${esc(errMsg)}</p>` : ''}
        ${saved ? `<div class="restore"><button class="btn primary" id="restoreFile">▶ 載入上次的檔案</button>
            <div class="mono restore-name">${esc(saved.name)}</div>
            <p class="dim">瀏覽器會詢問是否允許網站讀取這個檔案。若出現「每次造訪都允許」請選它，之後打開就會自動載入。</p></div>`
          : local ? `<p class="muted" style="margin:8px 0 0">此版本的本機檔案：<b>${esc(version.fileName)}</b>${version.fileSize ? `（${(version.fileSize / 1048576).toFixed(1)} MB）` : ''}</p>` : ''}
        <div class="drop" id="drop">${saved ? '或換一個檔案：拖曳到這裡，或' : '拖曳影片到這裡，或'}<br><button class="btn ${saved ? '' : 'primary'}" id="pickFile" style="margin-top:10px">選擇本機檔案</button>
          <input type="file" id="pickInput" accept="video/mp4,video/quicktime,video/*" hidden></div>
        ${RT.fileStore.canRemember ? '' : '<p class="dim" style="font-size:12px;margin:8px 0 0">提示：用 Chrome 或 Edge 開啟，網站可以記住本機檔案的位置，下次不用重新選檔。</p>'}
        <div class="row" style="margin-top:12px"><input type="url" id="srcUrl" class="grow" placeholder="或貼上雲端連結（Google Drive / Dropbox / mp4 網址）" value="${esc(version.url || '')}"><button class="btn" id="srcUrlBtn">載入</button></div>
        <p style="margin-top:14px"><button class="btn ghost sm" id="skipVideo">先不載入，只看註記 →</button></p>
      </div>`;
      $('#pickFile').onclick = async () => {
        if (!RT.fileStore.canRemember) { $('#pickInput').click(); return; }
        try { const r = await RT.fileStore.pickVideo(); if (r) loadFile(r.file, r.handle); }
        catch (e) { $('#pickInput').click(); } // 不支援時改用一般選檔
      };
      $('#pickInput').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };
      if (saved) $('#restoreFile').onclick = async () => {
        try { await loadFile(await RT.fileStore.fileFrom(saved, true), saved); }
        catch (e) {
          if (e.code === 'MISSING') { RT.fileStore.del('video:' + vid); S.savedHandle = null; showLoader(null, e.message); }
          else RT.toast(e.code === 'PERM' ? '沒有取得讀取權限，請再按一次並選「允許」' : e.message, 'bad');
        }
      };
      $('#srcUrlBtn').onclick = () => { const u = $('#srcUrl').value.trim(); if (u) loadUrl(u, true); };
      $('#srcUrl').onkeydown = (e) => { if (e.key === 'Enter') $('#srcUrlBtn').click(); };
      $('#skipVideo').onclick = () => {
        loader.innerHTML = `<div class="box"><p class="muted">尚未載入影片。可以瀏覽、回覆右側的註記；要新增註記請先載入影片。</p><button class="btn" id="reopenLoader">載入影片</button></div>`;
        $('#reopenLoader').onclick = () => showLoader();
      };
      const drop = $('#drop');
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', async (e) => {
        const f = e.dataTransfer.files[0];
        if (!f) return;
        // Chrome / Edge 可以從拖曳取得檔案位置（必須在事件當下呼叫）
        const item = e.dataTransfer.items && e.dataTransfer.items[0];
        const hp = item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null;
        const handle = hp ? await hp : null;
        loadFile(f, handle && handle.kind === 'file' ? handle : null);
      });
    }

    async function loadFile(file, handle) {
      if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v)$/i.test(file.name)) { RT.toast('請選擇影片檔（mp4 / mov）', 'bad'); return; }
      RT.pendingFiles[vid] = file;
      await loadSource({ file }, file.name);
      if (!player.loaded()) return;
      if (handle) { RT.fileStore.remember(vid, handle); S.savedHandle = handle; } // 記住位置，下次自動載入
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
      S.src = src;
      AUD.resetLive();
      $('#audReport').innerHTML = '';
      if (player.tainted && AUD.meter && AUD.meter.ctx) addWarn('這個雲端連結不允許讀取聲音資料：音量表無法使用，聲音也可能被靜音。請重新整理頁面，或改用本機檔案。');
      if (SUB.cues.length) recheckSubs();
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
      if (t === 'subs') { setSubShow(!SUB.show); return; }
      if (t === 'meter') { AUD.toggle(); return; }
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
      const allowed = isStaff ? RTCore.NOTE_STATUS : RTCore.VENDOR_NOTE_STATUS;
      const opts = RTCore.NOTE_STATUS.filter((s) => allowed.includes(s) || s === n.status);
      return `<select class="pill st-${esc(n.status)}" data-status="${esc(n.id)}" style="height:22px;padding:0 4px;border:1px solid transparent">${opts.map((s) => `<option ${s === n.status ? 'selected' : ''} ${allowed.includes(s) ? '' : 'disabled'}>${s}</option>`).join('')}</select>`;
    }
    function noteHTML(n) {
      const sel = n.id === S.sel;
      const today = RT.todayStr();
      const done = RTCore.NOTE_DONE.includes(n.status);
      const assignee = n.assignee ? (peopleMap[String(n.assignee).toLowerCase()] || {}).displayName || n.assignee : '';
      const canEdit = canManage || n.author === user.username;
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
              ${(canManage || r.author === user.username) && (r.text || (r.attachIds && r.attachIds.length)) ? `<button class="btn sm ghost" data-delreply="${esc(r.id)}" style="height:18px;padding:0 4px;font-size:11px">刪除</button>` : ''}</div>
            ${r.statusChange ? `<div class="sc">狀態 ${esc(r.statusChange)}</div>` : ''}
            ${r.text ? `<div class="txt">${fmtText(r.text)}</div>` : ''}
            ${r.attachIds && r.attachIds.length ? `<div class="attach-list">${r.attachIds.map((id) => `<div class="a" data-zoom="${esc(id)}"><img data-file="${esc(id)}"></div>`).join('')}</div>` : ''}
          </div>`).join('')}
          ${canComment ? `<div class="reply-box">
            <textarea data-reply="${esc(n.id)}" placeholder="回覆，或回報修改進度…（Ctrl+Enter 送出）">${esc(S.replyDraft[n.id] || '')}</textarea>
            <div class="attach-list" data-rattach="${esc(n.id)}"></div>
            <div class="row wrap" style="margin-top:6px">
              <button class="btn sm" data-rimg="${esc(n.id)}">📎 圖片</button>
              ${isGuest ? '' : `<select data-rstatus="${esc(n.id)}" style="height:26px;font-size:12.5px"><option value="">狀態不變</option>${(isStaff ? RTCore.NOTE_STATUS : RTCore.VENDOR_NOTE_STATUS).filter((s) => s !== n.status).map((s) => `<option>${s}</option>`).join('')}</select>`}
              ${isStaff ? `<label class="chk" style="font-size:12px"><input type="checkbox" data-rinternal="${esc(n.id)}"> 內部</label>` : ''}
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
      $('#tabCntNotes').textContent = S.notes.length ? S.notes.length : '';
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
          ${isStaff ? `<label class="chk"><input type="checkbox" name="internal" ${n.internal ? 'checked' : ''}> 內部註記（廠商與訪客看不到）</label>` : ''}
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
        ['D', '畫記模式'], ['Ctrl + Z / Ctrl + Shift + Z', '復原 / 重做畫記'], ['G', '切換安全框 / 遮罩'], ['S', '顯示 / 隱藏字幕'], ['M', '音量表'], ['F', '全螢幕'], ['C', '輸入註記'], ['Ctrl + Enter', '送出註記 / 回覆'], ['Esc', '結束畫記 / 取消選取']];
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
      $('#paneB .wm').classList.toggle('hidden', !(project.watermark && !isStaff));
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

    /* ---------------- 側欄分頁 ---------------- */
    function showTab(tab) {
      $$('#sideTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      $$('.rv-side [data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
      if (tab === 'subs') scrollCurCue();
    }
    $('#sideTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };

    /* ---------------- 字幕（SRT / VTT） ---------------- */
    const subOv = $('#subOv');
    function setSubShow(on) {
      SUB.show = on;
      $('#srtShow').checked = on;
      $('#btnSubs').classList.toggle('on', on && SUB.cues.length > 0);
      updateSubs(true);
    }
    async function loadSubFile(file) {
      try {
        const text = RT.decodeText(await file.arrayBuffer());
        applySubText(text, file.name, true);
        if (SUB.cues.length) {
          RT.pendingSubs[vid] = { name: file.name, text };
          RT.fileStore.set('subs:' + vid, { name: file.name, text }); // 只存在這台電腦，不會上傳
        }
      } catch (e) { RT.fail(e); }
    }
    function applySubText(text, name, fresh) {
      const res = RT.parseSubtitles(text);
      if (!res.cues.length) { RT.toast('讀不到任何字幕：請確認是 SRT 或 VTT 格式', 'bad'); return; }
      SUB.text = text; SUB.name = name; SUB.cues = res.cues; SUB.errors = res.errors; SUB.edit = null;
      $('#srtExport').disabled = false;
      // 字幕時間是否以起始 TC 算起（例如 01:00:00,000）：自動判斷
      const startSec = player.startFrames / player.exactFps;
      $('#srtOffsetWrap').classList.toggle('hidden', !player.startFrames);
      SUB.offset = !!player.startFrames && res.cues[0].start >= startSec - 1;
      $('#srtOffset').checked = SUB.offset;
      $('#srtName').textContent = name;
      $('#srtName').title = name;
      $('#srtClear').classList.remove('hidden');
      recheckSubs();
      setSubShow(true);
      if (fresh) { showTab('subs'); RT.toast(`已載入 ${res.cues.length} 句字幕`, 'ok'); }
    }
    function recheckSubs() {
      if (!SUB.cues.length) return;
      RT.checkSubtitles(SUB.cues, { exactFps: player.exactFps, total: player.total, offsetFrames: SUB.offset ? player.startFrames : 0 });
      renderSubList();
      updateSubs(true);
    }
    function clearSubs() {
      SUB.cues = []; SUB.errors = []; SUB.name = ''; SUB.text = ''; SUB.edit = null;
      delete RT.pendingSubs[vid];
      RT.fileStore.del('subs:' + vid);
      $('#srtExport').disabled = true;
      $('#srtName').textContent = '尚未載入';
      $('#srtClear').classList.add('hidden');
      $('#srtSummary').innerHTML = '';
      $('#tabCntSubs').textContent = '';
      $('#srtList').innerHTML = '<div class="empty">已移除字幕。</div>';
      $('#btnSubs').classList.remove('on');
      subOv.innerHTML = '';
    }
    function cueText(c) { return escText(c.text).replace(/\n/g, '<br>'); }
    function renderSubList() {
      const cues = SUB.cues;
      const cnt = { err: 0, warn: 0, info: 0 };
      cues.forEach((c) => { if (c.level) cnt[c.level]++; });
      const issues = cnt.err + cnt.warn;
      $('#tabCntSubs').innerHTML = issues ? `<b class="bad-n">${issues}</b>` : String(cues.length);
      const last = cues[cues.length - 1];
      $('#srtSummary').innerHTML = `<span>${cues.length} 句</span>
        <span>${player.loaded() ? player.tc(cues[0].inF) + ' → ' + player.tc(last.outF) : ''}</span>
        ${cnt.err ? `<span class="lv-err">錯誤 ${cnt.err}</span>` : ''}${cnt.warn ? `<span class="lv-warn">警告 ${cnt.warn}</span>` : ''}${cnt.info ? `<span class="lv-info">提示 ${cnt.info}</span>` : ''}
        ${!issues ? '<span class="lv-ok">✓ 沒有發現問題</span>' : ''}
        ${SUB.errors.length ? `<div class="lv-err" style="width:100%">格式問題：${esc(SUB.errors.slice(0, 3).join('；'))}${SUB.errors.length > 3 ? '…' : ''}</div>` : ''}`;
      const list = SUB.onlyIssues ? cues.filter((c) => c.level === 'err' || c.level === 'warn') : cues;
      $('#srtList').innerHTML = list.length ? list.map((c) => SUB.edit && SUB.edit.i === c.n - 1 ? cueEditorHTML(c) : `<div class="cue ${c.level ? 'lv-' + c.level : ''}" data-cue="${c.n - 1}">
          <div class="cue-h"><span class="cue-n">#${c.n}</span><span class="mono cue-tc">${player.tc(c.inF)} → ${player.tc(c.outF)}</span>
            <span class="sp"></span><button class="btn sm ghost" data-cue-edit="${c.n - 1}" title="修改這句（文字、入出點）">✎</button>${canComment ? `<button class="btn sm ghost" data-cue-note="${c.n - 1}" title="把這句字幕加為註記（自動帶入入出點）">＋註記</button>` : ''}</div>
          <div class="cue-t">${cueText(c) || '<span class="dim">（空白）</span>'}</div>
          <div class="dim cue-m" title="顯示時間 / 字數 / 每秒字數">${c.dur.toFixed(2)} 秒・${c.chars} 字・每秒 ${c.cps.toFixed(1)} 字</div>
          ${c.warn.length ? `<div class="cue-w">${c.warn.map((w) => `<span class="lv-${w[0]}">${esc(w[1])}</span>`).join('')}</div>` : ''}
        </div>`).join('') : '<div class="empty">沒有需要注意的字幕 👍</div>';
      SUB.curKey = '';
      updateSubs(true);
    }
    function activeCues(f) { return SUB.cues.filter((c) => f >= c.inF && f <= c.outF); }
    function updateSubs(force) {
      if (!SUB.cues.length) { subOv.innerHTML = ''; return; }
      const act = player.loaded() ? activeCues(player.frame) : [];
      const key = act.map((c) => c.n).join(',') + '|' + SUB.show;
      if (key === SUB.curKey && !force) return;
      SUB.curKey = key;
      subOv.innerHTML = SUB.show ? act.map((c) => `<div class="sub-line ${RT.subIsTop(c.raw) ? 'top' : ''}"><span>${RT.subHTML(c.raw)}</span></div>`).join('') : '';
      $$('#srtList .cue.cur').forEach((el) => el.classList.remove('cur'));
      act.forEach((c) => { const el = $(`#srtList [data-cue="${c.n - 1}"]`); if (el) el.classList.add('cur'); });
      scrollCurCue();
    }
    function scrollCurCue() {
      const pane = $('.rv-side [data-pane="subs"]');
      if (!pane || pane.classList.contains('hidden')) return;
      const el = $('#srtList .cue.cur');
      const box = $('#srtList');
      if (el && (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight)) {
        box.scrollTop = el.offsetTop - box.clientHeight / 3;
      }
    }
    $('#srtPick').onclick = () => $('#srtFile').click();
    $('#srtFile').onchange = (e) => { if (e.target.files[0]) loadSubFile(e.target.files[0]); e.target.value = ''; };
    $('#srtClear').onclick = clearSubs;
    $('#srtShow').onchange = (e) => setSubShow(e.target.checked);
    $('#srtOffset').onchange = (e) => { SUB.offset = e.target.checked; recheckSubs(); };
    $('#srtOnlyIssues').onchange = (e) => { SUB.onlyIssues = e.target.checked; renderSubList(); };
    $('#srtList').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-ed]');
      if (ed) { cueEditAction(ed.dataset.ed); return; }
      if (e.target.closest('.cue.editing')) return;
      const eb = e.target.closest('[data-cue-edit]');
      if (eb) { startCueEdit(Number(eb.dataset.cueEdit)); return; }
      const nb = e.target.closest('[data-cue-note]');
      if (nb) { cueToNote(SUB.cues[Number(nb.dataset.cueNote)]); return; }
      const row = e.target.closest('[data-cue]');
      if (row && player.loaded()) { player.pause(); player.seekFrame(SUB.cues[Number(row.dataset.cue)].inF); }
    });
    $('#srtList').addEventListener('keydown', (e) => {
      if (e.target.id !== 'edText') return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); cueEditAction('save'); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cueEditAction('cancel'); }
    });
    function cueToNote(c) {
      if (!player.loaded()) { RT.toast('請先載入影片'); return; }
      player.pause();
      S.inF = Math.max(0, c.inF); S.outF = Math.max(S.inF, c.outF); ioChanged();
      player.seekFrame(S.inF);
      showTab('notes');
      const ta = $('#cText');
      const quote = `【字幕 #${c.n}】「${c.text.replace(/\n/g, ' / ')}」\n`;
      if (!ta.value.startsWith(quote)) ta.value = quote + ta.value;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    /* ---- 逐句修改 ---- */
    const subOff = () => (SUB.offset ? player.startFrames : 0);
    const frameToSec = (f) => (f + subOff()) / player.exactFps;
    function edTc(sec, isOut) {
      if (!player.loaded()) return RT.srtTime(sec);
      return player.tc(Math.max(0, Math.round(sec * player.exactFps) - subOff() - (isOut ? 1 : 0)));
    }
    function cueEditorHTML(c) {
      const E = SUB.edit;
      return `<div class="cue editing" data-cue="${c.n - 1}">
        <div class="cue-h"><span class="cue-n">#${c.n}</span><span class="mono cue-tc" id="edTc">${edTc(E.start)} → ${edTc(E.end, true)}</span></div>
        <textarea class="cue-ta" id="edText" rows="2" placeholder="字幕文字（Enter 換行）">${escText(E.text)}</textarea>
        <div class="row wrap cue-ed-btns">
          <button class="btn sm" data-ed="in" title="開始時間設為目前畫面">入點＝目前畫面</button>
          <button class="btn sm" data-ed="out" title="結束時間設為目前畫面（含這一格）">出點＝目前畫面</button>
          <span class="sp"></span>
          <button class="btn sm ghost" data-ed="del" title="刪除這句">刪除</button>
          <button class="btn sm" data-ed="cancel">取消</button>
          <button class="btn sm primary" data-ed="save">儲存</button>
        </div></div>`;
    }
    function startCueEdit(i) {
      const c = SUB.cues[i];
      if (!c) return;
      SUB.edit = { i, start: c.start, end: c.end, text: c.text, orig: c.text };
      if (player.loaded()) { player.pause(); player.seekFrame(Math.max(0, c.inF)); }
      renderSubList();
      const ta = $('#edText');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
    async function cueEditAction(act) {
      const E = SUB.edit;
      if (!E) return;
      const ta = $('#edText');
      if (ta) E.text = ta.value;
      if (act === 'in' || act === 'out') {
        if (!player.loaded()) { RT.toast('請先載入影片'); return; }
        if (act === 'in') E.start = frameToSec(player.frame); else E.end = frameToSec(player.frame + 1);
        $('#edTc').textContent = `${edTc(E.start)} → ${edTc(E.end, true)}`;
        return;
      }
      if (act === 'cancel') { SUB.edit = null; renderSubList(); return; }
      if (act === 'del') {
        if (!(await RT.confirm(`刪除第 ${E.i + 1} 句字幕？`, '刪除', true))) return;
        SUB.cues.splice(E.i, 1);
        SUB.edit = null;
        commitSubs();
        return;
      }
      if (act === 'save') {
        if (E.end <= E.start) { RT.toast('結束時間必須晚於開始時間', 'bad'); return; }
        const c = SUB.cues[E.i];
        const text = E.text.replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
        if (text !== E.orig) { c.text = text; c.raw = text; }
        c.start = E.start; c.end = E.end;
        SUB.edit = null;
        commitSubs();
      }
    }
    /* 修改後：重新排序編號、存在這台電腦、重新檢查 */
    function commitSubs() {
      if (!SUB.cues.length) { clearSubs(); return; }
      SUB.cues.sort((a, b) => a.start - b.start);
      SUB.cues.forEach((c, i) => { c.n = i + 1; });
      SUB.text = RT.buildSrt(SUB.cues);
      if (!SUB.name) SUB.name = `${project.name}_${version.label}.srt`;
      const store = { name: SUB.name, text: SUB.text };
      RT.pendingSubs[vid] = store;
      RT.fileStore.set('subs:' + vid, store);
      $('#srtName').textContent = SUB.name; $('#srtName').title = SUB.name;
      $('#srtClear').classList.remove('hidden');
      $('#srtExport').disabled = false;
      recheckSubs();
      setSubShow(SUB.show);
    }
    $('#srtAdd').onclick = () => {
      if (!player.loaded()) { RT.toast('請先載入影片'); return; }
      const start = frameToSec(player.frame);
      const next = SUB.cues.find((c) => c.start > start + 0.01);
      const end = Math.min(start + 2, next ? next.start : Infinity, frameToSec(player.total));
      if (end - start < 0.1) { RT.toast('這個位置緊接著下一句，請先移到空白處', 'bad'); return; }
      const c = { n: 0, id: '', start, end, raw: '', text: '' };
      SUB.cues.push(c);
      commitSubs();
      showTab('subs');
      startCueEdit(SUB.cues.indexOf(c));
    };
    $('#srtExport').onclick = () => {
      if (!SUB.cues.length) return;
      if (SUB.edit) { RT.toast('還有一句正在修改，請先儲存或取消', 'bad'); return; }
      const srt = '﻿' + RT.buildSrt(SUB.cues); // 加 BOM：Windows 上的剪輯軟體才不會把中文讀成亂碼
      const base = (SUB.name || `${project.name}_${version.label}`).replace(/\.(srt|vtt|txt)$/i, '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }));
      a.download = base.replace(/[\\/:*?"<>|]/g, '_') + '.srt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      RT.toast('已匯出 SRT', 'ok');
    };

    /* ---- 自動產生字幕（語音辨識） ---- */
    $('#asrBtn').onclick = async () => {
      if (!S.src) { RT.toast('請先載入影片'); return; }
      if (RT.asr.running) { RT.toast('已經在辨識中，請等它完成'); return; }
      const h = await RT.asr.detect();
      let last = {};
      try { last = JSON.parse(localStorage.getItem('rt_asr_opt') || '{}'); } catch (e) { last = {}; }
      let model = last.model || (h.gpu ? 'best' : 'std');
      if (!RT.asr.variant(model)) model = 'std';
      const lang = last.language !== undefined ? last.language : 'english'; // 大部分影片是英文旁白
      const modes = Object.keys(RT.asr.MODELS).map((k) => {
        const m = RT.asr.MODELS[k], v = RT.asr.variant(k);
        return `<label class="asr-mode ${v ? '' : 'off'}"><input type="radio" name="model" value="${k}" ${k === model ? 'checked' : ''} ${v ? '' : 'disabled'}>
          <span><b>${esc(m.label)}</b><small>${esc(m.desc)}${v ? `・第一次使用需下載約 ${v.v.mb} MB` : '・這台電腦不支援'}</small></span></label>`;
      }).join('');
      RT.modal({
        title: '自動產生字幕',
        body: `<p class="dim" style="margin:0 0 12px;font-size:12.5px;line-height:1.6">用語音辨識（Whisper）把旁白、對白轉成字幕。聲音只在這台電腦上處理，不會上傳。<br>辨識結果一定要校對：專有名詞、產品名稱常會聽錯，純音樂的段落偶爾會出現不存在的字。</p>
          <div class="field"><span>模式</span>${modes}</div>
          <label class="field"><span>語言</span><select name="lang">${RT.asr.LANGS.map((l) => `<option value="${l[0]}" ${l[0] === lang ? 'selected' : ''}>${esc(l[1])}</option>`).join('')}</select>
            <span class="hint">整支影片只有一種語言時，直接選語言最準；選錯語言會被翻譯成那種語言。</span></label>
          <details class="asr-fix"><summary>詞彙修正（專有名詞）</summary>
            <textarea name="fixes" rows="5">${escText(RT.asr.fixesText())}</textarea>
            <div class="row" style="margin-top:4px"><span class="hint grow">每行一組「聽錯的字=正確的字」，辨識完自動取代。設定只存在這台電腦。</span><button class="btn sm ghost" type="button" data-fixdef>恢復預設</button></div></details>
          ${h.gpu ? '' : '<p class="lv-warn" style="font-size:12.5px">這個瀏覽器沒有 WebGPU，會用 CPU 辨識，速度會慢很多。建議使用最新版 Chrome 或 Edge。</p>'}
          ${SUB.cues.length ? '<p class="lv-warn" style="font-size:12.5px">完成後會取代目前的字幕。需要保留的話，請先按「匯出 SRT」。</p>' : ''}`,
        okText: '開始辨識', noFocus: true,
        onOpen: (m) => { $('[data-fixdef]', m).onclick = () => { $('[name=fixes]', m).value = RT.asr.FIX_DEFAULT; }; },
        onOk: (m) => {
          const sel = $('[name=model]:checked', m);
          const opt = { model: sel ? sel.value : model, language: $('[name=lang]', m).value };
          localStorage.setItem('rt_asr_opt', JSON.stringify(opt));
          const fx = $('[name=fixes]', m).value;
          RT.asr.setFixes(fx.trim() === RT.asr.FIX_DEFAULT ? null : fx);
          runAsr(opt);
        }
      });
    };
    function fmtDur(s) { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`; }
    async function runAsr(opt) {
      const box = $('#asrBox');
      box.classList.remove('hidden');
      $('#asrBtn').disabled = true;
      box.innerHTML = `<div class="row"><span class="grow" id="asrStage">準備中…</span><button class="btn sm ghost" id="asrCancel">取消</button></div>
        <div class="aud-progress"><i style="width:0"></i></div><div class="dim ellipsis asr-last" id="asrLast"></div>`;
      $('#asrCancel').onclick = () => RT.asr.cancel();
      const set = (txt, p, lastTxt) => {
        if (!pageAlive) return;
        $('#asrStage').textContent = txt;
        if (p !== null) $('#asrBox .aud-progress i').style.width = Math.round(p * 100) + '%';
        if (lastTxt !== undefined) $('#asrLast').textContent = lastTxt;
      };
      const mb = (b) => (b / 1048576).toFixed(0);
      const label = RT.asr.MODELS[opt.model].label;
      try {
        const res = await RT.asr.transcribe(S.src, opt, (st, p, info) => {
          if (st === 'decode') set('讀取影片的聲音…（檔案越大越久）', 0);
          else if (st === 'model') {
            if (info && info.total && p < 1) set(`載入模型 ${mb(info.loaded)} / ${mb(info.total)} MB（第一次使用需要下載，之後會快很多）`, p);
            else set('準備模型中…', p || 0);
          } else if (st === 'asr') {
            const segs = (info && info.segs) || [];
            set(`辨識中（${label}）${Math.round(p * 100)}%${info && info.eta ? `・約剩 ${fmtDur(info.eta)}` : ''}`, p, segs.length ? `${segs.length} 段：${segs[segs.length - 1].text}` : '');
          } else if (st === 'finish') set('整理字幕…', 1);
        });
        if (!res.cues.length) { if (pageAlive) RT.toast('沒有辨識到任何語音', 'bad'); return; }
        const name = `${project.name}_${version.label}_自動字幕.srt`;
        const store = { name, text: res.srt };
        RT.pendingSubs[vid] = store;
        RT.fileStore.set('subs:' + vid, store); // 只存在這台電腦
        if (!pageAlive) { RT.toast(`「${version.label}」的自動字幕已完成，回到該版本即可查看`, 'ok'); return; }
        applySubText(res.srt, name, false);
        showTab('subs');
        RT.toast(`已產生 ${res.cues.length} 句字幕（${res.device === 'webgpu' ? '顯示卡加速' : 'CPU'}），請校對後再匯出 SRT`, 'ok');
      } catch (e) {
        if (e.cancelled) { if (pageAlive) RT.toast('已取消自動字幕'); }
        else if (pageAlive) RT.toast('自動字幕失敗：' + e.message, 'bad');
        else console.error(e);
      } finally {
        if (pageAlive) { box.classList.add('hidden'); box.innerHTML = ''; $('#asrBtn').disabled = false; }
      }
    }
    if (RT.asr && RT.asr.running) { $('#asrBtn').disabled = true; $('#asrBtn').title = '另一個版本正在辨識中'; }

    $('#srtRules').onclick = () => {
      const r = RT.subRules();
      const fields = [['cjkCps', '中文：每秒最多幾個字'], ['cjkLine', '中文：每行最多幾個字'], ['latinCps', '英文：每秒最多幾個字元'], ['latinLine', '英文：每行最多幾個字元'],
        ['maxLines', '最多幾行'], ['minDur', '最短顯示（秒）'], ['maxDur', '最長顯示（秒）'], ['minGapFrames', '兩句之間至少間隔（格）']];
      RT.modal({
        title: '字幕檢查規則',
        body: `<p class="dim" style="margin:0 0 10px;font-size:12.5px">預設值參考常見串流平台規範（繁中每秒 9 字、每行 16 字；英文每秒 20 字元、每行 42 字元）。中文字數不含標點與空白。設定只存在這台電腦。</p>
          <div class="grid2">${fields.map((f) => `<label class="field"><span>${f[1]}</span><input type="number" step="any" min="0" name="${f[0]}" value="${r[f[0]]}"></label>`).join('')}</div>`,
        okText: '套用', extraFoot: '<button class="btn ghost" data-def>恢復預設</button>',
        onOpen: (m, close) => { $('[data-def]', m).onclick = () => { localStorage.removeItem('rt_sub_rules'); close(); recheckSubs(); RT.toast('已恢復預設規則'); }; },
        onOk: (m) => {
          const o = {};
          fields.forEach((f) => { const v = Number($(`[name=${f[0]}]`, m).value); if (isFinite(v) && v >= 0) o[f[0]] = v; });
          localStorage.setItem('rt_sub_rules', JSON.stringify(o));
          recheckSubs();
        }
      });
    };

    /* ---------------- 聲音：音量表與整段分析 ---------------- */
    const AUD = {
      meter: null, on: false, raf: 0, thr: Number(localStorage.getItem('rt_aud_thr') || -1),
      st: null, events: [],
      resetLive() {
        AUD.st = { peakDb: [-Infinity, -Infinity], rmsDb: [-Infinity, -Infinity], holdDb: [-Infinity, -Infinity], holdT: [0, 0],
          maxDb: [-Infinity, -Infinity], clip: [false, false], over: [false, false] };
        AUD.events = [];
        renderAudLive(); renderAudEvents();
        if (AUD.on) RT.drawMeter($('#meter canvas'), AUD.st, AUD.thr);
      },
      toggle() { AUD.setOn(!AUD.on); },
      setOn(on) {
        if (on) {
          if (player.tainted) { RT.toast('這個雲端連結不允許讀取聲音資料，無法顯示音量表（請改用本機檔案）', 'bad'); return; }
          try {
            if (!AUD.meter) AUD.meter = new RT.AudioMeter(vA);
            AUD.meter.attach();
          } catch (e) { RT.fail(e); return; }
        }
        AUD.on = on;
        $('#meter').classList.toggle('hidden', !on);
        $('#btnMeter').classList.toggle('on', on);
        $('#audMeterBtn').textContent = on ? '隱藏音量表' : '顯示音量表';
        cancelAnimationFrame(AUD.raf);
        if (on) AUD.loop();
        setTimeout(layout, 20);
      },
      loop() {
        AUD.raf = requestAnimationFrame(AUD.loop);
        const st = AUD.st, now = performance.now();
        const playing = player.playing && !player.reverse && !vA.paused;
        const r = playing ? AUD.meter.read() : null;
        for (let ch = 0; ch < 2; ch++) {
          if (r) {
            const pk = RT.toDb(r.peak[ch]);
            st.peakDb[ch] = pk; st.rmsDb[ch] = RT.toDb(r.rms[ch]);
            if (pk > st.holdDb[ch] || now - st.holdT[ch] > 1500) { st.holdDb[ch] = pk; st.holdT[ch] = now; }
            if (pk > st.maxDb[ch]) st.maxDb[ch] = pk;
            const isClip = r.peak[ch] >= 0.99989, isOver = pk >= AUD.thr;
            if (isClip) st.clip[ch] = true;
            if (isOver) { st.over[ch] = true; logOver(ch, pk, isClip); }
          } else {
            st.peakDb[ch] = Math.max(-Infinity, st.peakDb[ch] - 1.2); // 停止時讓表慢慢落下
            st.rmsDb[ch] = Math.max(-Infinity, st.rmsDb[ch] - 1.2);
            if (now - st.holdT[ch] > 1500) st.holdDb[ch] = -Infinity;
          }
        }
        RT.drawMeter($('#meter canvas'), st, AUD.thr);
        if (r && now - (AUD.lastLive || 0) > 250) { AUD.lastLive = now; renderAudLive(); }
      }
    };
    function logOver(ch, db, isClip) {
      const f = player.frame, last = AUD.events[AUD.events.length - 1];
      const near = Math.round(player.exactFps / 2); // 半秒內的視為同一段
      if (last && f >= last.inF - 1 && f - last.outF <= near) {
        last.outF = Math.max(last.outF, f); last.maxDb = Math.max(last.maxDb, db); last.ch[ch] = true; last.clip = last.clip || isClip;
        renderAudEventsThrottled();
      } else {
        AUD.events.push({ inF: f, outF: f, maxDb: db, ch: { [ch]: true }, clip: isClip });
        renderAudEvents();
      }
    }
    let evTimer = 0;
    function renderAudEventsThrottled() { if (!evTimer) evTimer = setTimeout(() => { evTimer = 0; renderAudEvents(); }, 400); }
    function chLabel(ch) { return ch[0] && ch[1] ? 'L+R' : ch[0] ? 'L' : 'R'; }
    function renderAudLive() {
      const st = AUD.st;
      $('#audLive').innerHTML = `<div class="aud-grid">
          <div><span class="k">最大峰值 L</span><span class="v ${st.maxDb[0] >= AUD.thr ? 'lv-err' : ''}">${RT.fmtDb(st.maxDb[0])}</span></div>
          <div><span class="k">最大峰值 R</span><span class="v ${st.maxDb[1] >= AUD.thr ? 'lv-err' : ''}">${RT.fmtDb(st.maxDb[1])}</span></div>
          <div><span class="k">超過上限</span><span class="v ${AUD.events.length ? 'lv-warn' : ''}">${AUD.events.filter((e) => !e.clip).length} 段</span></div>
          <div><span class="k">爆音</span><span class="v ${AUD.events.some((e) => e.clip) ? 'lv-err' : ''}">${AUD.events.filter((e) => e.clip).length} 段</span></div>
        </div><div class="dim" style="font-size:11.5px;margin-top:4px">單位 dBFS（0 = 數位滿格）。播放時即時讀取；要完整檢查請用下方「整段分析」。</div>`;
      const n = AUD.events.length;
      $('#tabCntAudio').innerHTML = AUD.events.some((e) => e.clip) || (AUD.report && AUD.report.clip) ? '<b class="bad-n">!</b>' : n ? `<b class="warn-n">${n}</b>` : '';
    }
    function renderAudEvents() {
      const box = $('#audEvents');
      box.innerHTML = AUD.events.length ? AUD.events.map((e, i) => `<div class="aud-ev ${e.clip ? 'lv-err' : 'lv-warn'}" data-aev="${i}">
          <span class="mono">${player.tc(e.inF)}</span>${e.outF > e.inF ? `<span class="dim mono">→ ${player.tc(e.outF)}</span>` : ''}
          <span class="sp"></span><span>${chLabel(e.ch)}</span><b>${RT.fmtDb(e.maxDb)}</b><span class="tag-s">${e.clip ? '爆音' : '超過上限'}</span></div>`).join('')
        : '<div class="dim" style="font-size:12.5px;padding:6px 0">播放時若聲音超過上限，會記錄在這裡（點一下跳到該時間）。</div>';
      renderAudLive();
    }
    $('#audEvents').addEventListener('click', (e) => {
      const r = e.target.closest('[data-aev]');
      if (r && player.loaded()) { player.pause(); player.seekFrame(AUD.events[Number(r.dataset.aev)].inF); }
    });
    $('#audThr').value = String(AUD.thr);
    $('#audThr').onchange = (e) => { AUD.thr = Number(e.target.value); localStorage.setItem('rt_aud_thr', AUD.thr); AUD.resetLive(); };
    $('#audReset').onclick = () => AUD.resetLive();
    $('#audMeterBtn').onclick = () => AUD.toggle();
    $('#meter').onclick = () => AUD.resetLive();

    $('#audScan').onclick = async () => {
      if (!S.src) { RT.toast('請先載入影片'); return; }
      const btn = $('#audScan'), box = $('#audReport');
      btn.disabled = true;
      box.innerHTML = '<div class="aud-progress"><i style="width:0"></i></div><div class="dim" style="font-size:12.5px">讀取聲音中…（檔案越大越久）</div>';
      try {
        await new Promise((r) => setTimeout(r, 30));
        const buf = await RT.decodeAudio(S.src);
        box.querySelector('.dim').textContent = '分析中…';
        const rep = await RT.analyzeAudio(buf, AUD.thr, (p) => { const bar = box.querySelector('.aud-progress i'); if (bar) bar.style.width = Math.round(p * 100) + '%'; });
        rep.clip = rep.clipSamples.some((n) => n > 0);
        AUD.report = rep;
        renderReport(rep);
      } catch (e) {
        box.innerHTML = `<p class="err" style="font-size:12.5px">${esc(e.message)}</p>`;
      } finally { btn.disabled = false; renderAudLive(); }
    };
    function renderReport(rep) {
      const chName = (c) => rep.channels === 1 ? '單聲道' : rep.channels === 2 ? ['L', 'R'][c] : ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', '7', '8'][c] || ('Ch' + (c + 1));
      const maxPk = Math.max(...rep.peakDb), maxTp = Math.max(...rep.truePeakDb);
      const clipTotal = rep.clipSamples.reduce((s, n) => s + n, 0);
      const verdict = rep.clip ? ['lv-err', '有爆音（數位滿格）'] : maxPk >= rep.thrDb ? ['lv-warn', `峰值超過上限 ${rep.thrDb} dBFS`] : maxTp >= rep.thrDb ? ['lv-warn', `取樣峰值沒超標，但 True Peak 超過上限`] : ['lv-ok', '沒有爆音，峰值在上限以內'];
      const hitsHtml = rep.hits.slice(0, 300).map((h, i) => {
        const inF = Math.floor(h.start * player.exactFps), outF = Math.floor(h.end * player.exactFps);
        const isClip = h.max >= 0.99989;
        return `<div class="aud-ev ${isClip ? 'lv-err' : 'lv-warn'}" data-hit="${i}" data-f="${inF}"><span class="mono">${player.tc(inF)}</span>${outF > inF ? `<span class="dim mono">→ ${player.tc(outF)}</span>` : ''}
          <span class="sp"></span><span>${chName(h.ch)}</span><b>${RT.fmtDb(RT.toDb(h.max), 2)}</b><span class="tag-s">${isClip ? '爆音' : '超過上限'}</span></div>`;
      }).join('');
      $('#audReport').innerHTML = `<div class="aud-verdict ${verdict[0]}">${verdict[1]}</div>
        <table class="table aud-table">
          <tr><th></th>${Array.from({ length: rep.channels }, (_, c) => `<th>${chName(c)}</th>`).join('')}</tr>
          <tr><td>峰值 (dBFS)</td>${rep.peakDb.map((d) => `<td class="mono ${d >= rep.thrDb ? 'lv-err' : ''}">${RT.fmtDb(d, 2)}</td>`).join('')}</tr>
          <tr><td title="4 倍超取樣估算的樣本間峰值">True Peak 約 (dBTP)</td>${rep.truePeakDb.map((d) => `<td class="mono ${d >= rep.thrDb ? 'lv-warn' : ''}">${RT.fmtDb(d, 2)}</td>`).join('')}</tr>
          <tr><td>滿格樣本數</td>${rep.clipSamples.map((n) => `<td class="mono ${n ? 'lv-err' : ''}">${n}</td>`).join('')}</tr>
        </table>
        <div class="aud-grid" style="margin-top:8px">
          <div><span class="k">整合響度</span><span class="v">${isFinite(rep.lufs) ? rep.lufs.toFixed(1) + ' LUFS' : '—'}</span></div>
          <div><span class="k">短時響度最大</span><span class="v">${isFinite(rep.shortTermMax) ? rep.shortTermMax.toFixed(1) + ' LUFS' : '—'}</span></div>
          <div><span class="k">長度</span><span class="v">${rep.duration.toFixed(2)} 秒</span></div>
          <div><span class="k">格式</span><span class="v">${rep.channels} 聲道</span></div>
        </div>
        <p class="dim" style="font-size:11.5px;margin:6px 0 10px">參考：電視播出常見規範 -23 ～ -24 LUFS、True Peak ≤ -1 ～ -2 dBTP；網路平台常見約 -14 LUFS。分析時聲音以 48kHz 解碼${clipTotal ? '' : ''}。</p>
        <div class="row"><b style="font-size:13px">超過上限的時間點（${rep.hits.length}）</b></div>
        ${rep.hits.length ? hitsHtml + (rep.hits.length > 300 ? `<div class="dim">只列出前 300 筆</div>` : '') : '<div class="dim" style="font-size:12.5px;padding:6px 0">沒有任何地方超過上限。</div>'}`;
    }
    $('#audReport').addEventListener('click', (e) => {
      const r = e.target.closest('[data-f]');
      if (r && player.loaded()) { player.pause(); player.seekFrame(Number(r.dataset.f)); }
    });
    AUD.resetLive();

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
        case 's': case 'S': handled(); if (SUB.cues.length) setSubShow(!SUB.show); else showTab('subs'); break;
        case 'm': case 'M': handled(); AUD.toggle(); break;
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
      pageAlive = false;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      ro.disconnect();
      S.timers.forEach(clearInterval);
      cancelAnimationFrame(AUD.raf);
      clearTimeout(evTimer);
      if (AUD.meter) AUD.meter.close();
      player.unload();
      if (pB) pB.unload();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };

    /* ---------------- 開始 ---------------- */
    updateFilterOptions();
    renderNotes();
    updateFrameUI();
    (async () => {
      showLoader('讀取中…');
      // 字幕：記憶體 → 這台電腦上次載入的
      const subs = RT.pendingSubs[vid] || await RT.fileStore.get('subs:' + vid);
      if (subs && subs.text && !SUB.cues.length) { RT.pendingSubs[vid] = subs; applySubText(subs.text, subs.name, false); }
      // 影片：記憶體 → 記住的本機檔案 → 雲端連結 → 請使用者選擇
      if (RT.pendingFiles[vid]) { loadFile(RT.pendingFiles[vid]); return; }
      S.savedHandle = RT.fileStore.canRemember ? await RT.fileStore.get('video:' + vid) : null;
      if (S.savedHandle) {
        try { await loadFile(await RT.fileStore.fileFrom(S.savedHandle, false), S.savedHandle); return; }
        catch (e) {
          if (e.code === 'MISSING') { RT.fileStore.del('video:' + vid); S.savedHandle = null; showLoader(null, e.message); return; }
          showLoader(); return; // 需要使用者按一下允許
        }
      }
      if (version.url) loadUrl(version.url, false);
      else showLoader();
    })();
    if (S.sel) setTimeout(() => { const el = $(`[data-note="${CSS.escape(S.sel)}"]`); if (el) el.scrollIntoView({ block: 'center' }); }, 50);
  };
})();
