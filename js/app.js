/* Retake Notes — 主程式：路由、登入、儀表板、專案、帳號管理、分享連結 */
(function () {
  'use strict';
  const RT = window.RT;
  const cfg = window.RT_CONFIG || {};
  const TC = RTCore.TC;

  /* ================= 版本 ================= */
  // 每次發佈新功能時更新這裡（同時記得更新 index.html 的 ?v=）
  RT.VERSION = '1.3.0';

  /* 標題列品牌：Acer logo ｜ 系統名稱 ＋ 版本 */
  RT.brandHTML = function (href) {
    const tag = href ? 'a' : 'div';
    return `<${tag} class="brand" ${href ? `href="${href}"` : ''}>
      <img class="brand-acer" src="img/acer-logo-white.png" alt="Acer" width="83" height="20">
      <span class="brand-sep" aria-hidden="true"></span>
      <span class="logo"><i></i><span class="logo-t">${(cfg.SITE_NAME || 'Retake Notes').replace(/[<>&"]/g, '')}</span></span>
      <span class="brand-ver" title="系統版本">v${RT.VERSION}</span>
    </${tag}>`;
  };

  /* ================= 工具 ================= */
  const esc = RT.esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const $ = RT.$ = (sel, root) => (root || document).querySelector(sel);
  const $$ = RT.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  RT.el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  RT.todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  RT.toast = function (msg, kind) {
    const t = RT.el(`<div class="toast ${kind || ''}">${esc(msg)}</div>`);
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), kind === 'bad' ? 5000 : 2600);
  };
  RT.fail = (e) => {
    console.error(e);
    if (e.code === 'PINCHANGE') { RT.updateUser({ mustChangePin: true }); RT.route(); return; }
    RT.toast(e.message || String(e), 'bad');
    if (e.code === 'AUTH') RT.logout(true);
  };

  /* 對話框：onOk(el) 回傳 false 不關閉；丟出錯誤會顯示在框內 */
  RT.modal = function (o) {
    const back = RT.el(`<div class="modal-back"><div class="modal ${o.wide ? 'wide' : ''} ${o.cls || ''}">
      <div class="modal-h"><h2 class="grow">${esc(o.title || '')}</h2><button class="btn ghost icon" data-x aria-label="關閉">✕</button></div>
      <div class="modal-b">${o.body || ''}<div class="err" data-err></div></div>
      ${o.noFooter ? '' : `<div class="modal-f">${o.extraFoot || ''}<span class="sp"></span>
        <button class="btn" data-cancel>${esc(o.cancelText || '取消')}</button>
        ${o.okText === null ? '' : `<button class="btn primary" data-ok>${esc(o.okText || '確定')}</button>`}</div>`}
    </div></div>`);
    document.body.appendChild(back);
    const m = back.firstElementChild;
    let closed = false;
    const close = () => { if (closed) return; closed = true; back.remove(); document.removeEventListener('keydown', onKey, true); o.onClose && o.onClose(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok(); }
    };
    document.addEventListener('keydown', onKey, true);
    $('[data-x]', m).onclick = close;
    const cancel = $('[data-cancel]', m);
    if (cancel) cancel.onclick = close;
    const okBtn = $('[data-ok]', m);
    const errEl = $('[data-err]', m);
    async function ok() {
      if (!okBtn || okBtn.disabled) return;
      errEl.textContent = '';
      okBtn.disabled = true;
      try {
        const r = o.onOk ? await o.onOk(m) : true;
        if (r !== false) close();
      } catch (e) {
        errEl.textContent = e.message || String(e);
        if (e.code === 'AUTH') { close(); RT.logout(true); }
      } finally { okBtn.disabled = false; }
    }
    if (okBtn) okBtn.onclick = ok;
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && !o.noEnter) { e.preventDefault(); ok(); }
    });
    if (o.onOpen) o.onOpen(m, close);
    const first = $('input:not([type=hidden]):not([readonly]), textarea, select', m);
    if (first && !o.noFocus) setTimeout(() => first.focus(), 30);
    return { el: m, close };
  };
  RT.confirm = (msg, okText, danger) => new Promise((resolve) => {
    let res = false;
    RT.modal({
      title: '確認', body: `<p style="margin:0;white-space:pre-wrap">${esc(msg)}</p>`, okText: okText || '確定', noFocus: true,
      onOk: () => { res = true; }, onClose: () => resolve(res),
      onOpen: (m) => { if (danger) $('[data-ok]', m).style.background = 'var(--bad)'; }
    });
  });
  RT.lightbox = (src) => RT.modal({ title: '圖片', body: `<div class="lightbox"><img src="${src}"></div>`, okText: null, cancelText: '關閉', wide: true, noFocus: true });

  RT.busy = async function (btn, fn) {
    const t = btn.innerHTML; btn.disabled = true; btn.innerHTML = '處理中…';
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = t; }
  };

  RT.statusPill = (s) => `<span class="pill st-${esc(s)}">${esc(s)}</span>`;
  RT.progressBar = function (stats) {
    const total = stats.total || 0;
    if (!total) return '<div class="progress"></div>';
    const colors = { '已確認': 'var(--s-ok)', '不修改': 'var(--s-skip)', '已修改': 'var(--s-fixed)', '修改中': 'var(--s-doing)', '待修改': 'var(--s-todo)' };
    return '<div class="progress">' + ['已確認', '不修改', '已修改', '修改中', '待修改'].map((k) =>
      stats.byStatus[k] ? `<i style="width:${stats.byStatus[k] / total * 100}%;background:${colors[k]}" title="${k} ${stats.byStatus[k]}"></i>` : '').join('') + '</div>';
  };

  /* 圖片縮小後轉 dataURL */
  RT.imageToDataUrl = (file, maxSide) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, (maxSide || 1600) / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取圖片')); };
    img.src = url;
  });

  /* 雲端連結轉換：Google Drive / Dropbox → 可直接播放的網址 */
  RT.normalizeVideoUrl = function (url) {
    url = String(url || '').trim();
    let m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
    if (m) {
      return cfg.GOOGLE_API_KEY
        ? `https://www.googleapis.com/drive/v3/files/${m[1]}?alt=media&key=${encodeURIComponent(cfg.GOOGLE_API_KEY)}`
        : `https://drive.google.com/uc?export=download&id=${m[1]}`;
    }
    if (/dropbox\.com\//.test(url)) return url.replace(/([?&])dl=0/, '$1raw=1').replace(/^(?!.*[?&](raw|dl)=)(.*)$/, (s) => s + (s.includes('?') ? '&' : '?') + 'raw=1');
    return url;
  };

  /* ================= Session ================= */
  RT.session = null;
  try { RT.session = JSON.parse(localStorage.getItem('rt_session') || 'null'); } catch (e) { RT.session = null; }
  if (RT.session && RT.session.demo !== RT.isDemo) RT.session = null;
  RT.saveSession = (s) => { RT.session = s; if (s) { s.demo = RT.isDemo; localStorage.setItem('rt_session', JSON.stringify(s)); } else localStorage.removeItem('rt_session'); };
  RT.user = () => RT.session && RT.session.user;
  RT.isAdmin = () => RT.user() && RT.user().role === 'admin';
  RT.isGuest = () => RT.user() && RT.user().role === 'guest';
  RT.isLead = () => RT.user() && RT.user().role === 'lead';
  // 可以建立專案、管理帳號：管理者（全部）、專案負責人（自己負責的專案／自己建立的帳號）
  RT.canManageUsers = () => RT.isAdmin() || RT.isLead();
  // 內部人員（管理者＋專案負責人＋Acer 同事）：看得到內部註記、可設定所有註記狀態
  RT.isStaff = () => RT.user() && ['admin', 'lead', 'acer'].includes(RT.user().role);
  RT.roleLabel = (role) => (RTCore.ROLE_LABEL && RTCore.ROLE_LABEL[role]) || role;
  RT.needsPinChange = () => !!(RT.user() && RT.user().role !== 'guest' && RT.user().mustChangePin);
  RT.updateUser = (user) => { if (RT.session && user) { RT.session.user = Object.assign({}, RT.session.user, user); RT.saveSession(RT.session); } };
  RT.logout = function (expired) {
    const s = RT.session;
    if (s && s.token && !expired) RT.call('logout', { token: s.token }).catch(() => {});
    const share = s && s.share;
    RT.saveSession(null);
    location.hash = share ? '#/s/' + share.id : '#/login';
    if (expired) RT.toast('登入已過期，請重新登入', 'bad');
  };

  /* ================= 外框 ================= */
  RT.shell = function (cur, inner) {
    const u = RT.user();
    const nav = RT.isGuest() ? '' : `<nav class="nav">
        <a href="#/projects" class="${cur === 'projects' ? 'cur' : ''}">專案</a>
        ${RT.canManageUsers() ? `<a href="#/admin" class="${cur === 'admin' ? 'cur' : ''}">帳號管理</a>` : ''}
      </nav>`;
    $('#app').innerHTML = `
      <header class="topbar">
        ${RT.brandHTML(RT.isGuest() ? '#/s/' + esc(RT.session.share.id) : '#/projects')}
        ${nav}
        <span class="sp"></span>
        ${RT.isDemo ? '<span class="badge-demo" title="資料只存在這台電腦的瀏覽器">試用模式</span>' : ''}
        <div class="usermenu">
          <button class="btn ghost" id="userBtn">${esc(u.displayName)} ▾</button>
        </div>
      </header>
      <main id="main">${inner || ''}</main>`;
    $('#userBtn').onclick = (e) => {
      e.stopPropagation();
      const old = $('.usermenu .menu');
      if (old) { old.remove(); return; }
      const menu = RT.el(`<div class="menu">
        <div class="dim" style="padding:6px 10px;font-size:12px">${esc(u.username)}・${esc(RT.roleLabel(u.role))}</div>
        ${RT.isGuest() ? '' : '<button data-a="pin">變更 PIN</button>'}
        ${RT.isDemo && RT.isAdmin() ? '<button data-a="reset">清除試用資料</button>' : ''}
        <button data-a="logout">登出</button>
        <div class="dim mono" style="padding:6px 10px 4px;font-size:11px;border-top:1px solid var(--line);margin-top:4px">${esc(cfg.SITE_NAME || 'Retake Notes')} v${RT.VERSION}</div></div>`);
      $('.usermenu').appendChild(menu);
      menu.onclick = (ev) => {
        const a = ev.target.dataset.a;
        menu.remove();
        if (a === 'logout') RT.logout();
        if (a === 'pin') changePinModal();
        if (a === 'reset') RT.confirm('清除這台電腦上所有試用模式的資料？', '清除', true).then((ok) => { if (ok) { RT.resetDemo(); RT.saveSession(null); location.hash = '#/login'; location.reload(); } });
      };
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
    };
    return $('#main');
  };

  function changePinModal() {
    RT.modal({
      title: '變更 PIN',
      body: `<label class="field"><span>目前的 PIN</span><input type="password" inputmode="numeric" name="old" autocomplete="current-password"></label>
        <label class="field"><span>新的 PIN（4–12 位數字）</span><input type="password" inputmode="numeric" name="n1" autocomplete="new-password"></label>
        <label class="field"><span>再輸入一次</span><input type="password" inputmode="numeric" name="n2" autocomplete="new-password"></label>`,
      okText: '變更',
      onOk: async (m) => {
        const o = $('[name=old]', m).value, n1 = $('[name=n1]', m).value, n2 = $('[name=n2]', m).value;
        if (n1 !== n2) throw new Error('兩次輸入的 PIN 不一樣');
        const res = await RT.call('changePin', { oldPin: o, newPin: n1 });
        RT.updateUser(res.user);
        RT.toast('PIN 已變更', 'ok');
      }
    });
  }

  /* 第一次登入（或 PIN 被管理者重設）：先改成自己的 PIN 才能使用 */
  function pageForcePin() {
    const u = RT.user();
    $('#app').innerHTML = `<div class="login-wrap"><form class="login card" autocomplete="off">
      ${RT.brandHTML()}
      <h2 style="margin:0 0 6px;font-size:17px">請設定你自己的 PIN</h2>
      <p class="muted" style="margin:0 0 14px;font-size:13px">${esc(u.displayName)}，這是你第一次登入（或管理者剛重設了你的 PIN）。<br>請把管理者給你的預設 PIN 換成只有你知道的 PIN，換好才能開始使用。</p>
      <label class="field"><span>預設 PIN（管理者給你的）</span><input type="password" name="old" inputmode="numeric" autocomplete="current-password" required></label>
      <label class="field"><span>新的 PIN（4–12 位數字）</span><input type="password" name="n1" inputmode="numeric" autocomplete="new-password" required></label>
      <label class="field"><span>再輸入一次新的 PIN</span><input type="password" name="n2" inputmode="numeric" autocomplete="new-password" required></label>
      <div class="err" id="pinErr"></div>
      <button class="btn primary" type="submit">設定並開始使用</button>
      <p class="dim" style="font-size:12px;margin:12px 0 0">不是你的帳號？<a href="#" id="forceLogout">登出</a></p>
    </form></div>`;
    const f = $('.login');
    f.old.focus();
    $('#forceLogout').onclick = (e) => { e.preventDefault(); RT.logout(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      $('#pinErr').textContent = '';
      try {
        if (!/^\d{4,12}$/.test(f.n1.value)) throw new Error('新的 PIN 需為 4–12 位數字');
        if (f.n1.value !== f.n2.value) throw new Error('兩次輸入的新 PIN 不一樣');
        const res = await RT.busy($('button[type=submit]', f), () => RT.call('changePin', { oldPin: f.old.value, newPin: f.n1.value }));
        RT.updateUser(Object.assign({ mustChangePin: false }, res.user));
        RT.toast('PIN 已設定，之後請用新的 PIN 登入', 'ok');
        route();
      } catch (err) {
        if (err.code === 'AUTH') { RT.logout(true); return; }
        $('#pinErr').textContent = err.message;
      }
    };
  }

  /* ================= 路由 ================= */
  RT.cleanup = null;
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const q = {};
    (qs || '').split('&').forEach((kv) => { if (kv) { const [k, v] = kv.split('='); q[decodeURIComponent(k)] = decodeURIComponent(v || ''); } });
    return { parts, q };
  }
  async function route() {
    if (RT.cleanup) { try { RT.cleanup(); } catch (e) { console.error(e); } RT.cleanup = null; }
    $$('.modal-back').forEach((m) => m.remove());
    const { parts, q } = parseHash();
    const page = parts[0] || '';
    document.title = cfg.SITE_NAME || 'Retake Notes';
    if (page === 's' && parts[1]) {
      if (RT.isGuest() && RT.session.share.id === parts[1]) return guestHome();
      return pageShare(parts[1]);
    }
    if (!RT.session) return pageLogin();
    if (RT.isGuest()) {
      if (page === 'r' && parts[1]) return RT.pageReview(parts[1], q);
      if (page === 'p' && parts[1] === RT.session.share.projectId) return pageProject(parts[1]);
      return guestHome();
    }
    if (RT.needsPinChange()) return pageForcePin();
    try {
      if (page === 'p' && parts[1]) return await pageProject(parts[1]);
      if (page === 'r' && parts[1]) return await RT.pageReview(parts[1], q);
      if (page === 'admin' && RT.canManageUsers()) return await pageAdmin();
      return await pageProjects();
    } catch (e) { RT.fail(e); }
  }
  RT.route = route;
  window.addEventListener('hashchange', route);

  /* ================= 登入 ================= */
  function pageLogin() {
    if (RT.session) { location.hash = '#/projects'; return; }
    $('#app').innerHTML = `<div class="login-wrap"><form class="login card" autocomplete="on">
      ${RT.brandHTML()}
      <label class="field"><span>帳號</span><input type="text" name="username" autocomplete="username" autocapitalize="off" required></label>
      <label class="field"><span>PIN 碼</span><input type="password" name="pin" inputmode="numeric" autocomplete="current-password" required></label>
      <div class="err" id="loginErr"></div>
      <button class="btn primary" type="submit">登入</button>
      ${RT.isDemo ? `<div class="demo-tip"><b>試用模式</b>：資料只存在這台電腦的瀏覽器。<br>管理者 <span class="mono">admin / 1234</span>　廠商 <span class="mono">studio_a / 5678</span><br>Acer同事 <span class="mono">acer_amy / 2468</span><br>專案負責人 <span class="mono">pm_lin / 1357</span>　<span class="mono">pm_chen / 9753</span><br>正式使用請依 README 設定 Google Apps Script。</div>` : ''}
    </form></div>`;
    const f = $('.login');
    f.username.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', f);
      $('#loginErr').textContent = '';
      try {
        const res = await RT.busy(btn, () => RT.call('login', { username: f.username.value, pin: f.pin.value }));
        RT.saveSession({ token: res.token, user: res.user });
        const back = sessionStorage.getItem('rt_after_login');
        sessionStorage.removeItem('rt_after_login');
        location.hash = back || '#/projects';
      } catch (err) { $('#loginErr').textContent = err.message; f.pin.select(); }
    };
  }

  /* ================= 分享連結（訪客） ================= */
  async function pageShare(id) {
    $('#app').innerHTML = '<div class="login-wrap"><div class="login card"><div class="dim">讀取分享連結…</div></div></div>';
    let info;
    try { info = await RT.call('shareInfo', { id }); }
    catch (e) { $('.login').innerHTML = `${RT.brandHTML()}<p class="err">${esc(e.message)}</p>`; return; }
    $('#app').innerHTML = `<div class="login-wrap"><form class="login card">
      ${RT.brandHTML()}
      <p style="margin:0 0 14px">你受邀審閱 <b>${esc(info.share.label || info.projectName)}</b>${info.share.canComment ? '（可以留言）' : '（僅能檢視）'}</p>
      <label class="field"><span>你的名字</span><input type="text" name="name" required maxlength="30" value="${esc(localStorage.getItem('rt_guest_name') || '')}"></label>
      ${info.share.hasPass ? '<label class="field"><span>密碼</span><input type="password" name="pass" required></label>' : ''}
      <div class="err" id="loginErr"></div>
      <button class="btn primary" type="submit">開始審閱</button>
      <p class="dim" style="font-size:12px;margin:12px 0 0">已有帳號？<a href="#/login">用帳號登入</a></p>
    </form></div>`;
    const f = $('.login');
    f.onsubmit = async (e) => {
      e.preventDefault();
      $('#loginErr').textContent = '';
      try {
        const res = await RT.busy($('button[type=submit]', f), () => RT.call('shareLogin', { id, name: f.name.value, pass: f.pass ? f.pass.value : '' }));
        localStorage.setItem('rt_guest_name', f.name.value);
        RT.saveSession({ token: res.token, user: res.user, share: res.share });
        guestHome();
      } catch (err) { $('#loginErr').textContent = err.message; }
    };
  }
  function guestHome() {
    const sh = RT.session.share;
    if (sh.versionId) location.hash = '#/r/' + sh.versionId;
    else location.hash = '#/p/' + sh.projectId;
  }

  /* ================= 專案列表 / 儀表板 ================= */
  async function pageProjects() {
    const main = RT.shell('projects', '<div class="page"><div class="dim">載入中…</div></div>');
    const [pr, tk] = await Promise.all([RT.call('listProjects'), RT.call('myTasks')]);
    const projects = pr.projects;
    const active = projects.filter((p) => p.status !== '已完成' && p.status !== '暫停');
    const open = projects.reduce((s, p) => s + p.stats.total - p.stats.done, 0);
    const overdue = projects.reduce((s, p) => s + p.stats.overdue, 0);
    const today = RT.todayStr();
    main.innerHTML = `<div class="page">
      <div class="pagehead"><div class="grow"><h1>專案總覽</h1></div>
        ${RT.canManageUsers() ? '<button class="btn primary" id="newProject">＋ 新增專案</button>' : ''}</div>
      <div class="tiles">
        <div class="tile"><div class="k">進行中的專案</div><div class="v">${active.length}</div></div>
        <div class="tile"><div class="k">未完成的註記</div><div class="v">${open}</div></div>
        <div class="tile"><div class="k">逾期註記</div><div class="v ${overdue ? 'bad' : ''}">${overdue}</div></div>
        <div class="tile"><div class="k">指派給我／提到我</div><div class="v">${tk.tasks.length}</div></div>
      </div>
      ${tk.tasks.length ? `<div class="section"><div class="row"><h2>我的待辦</h2></div><div class="tasks card" style="padding:4px 12px">
        ${tk.tasks.slice(0, 12).map((t) => `<div class="task" data-href="#/r/${esc(t.versionId)}?note=${esc(t.id)}">
          <div class="mono dim" style="font-size:12.5px">${esc(t.projectName)}<br>${esc(t.versionLabel)} ${esc(t.tc)}</div>
          <div class="t">${esc(t.text)}</div>
          <div class="row">${t.dueDate ? `<span class="${t.dueDate < today ? 'overdue' : 'dim'}" style="font-size:12px">${esc(t.dueDate)}</span>` : ''}${RT.statusPill(t.status)}</div>
        </div>`).join('')}</div></div>` : ''}
      <div class="section"><div class="row"><h2>專案</h2><span class="sp"></span>
        <select id="pfilter"><option value="">全部狀態</option>${RTCore.PROJECT_STATUS.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="projects" id="plist"></div></div>
    </div>`;
    const renderList = () => {
      const f = $('#pfilter').value;
      const list = projects.filter((p) => !f || p.status === f);
      $('#plist').innerHTML = list.length ? list.map((p) => `<div class="pcard" data-href="#/p/${esc(p.id)}">
        <div class="row"><h3 class="grow">${esc(p.name)}</h3>${RT.statusPill(p.status)}</div>
        ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}
        ${RT.progressBar(p.stats)}
        <div class="chips">
          ${p.leads && p.leads.length && !RT.isLead() ? `<span class="chip">負責人 <b>${esc(p.leads.join('、'))}</b></span>` : ''}
          <span class="chip">註記 <b>${p.stats.total}</b></span>
          <span class="chip">完成 <b>${p.stats.done}</b></span>
          ${p.stats.byStatus['已修改'] ? `<span class="chip">待確認 <b>${p.stats.byStatus['已修改']}</b></span>` : ''}
          ${p.stats.overdue ? `<span class="chip overdue">逾期 <b class="overdue">${p.stats.overdue}</b></span>` : ''}
        </div>
        <div class="row dim" style="font-size:12.5px"><span>${p.latest ? '最新 ' + esc(p.latest.label) + '・' + esc(p.latest.status) : '尚無版本'}</span><span class="sp"></span>
          ${p.dueDate ? `<span class="${p.dueDate < today && p.status !== '已完成' ? 'overdue' : ''}">截止 ${esc(p.dueDate)}</span>` : ''}</div>
      </div>`).join('') : `<div class="empty">${RT.canManageUsers() ? '還沒有專案，按右上角「新增專案」開始。' : '目前沒有指派給你的專案。'}</div>`;
    };
    $('#pfilter').onchange = renderList;
    renderList();
    main.addEventListener('click', (e) => { const c = e.target.closest('[data-href]'); if (c) location.hash = c.dataset.href; });
    if ($('#newProject')) $('#newProject').onclick = () => projectModal(null);
  }

  /* ================= 專案設定 ================= */
  async function projectModal(p) {
    const order = { lead: 0, acer: 1, vendor: 2 };
    const me = RT.user().username.toLowerCase();
    const users = (await RT.call('listUsers')).users.filter((u) => u.role !== 'admin' && u.active && u.username.toLowerCase() !== me)
      .sort((a, b) => (order[a.role] - order[b.role]) || a.displayName.localeCompare(b.displayName));
    const members = p ? p.members.map((s) => s.toLowerCase()) : [];
    const leads = users.filter((u) => u.role === 'lead'), others = users.filter((u) => u.role !== 'lead');
    const box = (u) => `<label class="chk"><input type="checkbox" name="m" value="${esc(u.username.toLowerCase())}" ${members.includes(u.username.toLowerCase()) ? 'checked' : ''}>${esc(u.displayName)} <span class="dim">${u.role === 'vendor' ? esc(u.company || u.username) : RT.roleLabel(u.role)}</span></label>`;
    const leadField = RT.isAdmin() ? `<div class="field"><span>專案負責人（對此專案有和管理者一樣的權限；看不到其他負責人的專案）</span>
          <div class="row wrap" style="gap:6px 16px">${leads.length ? leads.map(box).join('') : '<span class="dim">尚未建立專案負責人帳號，可到「帳號管理」新增。</span>'}</div></div>` : '';
    RT.modal({
      title: p ? '編輯專案' : '新增專案', wide: true,
      body: `<label class="field"><span>專案名稱</span><input type="text" name="name" value="${esc(p ? p.name : '')}"></label>
        <label class="field"><span>說明</span><textarea name="description" rows="3">${esc(p ? p.description : '')}</textarea></label>
        <div class="grid2">
          <label class="field"><span>狀態</span><select name="status">${RTCore.PROJECT_STATUS.map((s) => `<option ${p && p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="field"><span>截止日</span><input type="date" name="dueDate" value="${esc(p ? p.dueDate : '')}"></label>
        </div>
        ${leadField}
        <div class="field"><span>參與的成員（Acer 同事與廠商；只有勾選的人看得到此專案，管理者一律看得到${RT.isLead() ? '，你自己會自動加入' : ''}）</span>
          <div class="row wrap" style="gap:6px 16px">${others.length ? others.map(box).join('') : '<span class="dim">尚未建立 Acer 同事或廠商帳號，請到「帳號管理」新增。</span>'}</div></div>
        <label class="chk"><input type="checkbox" name="watermark" ${p && p.watermark ? 'checked' : ''}> 廠商與訪客觀看時顯示浮水印（姓名＋日期）</label>`,
      okText: p ? '儲存' : '建立',
      onOk: async (m) => {
        const res = await RT.call('saveProject', {
          project: {
            id: p ? p.id : '', name: $('[name=name]', m).value, description: $('[name=description]', m).value,
            status: $('[name=status]', m).value, dueDate: $('[name=dueDate]', m).value,
            members: $$('[name=m]:checked', m).map((c) => c.value), watermark: $('[name=watermark]', m).checked
          }
        });
        RT.toast(p ? '專案已儲存' : '專案已建立', 'ok');
        if (p) route(); else location.hash = '#/p/' + res.project.id;
      }
    });
  }

  /* ================= 專案頁 ================= */
  async function pageProject(id) {
    const main = RT.shell('projects', '<div class="page"><div class="dim">載入中…</div></div>');
    const data = await RT.call('getProject', { id });
    const p = data.project, versions = data.versions;
    RT.currentProject = data;
    document.title = p.name + ' — ' + (cfg.SITE_NAME || 'Retake Notes');
    const canAddVersion = !RT.isGuest();
    const canManage = !!data.canManage; // 管理者，或此專案的專案負責人
    const today = RT.todayStr();
    const peopleMap = {};
    data.people.forEach((x) => { peopleMap[x.username.toLowerCase()] = x; });
    main.innerHTML = `<div class="page">
      <div class="pagehead"><div class="grow">
          ${RT.isGuest() ? '' : '<div class="crumb"><a href="#/projects">專案</a> ›</div>'}
          <div class="row wrap"><h1>${esc(p.name)}</h1>${RT.statusPill(p.status)}
            ${p.dueDate ? `<span class="${p.dueDate < today && p.status !== '已完成' ? 'overdue' : 'dim'}">截止 ${esc(p.dueDate)}</span>` : ''}
            ${p.watermark ? '<span class="chip">浮水印</span>' : ''}</div>
          ${p.description ? `<p class="muted" style="margin:6px 0 0;white-space:pre-wrap">${esc(p.description)}</p>` : ''}
        </div>
        <div class="row wrap">
          <button class="btn" id="expXlsx">匯出 Excel</button>
          <button class="btn" id="expPdf">匯出 PDF</button>
          ${canManage ? '<button class="btn" id="editProject">專案設定</button>' : ''}
          ${canAddVersion ? '<button class="btn primary" id="addVersion">＋ 新增版本</button>' : ''}
        </div>
      </div>
      <div class="tiles">
        <div class="tile"><div class="k">註記總數</div><div class="v">${data.stats.total}</div></div>
        ${RTCore.NOTE_STATUS.map((s) => `<div class="tile"><div class="k">${s}</div><div class="v" style="font-size:22px">${data.stats.byStatus[s] || 0}</div></div>`).join('')}
        <div class="tile"><div class="k">逾期</div><div class="v ${data.stats.overdue ? 'bad' : ''}" style="font-size:22px">${data.stats.overdue}</div></div>
      </div>
      <div style="margin-top:12px">${RT.progressBar(data.stats)}</div>
      ${RT.isGuest() ? '' : `<div class="chips" style="margin-top:12px"><span class="dim" style="font-size:12.5px">成員：</span>${data.people.map((x) => `<span class="chip">${esc(x.displayName)}${x.role !== 'vendor' ? ' · ' + RT.roleLabel(x.role) : x.company ? ' · ' + esc(x.company) : ''}</span>`).join('')}</div>`}

      <div class="section"><div class="row"><h2>版本</h2><span class="dim" style="font-size:12.5px">由新到舊</span></div>
        ${versions.length ? `<div class="card table-wrap" style="padding:0"><table class="table">
          <thead><tr><th>版本</th><th>影片來源</th><th>規格</th><th>狀態</th><th style="min-width:160px">註記進度</th><th>建立</th><th></th></tr></thead>
          <tbody>${versions.slice().reverse().map((v) => `<tr class="click" data-href="#/r/${esc(v.id)}">
            <td><b>${esc(v.label)}</b>${v.remark ? `<div class="dim" style="font-size:12px">${esc(v.remark)}</div>` : ''}</td>
            <td style="max-width:240px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="chip" style="${v.url ? 'color:var(--accent2);border-color:rgba(0,174,205,.5)' : ''}">${v.url ? '雲端' : '本機'}</span>　${esc(v.fileName || v.url || '—')}</div></td>
            <td class="mono dim" style="font-size:12px">${v.fps}${v.dropFrame ? ' DF' : ''} fps${v.width ? '<br>' + v.width + '×' + v.height : ''}</td>
            <td>${RT.statusPill(v.status)}</td>
            <td>${RT.progressBar(v.stats)}<div class="dim" style="font-size:12px;margin-top:3px">${v.stats.done} / ${v.stats.total} 完成${v.stats.overdue ? `・<span class="overdue">逾期 ${v.stats.overdue}</span>` : ''}</div></td>
            <td class="dim" style="font-size:12px;white-space:nowrap">${esc(RT.fmtTime(v.createdAt))}<br>${esc((peopleMap[String(v.createdBy).toLowerCase()] || {}).displayName || v.createdBy || '')}</td>
            <td style="white-space:nowrap"><button class="btn sm" data-review="${esc(v.id)}">審閱</button>
              ${canAddVersion ? `<button class="btn sm ghost" data-editv="${esc(v.id)}">編輯</button>` : ''}
              ${canManage ? `<button class="btn sm ghost danger" data-delv="${esc(v.id)}">刪除</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${canAddVersion ? '還沒有版本。按「新增版本」選擇本機影片或貼上雲端連結。' : '還沒有版本。'}</div>`}
      </div>
      ${canManage ? `<div class="section"><div class="row"><h2>免帳號分享連結</h2><span class="sp"></span><button class="btn sm" id="addShare">＋ 建立分享連結</button></div>
        ${data.shares.length ? `<div class="card table-wrap" style="padding:0"><table class="table"><thead><tr><th>名稱</th><th>範圍</th><th>權限</th><th>到期</th><th>狀態</th><th></th></tr></thead><tbody>
          ${data.shares.slice().reverse().map((s) => {
            const v = versions.find((x) => x.id === s.versionId);
            const expired = s.expires && s.expires < today;
            return `<tr><td>${esc(s.label)}${s.hasPass ? ' 🔒' : ''}</td><td>${v ? esc(v.label) : '整個專案'}</td><td>${s.canComment ? '可留言' : '僅檢視'}</td>
              <td>${esc(s.expires || '不限')}</td><td>${!s.active ? '<span class="dim">已停用</span>' : expired ? '<span class="overdue">已過期</span>' : '<span style="color:var(--ok)">有效</span>'}</td>
              <td style="white-space:nowrap">${s.active ? `<button class="btn sm" data-copy="${esc(s.id)}">複製連結</button> <button class="btn sm ghost danger" data-revoke="${esc(s.id)}">停用</button>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">沒有分享連結。分享連結可以讓沒有帳號的人檢視（或留言）指定版本。</div>'}
      </div>` : ''}
    </div>`;

    main.addEventListener('click', async (e) => {
      const t = e.target.closest('button, [data-href]');
      if (!t) return;
      if (t.dataset.review) { e.stopPropagation(); location.hash = '#/r/' + t.dataset.review; return; }
      if (t.dataset.editv) { e.stopPropagation(); versionModal(data, versions.find((v) => v.id === t.dataset.editv)); return; }
      if (t.dataset.delv) {
        e.stopPropagation();
        const v = versions.find((x) => x.id === t.dataset.delv);
        if (await RT.confirm(`刪除版本 ${v.label}？\n此版本的 ${v.stats.total} 則註記與回覆會一併刪除，無法復原。`, '刪除', true)) {
          try { await RT.call('deleteVersion', { id: v.id }); RT.toast('已刪除'); route(); } catch (er) { RT.fail(er); }
        }
        return;
      }
      if (t.dataset.copy) {
        const url = shareUrl(t.dataset.copy);
        navigator.clipboard.writeText(url).then(() => RT.toast('已複製：' + url, 'ok'), () => RT.modal({ title: '分享連結', body: `<input type="text" readonly value="${esc(url)}" style="width:100%">`, okText: null, cancelText: '關閉' }));
        return;
      }
      if (t.dataset.revoke) {
        if (await RT.confirm('停用這個分享連結？已經開啟的訪客會在下一次操作時被登出。', '停用', true)) {
          try { await RT.call('revokeShare', { id: t.dataset.revoke }); route(); } catch (er) { RT.fail(er); }
        }
        return;
      }
      if (t.dataset.href && t.tagName !== 'BUTTON') location.hash = t.dataset.href;
    });
    if ($('#editProject')) $('#editProject').onclick = () => projectModal(p);
    if ($('#addVersion')) $('#addVersion').onclick = () => versionModal(data, null);
    if ($('#addShare')) $('#addShare').onclick = () => shareModal(data);
    $('#expXlsx').onclick = (e) => exportProject(e.target, data, 'xlsx');
    $('#expPdf').onclick = (e) => exportProject(e.target, data, 'pdf');
  }

  function shareUrl(id) { return location.href.replace(/#.*$/, '') + '#/s/' + id; }

  RT.exportDialog = function (data, kind, preselectVersion) {
    const versions = data.versions;
    if (!versions.length) { RT.toast('還沒有版本可以匯出'); return; }
    RT.modal({
      title: kind === 'pdf' ? '匯出 PDF' : '匯出 Excel',
      body: `<label class="field"><span>範圍</span><select name="scope"><option value="">所有版本</option>
          ${versions.slice().reverse().map((v) => `<option value="${esc(v.id)}" ${v.id === preselectVersion ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label class="field"><span>註記狀態</span><select name="st"><option value="">全部</option><option value="open">只匯出未完成（排除已確認／不修改）</option></select></label>
        ${kind === 'pdf' ? '<p class="dim" style="font-size:12.5px;margin:0">會開啟列印視窗，請在「目的地」選擇「另存為 PDF」。</p>' : '<label class="chk"><input type="checkbox" name="thumbs" checked> 包含截圖</label>'}`,
      okText: '匯出',
      onOk: async (m) => {
        const vid = $('[name=scope]', m).value;
        const st = $('[name=st]', m).value;
        const res = await RT.call('listNotes', vid ? { versionId: vid } : { projectId: data.project.id });
        let notes = res.notes;
        if (st === 'open') notes = notes.filter((n) => !RTCore.NOTE_DONE.includes(n.status));
        const vs = vid ? versions.filter((v) => v.id === vid) : versions;
        const opts = { project: data.project, versions: vs, notes, people: data.people, user: RT.user(), includeThumbs: kind === 'pdf' || $('[name=thumbs]', m).checked };
        if (kind === 'pdf') await RT.exportPdf(opts);
        else { await RT.exportExcel(opts); RT.toast('Excel 已下載', 'ok'); }
      }
    });
  };
  function exportProject(btn, data, kind) { RT.exportDialog(data, kind); }

  /* ================= 新增 / 編輯版本 ================= */
  RT.pendingFiles = {};
  function versionModal(data, v) {
    const isNew = !v;
    const versions = data.versions;
    const last = versions[versions.length - 1];
    const unresolved = last ? last.stats.total - last.stats.done : 0;
    let probed = null, chosenFile = null;
    const fpsOptions = (sel) => TC.COMMON_FPS.map((f) => `<option value="${f}" ${Number(sel) === f ? 'selected' : ''}>${f}</option>`).join('');
    RT.modal({
      title: isNew ? '新增版本' : '編輯版本 ' + v.label, wide: true, noEnter: true,
      body: `<div class="grid2">
          <label class="field"><span>版本名稱</span><input type="text" name="label" value="${esc(v ? v.label : 'v' + (versions.length + 1))}"></label>
          <label class="field"><span>版本狀態</span><select name="status">${RTCore.VERSION_STATUS.map((s) => `<option ${(v ? v.status : '審閱中') === s ? 'selected' : ''} ${s === '已核准' && !data.canManage && !(v && v.status === s) ? 'disabled' : ''}>${s}</option>`).join('')}</select></label>
        </div>
        <div class="field"><span>影片來源</span>
          <div class="row wrap" style="gap:16px">
            <label class="chk"><input type="radio" name="src" value="local" ${!v || !v.url ? 'checked' : ''}> 本機檔案（不上傳，每個人用自己電腦上的同一個檔案）</label>
            <label class="chk"><input type="radio" name="src" value="url" ${v && v.url ? 'checked' : ''}> 雲端連結</label>
          </div></div>
        <div data-srcpane="local" class="field">
          <input type="file" accept="video/mp4,video/quicktime,video/*" name="file">
          <div class="hint">${v && v.fileName ? '目前記錄：' + esc(v.fileName) + '（' + (v.fileSize / 1048576).toFixed(1) + ' MB）。重新選擇會更新記錄。' : '選擇後會自動讀取 fps 與總格數。檔案不會上傳。'}</div>
        </div>
        <div data-srcpane="url" class="field">
          <div class="row"><input type="url" name="url" class="grow" placeholder="https://drive.google.com/file/d/…/view" value="${esc(v ? v.url : '')}"><button class="btn" type="button" data-probe>讀取規格</button></div>
          <div class="hint">支援 Google Drive（需設為「知道連結的人都能檢視」）、Dropbox，或任何可直接播放的 mp4 網址。</div>
        </div>
        <div class="dim" data-probeinfo style="font-size:12.5px;margin:-4px 0 10px"></div>
        <div class="grid2">
          <label class="field"><span>fps</span><select name="fps">${fpsOptions(v ? v.fps : cfg.DEFAULT_FPS || 24)}</select></label>
          <label class="field"><span>起始時間碼</span><div class="row"><input type="text" name="startTC" class="grow mono" value="${esc(v ? v.startTC : '00:00:00:00')}">
            <button class="btn sm" type="button" data-tc="00:00:00:00">00</button><button class="btn sm" type="button" data-tc="01:00:00:00">01</button></div></label>
        </div>
        <label class="chk" data-dfwrap><input type="checkbox" name="df" ${v && v.dropFrame ? 'checked' : ''}> Drop-frame 時間碼（29.97 / 59.94）</label>
        <label class="field" style="margin-top:12px"><span>備註</span><input type="text" name="remark" value="${esc(v ? v.remark : '')}" placeholder="例如：調色版、加上字幕"></label>
        ${isNew && last ? `<label class="chk"><input type="checkbox" name="carry" ${unresolved ? 'checked' : ''}> 沿用 ${esc(last.label)} 未解決的註記（${unresolved} 則）</label>` : ''}`,
      okText: isNew ? '建立並開始審閱' : '儲存',
      onOpen: (m) => {
        const panes = () => {
          const src = $('[name=src]:checked', m).value;
          $$('[data-srcpane]', m).forEach((el) => el.classList.toggle('hidden', el.dataset.srcpane !== src));
        };
        const dfToggle = () => { $('[data-dfwrap]', m).classList.toggle('hidden', !TC.isDFCapable($('[name=fps]', m).value)); };
        $$('[name=src]', m).forEach((r) => r.onchange = panes);
        $('[name=fps]', m).onchange = dfToggle;
        $$('[data-tc]', m).forEach((b) => b.onclick = () => { $('[name=startTC]', m).value = b.dataset.tc; });
        panes(); dfToggle();
        const showProbe = (info, label) => {
          probed = info;
          if (!info) return;
          const sel = $('[name=fps]', m);
          if (!TC.COMMON_FPS.includes(info.fps)) sel.insertAdjacentHTML('beforeend', `<option value="${info.fps}">${info.fps}</option>`);
          sel.value = String(info.fps);
          dfToggle();
          $('[data-probeinfo]', m).innerHTML = `✓ ${esc(label)}：<span class="mono">${info.fps} fps・${info.frames} 格・${info.width}×${info.height}</span>${info.variable ? '　<span class="overdue">此檔可能是可變幀率 (VFR)，逐格位置可能不準</span>' : ''}`;
        };
        $('[name=file]', m).onchange = async (e) => {
          chosenFile = e.target.files[0];
          probed = null;
          if (!chosenFile) return;
          $('[data-probeinfo]', m).textContent = '讀取中…';
          try { showProbe(await RT.probeMp4({ file: chosenFile }), chosenFile.name); }
          catch (er) { $('[data-probeinfo]', m).textContent = '無法自動讀取 fps（' + er.message + '），請手動選擇。'; }
        };
        $('[data-probe]', m).onclick = async () => {
          const url = RT.normalizeVideoUrl($('[name=url]', m).value);
          if (!url) return;
          $('[data-probeinfo]', m).textContent = '讀取中…';
          try { showProbe(await RT.probeMp4({ url }), '雲端影片'); }
          catch (er) { $('[data-probeinfo]', m).textContent = '無法從連結讀取規格（' + er.message + '）。仍可建立版本，請手動選擇 fps；開啟審閱時會再試一次。'; }
        };
      },
      onOk: async (m) => {
        const src = $('[name=src]:checked', m).value;
        const fps = Number($('[name=fps]', m).value);
        const startTC = $('[name=startTC]', m).value.trim() || '00:00:00:00';
        const df = $('[name=df]', m).checked && TC.isDFCapable(fps);
        if (!isFinite(TC.tcToFrames(startTC, fps, df)) || !/[:;]/.test(startTC)) throw new Error('起始時間碼格式應為 HH:MM:SS:FF');
        const ver = {
          id: v ? v.id : '', projectId: data.project.id, label: $('[name=label]', m).value.trim(), status: $('[name=status]', m).value,
          fps, startTC: TC.framesToTC(TC.tcToFrames(startTC, fps, df), fps, df), dropFrame: df, remark: $('[name=remark]', m).value, sourceType: src
        };
        if (src === 'url') {
          const url = $('[name=url]', m).value.trim();
          if (!/^https:\/\//i.test(url)) throw new Error('請貼上 https:// 開頭的雲端連結');
          ver.url = url;
        } else {
          ver.url = '';
          if (chosenFile) { ver.fileName = chosenFile.name; ver.fileSize = chosenFile.size; }
          else if (isNew) throw new Error('請選擇本機影片檔');
        }
        if (probed) { ver.durationFrames = probed.frames; ver.width = probed.width; ver.height = probed.height; }
        const carry = $('[name=carry]', m);
        const res = await RT.call('saveVersion', { version: ver, carryFrom: isNew && carry && carry.checked ? last.id : '' });
        if (chosenFile) RT.pendingFiles[res.version.id] = chosenFile;
        if (isNew) {
          RT.toast(`已建立 ${res.version.label}` + (res.version.carried ? `，沿用 ${res.version.carried} 則註記` : ''), 'ok');
          location.hash = '#/r/' + res.version.id;
        } else { RT.toast('已儲存', 'ok'); route(); }
      }
    });
  }
  RT.versionModal = versionModal;

  /* ================= 分享連結 ================= */
  function shareModal(data) {
    RT.modal({
      title: '建立分享連結',
      body: `<label class="field"><span>名稱（訪客會看到）</span><input type="text" name="label" value="${esc(data.project.name)}"></label>
        <label class="field"><span>範圍</span><select name="version"><option value="">整個專案（所有版本）</option>
          ${data.versions.slice().reverse().map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('')}</select></label>
        <div class="grid2">
          <label class="field"><span>到期日（空白 = 不限）</span><input type="date" name="expires"></label>
          <label class="field"><span>密碼（選填）</span><input type="text" name="pass" autocomplete="off"></label>
        </div>
        <label class="chk"><input type="checkbox" name="comment" checked> 允許訪客留言與回覆</label>
        <p class="dim" style="font-size:12.5px">訪客看不到「內部」註記，也不能變更狀態。影片若是本機檔案，訪客需要自己有同一個檔案；雲端連結則會自動載入。</p>`,
      okText: '建立',
      onOk: async (m) => {
        const res = await RT.call('saveShare', {
          share: {
            projectId: data.project.id, versionId: $('[name=version]', m).value, label: $('[name=label]', m).value,
            expires: $('[name=expires]', m).value, pass: $('[name=pass]', m).value, canComment: $('[name=comment]', m).checked
          }
        });
        const url = shareUrl(res.share.id);
        try { await navigator.clipboard.writeText(url); RT.toast('分享連結已建立並複製', 'ok'); } catch (e) { RT.toast('分享連結已建立', 'ok'); }
        route();
      }
    });
  }

  /* ================= 帳號管理 ================= */
  async function pageAdmin() {
    const main = RT.shell('admin', '<div class="page"><div class="dim">載入中…</div></div>');
    const users = (await RT.call('listUsers')).users.filter((u) => u.canEdit);
    const intro = RT.isLead()
      ? '你可以建立 Acer 同事與廠商帳號，再到專案設定把他們加入你負責的專案。這裡只列出你建立的帳號。'
      : '管理者看得到所有專案；專案負責人、Acer 同事與廠商只看得到被加入的專案。';
    main.innerHTML = `<div class="page">
      <div class="pagehead"><div class="grow"><h1>帳號管理</h1><div class="muted" style="font-size:13px">${intro}新帳號第一次登入、或你重設 PIN 之後，對方必須先改成自己的 PIN。</div></div>
        <button class="btn primary" id="addUser">＋ 新增帳號</button></div>
      <div class="card table-wrap" style="padding:0"><table class="table"><thead><tr><th>帳號</th><th>顯示名稱</th><th>角色</th><th>公司</th><th>Email</th><th>通知</th><th>狀態</th><th></th></tr></thead>
      <tbody>${users.length ? '' : '<tr><td colspan="8" class="dim" style="text-align:center;padding:18px">還沒有帳號，按右上角「新增帳號」。</td></tr>'}${users.map((u) => `<tr class="click" data-u="${esc(u.username)}"><td class="mono">${esc(u.username)}</td><td>${esc(u.displayName)}</td>
        <td>${esc(RT.roleLabel(u.role))}</td><td>${esc(u.company || '')}</td><td>${esc(u.email || '')}</td><td>${u.notify ? '✓' : ''}</td>
        <td>${u.active ? '<span style="color:var(--ok)">啟用</span>' : '<span class="dim">停用</span>'}${u.mustChangePin ? ' <span class="dim" title="還在用你給的預設 PIN，下次登入會被要求變更">・待改 PIN</span>' : ''}</td><td><button class="btn sm ghost">編輯</button></td></tr>`).join('')}</tbody></table></div>
      ${RT.isDemo ? '<p class="dim" style="font-size:12.5px;margin-top:12px">試用模式不會真的寄信，通知與 PIN 信的內容會顯示在瀏覽器的開發者主控台。</p>' : ''}
    </div>`;
    $('#addUser').onclick = () => userModal(null);
    main.addEventListener('click', (e) => { const tr = e.target.closest('[data-u]'); if (tr) userModal(users.find((u) => u.username === tr.dataset.u)); });
  }

  function userModal(u) {
    const self = !!u && u.username.toLowerCase() === RT.user().username.toLowerCase();
    const roles = RT.isAdmin() ? ['vendor', 'acer', 'lead', 'admin'] : RTCore.MEMBER_ROLES.slice().reverse();
    const roleHelp = `<b>廠商</b>＝看被加入的專案、看不到內部註記；<b>Acer同事</b>＝看被加入的專案、可看及建立內部註記、可設定所有註記狀態` +
      (RT.isAdmin() ? '；<b>專案負責人</b>＝只看得到自己負責的專案，並對這些專案有和管理者一樣的權限（設定、成員、核准、刪除、分享連結），也可以建立 Acer 同事與廠商帳號；<b>管理者</b>＝所有專案、最高權限。' : '。');
    RT.modal({
      title: u ? '編輯帳號' : '新增帳號',
      body: `<div class="grid2">
          <label class="field"><span>帳號（英數字，登入用）</span><input type="text" name="username" value="${esc(u ? u.username : '')}" ${u ? 'readonly' : ''} autocapitalize="off"></label>
          <label class="field"><span>顯示名稱</span><input type="text" name="displayName" value="${esc(u ? u.displayName : '')}"></label>
          <label class="field"><span>角色</span><select name="role" ${self ? 'disabled' : ''}>${roles.map((r) => `<option value="${r}" ${(u ? u.role : 'vendor') === r ? 'selected' : ''}>${RT.roleLabel(r)}</option>`).join('')}</select></label>
          <label class="field"><span>公司 / 單位</span><input type="text" name="company" value="${esc(u ? u.company : '')}"></label>
          <label class="field"><span>Email（寄 PIN 與通知用）</span><input type="email" name="email" value="${esc(u ? u.email : '')}"></label>
          ${self ? '<div></div>' : `<label class="field"><span>${u ? '重設 PIN（空白＝不變）' : '預設 PIN（空白＝自動產生 6 位數）'}</span><input type="text" name="pin" inputmode="numeric" autocomplete="off" placeholder="${u ? '' : '自動產生'}"></label>`}
        </div>
        ${self ? '<p class="dim" style="font-size:12.5px;margin:0 0 10px">這是你自己的帳號；改自己的 PIN 請用右上角「變更 PIN」。</p>' : `
        <div class="row wrap" style="gap:18px;margin:0 0 6px">
          ${u ? '<label class="chk"><input type="checkbox" name="resetPin"> 重設 PIN（空白則自動產生）</label>' : ''}
          <label class="chk"><input type="checkbox" name="sendPin" ${u ? '' : 'checked'}> 用 Email 把 PIN 寄給對方</label>
        </div>
        <p class="dim" style="font-size:12.5px;margin:0 0 10px">對方用這組 PIN 第一次登入後，系統會要求改成自己的 PIN。沒有寄出的自動 PIN 只會在儲存後顯示一次，請自行轉交。</p>`}
        <p class="dim" style="font-size:12.5px;margin:0 0 10px">角色權限：${roleHelp}</p>
        <div class="row wrap" style="gap:18px">
          <label class="chk"><input type="checkbox" name="notify" ${u ? (u.notify ? 'checked' : '') : 'checked'}> 寄送 Email 通知</label>
          <label class="chk"><input type="checkbox" name="active" ${!u || u.active ? 'checked' : ''} ${self ? 'disabled' : ''}> 啟用</label>
        </div>`,
      okText: u ? '儲存' : '建立',
      onOpen: (m) => {
        const pinIn = $('[name=pin]', m), reset = $('[name=resetPin]', m), send = $('[name=sendPin]', m);
        if (pinIn && reset) pinIn.oninput = () => { if (pinIn.value) reset.checked = true; };
        if (reset && send) reset.onchange = () => { if (reset.checked && $('[name=email]', m).value.trim()) send.checked = true; };
      },
      onOk: async (m) => {
        const val = (n) => { const el = $(`[name=${n}]`, m); return el ? el.value : ''; };
        const chk = (n) => { const el = $(`[name=${n}]`, m); return !!(el && el.checked); };
        const resetPin = !u || chk('resetPin') || !!val('pin');
        const sendPin = chk('sendPin') && resetPin;
        if (sendPin && !val('email').trim()) throw new Error('要用 Email 寄送 PIN，請先填寫對方的 Email');
        const res = await RT.call('saveUser', {
          user: {
            isNew: !u, username: val('username'), displayName: val('displayName'), role: self ? u.role : val('role'), company: val('company'),
            email: val('email'), pin: val('pin'), resetPin: u ? chk('resetPin') : false, sendPin,
            notify: chk('notify'), active: self ? true : chk('active')
          }
        });
        route();
        if (res.mailed) RT.toast(`${u ? 'PIN 已重設' : '帳號已建立'}，PIN 已寄到 ${res.user.email}`, 'ok');
        else if (res.pin) {
          RT.modal({
            title: u ? 'PIN 已重設' : '帳號已建立',
            body: `${res.mailError ? `<p class="overdue" style="margin-top:0">Email 沒有寄出：${esc(res.mailError)}</p>` : ''}
              <p style="margin-top:0">請把下面的登入資訊轉交給 <b>${esc(res.user.displayName)}</b>。這組 PIN 只會顯示這一次，對方第一次登入後必須改成自己的 PIN。</p>
              <div class="card mono" style="padding:12px 14px;font-size:15px;line-height:1.8">帳號：${esc(res.user.username)}<br>PIN：<b>${esc(res.pin)}</b></div>`,
            okText: null, cancelText: '我已記下'
          });
        } else if (res.mailError) RT.toast('帳號已儲存，但 Email 沒有寄出：' + res.mailError, 'bad');
        else RT.toast('帳號已儲存', 'ok');
      }
    });
  }

  /* ================= 啟動 ================= */
  document.addEventListener('DOMContentLoaded', () => {
    document.title = cfg.SITE_NAME || 'Retake Notes';
    const { parts } = parseHash();
    if (!RT.session && parts[0] && parts[0] !== 'login' && parts[0] !== 's') sessionStorage.setItem('rt_after_login', location.hash);
    route();
    if (RT.session && !RT.isDemo) {
      RT.call('me').then((res) => {
        if (RT.isGuest()) return;
        const was = RT.needsPinChange();
        RT.updateUser(res.user);
        if (was !== RT.needsPinChange()) route();
      }).catch((e) => { if (e.code === 'AUTH') RT.logout(true); });
    }
  });
})();
