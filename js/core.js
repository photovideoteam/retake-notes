/* =====================================================================
 * Retake Notes — 共用核心邏輯 (core.js)
 * 同一份程式碼同時用在：
 *   1. 瀏覽器「試用模式」(資料存在 localStorage)
 *   2. Google Apps Script 後端 (複製到 Apps Script 的 Core.gs)
 * 儲存、雜湊、快取、檔案、寄信都由 env 提供，這裡只放商業邏輯。
 * ===================================================================== */
var RTCore = (function () {
  'use strict';

  /* ------------------------- 常數 ------------------------- */
  var NOTE_STATUS = ['待修改', '修改中', '已修改', '已確認', '不修改'];
  var NOTE_DONE = ['已確認', '不修改'];
  var VENDOR_NOTE_STATUS = ['待修改', '修改中', '已修改'];
  var VERSION_STATUS = ['審閱中', '需修改', '已核准'];
  var PROJECT_STATUS = ['進行中', '待審閱', '已完成', '暫停'];

  var SCHEMA = {
    Users: ['id', 'username', 'displayName', 'role', 'pinHash', 'salt', 'email', 'company', 'active', 'notify', 'createdAt'],
    Projects: ['id', 'name', 'description', 'members', 'status', 'dueDate', 'watermark', 'createdAt', 'createdBy', 'updatedAt'],
    Versions: ['id', 'projectId', 'label', 'sourceType', 'fileName', 'fileSize', 'url', 'fps', 'dropFrame', 'startTC',
      'durationFrames', 'width', 'height', 'status', 'createdAt', 'createdBy', 'remark'],
    Notes: ['id', 'projectId', 'versionId', 'inFrame', 'outFrame', 'text', 'drawing', 'pinX', 'pinY', 'thumbId', 'attachIds',
      'status', 'assignee', 'dueDate', 'internal', 'tags', 'mentions', 'author', 'createdAt', 'updatedAt', 'carriedFrom'],
    Replies: ['id', 'noteId', 'projectId', 'author', 'text', 'attachIds', 'statusChange', 'internal', 'createdAt'],
    Shares: ['id', 'projectId', 'versionId', 'label', 'canComment', 'expires', 'passHash', 'salt', 'createdBy', 'createdAt', 'active'],
    Files: ['id', 'projectId', 'name', 'mime', 'ref', 'createdAt', 'createdBy']
  };

  var SESSION_SECONDS = 6 * 3600;
  var MAX_FAIL = 5;
  var LOCK_SECONDS = 15 * 60;
  var MAX_CELL = 45000;

  var WRITE_ACTIONS = {
    login: 1, shareLogin: 1, logout: 1, changePin: 1, saveUser: 1, saveProject: 1, saveVersion: 1, deleteVersion: 1,
    saveNote: 1, deleteNote: 1, addReply: 1, deleteReply: 1, uploadFile: 1, saveShare: 1, revokeShare: 1
  };

  /* ------------------------- Timecode ------------------------- */
  var TC = {
    COMMON_FPS: [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 119.88, 120],
    isDFCapable: function (fps) {
      fps = Number(fps);
      return Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01;
    },
    nominal: function (fps) { return Math.round(Number(fps)) || 24; },
    exact: function (fps) {
      fps = Number(fps);
      var ntsc = [[23.976, 24000 / 1001], [29.97, 30000 / 1001], [47.952, 48000 / 1001], [59.94, 60000 / 1001], [119.88, 120000 / 1001]];
      for (var i = 0; i < ntsc.length; i++) if (Math.abs(fps - ntsc[i][0]) < 0.005) return ntsc[i][1];
      return fps;
    },
    snap: function (fps) {
      for (var i = 0; i < TC.COMMON_FPS.length; i++) {
        if (Math.abs(fps - TC.COMMON_FPS[i]) < 0.02) return TC.COMMON_FPS[i];
      }
      return Math.round(fps * 1000) / 1000;
    },
    pad: function (n) { return (n < 10 ? '0' : '') + n; },
    framesToTC: function (frames, fps, df) {
      frames = Math.max(0, Math.round(Number(frames) || 0));
      var nom = TC.nominal(fps);
      var useDF = df && TC.isDFCapable(fps);
      if (useDF) {
        var d = Math.round(Number(fps) * 0.066666);        // 2 或 4
        var per10 = Math.round(Number(fps) * 600);        // 17982 / 35964
        var perMin = nom * 60 - d;                        // 1798 / 3596
        var tenM = Math.floor(frames / per10), m = frames % per10;
        frames += d * 9 * tenM + (m > d ? d * Math.floor((m - d) / perMin) : 0);
      }
      var ff = frames % nom;
      var s = Math.floor(frames / nom) % 60;
      var mi = Math.floor(frames / (nom * 60)) % 60;
      var h = Math.floor(frames / (nom * 3600)) % 24;
      return TC.pad(h) + ':' + TC.pad(mi) + ':' + TC.pad(s) + (useDF ? ';' : ':') + TC.pad(ff);
    },
    tcToFrames: function (str, fps, df) {
      str = String(str || '').trim();
      var nom = TC.nominal(fps);
      if (/^\d+$/.test(str) && str.length <= 6) return parseInt(str, 10) * 1; // 純數字 = 格數
      var digits = str.replace(/[^\d]/g, '');
      if (!digits) return NaN;
      while (digits.length < 8) digits = '0' + digits;
      digits = digits.slice(-8);
      var h = +digits.slice(0, 2), m = +digits.slice(2, 4), s = +digits.slice(4, 6), f = +digits.slice(6, 8);
      if (m > 59 || s > 59 || f >= nom) return NaN;
      var total = ((h * 3600) + (m * 60) + s) * nom + f;
      if (df && TC.isDFCapable(fps)) {
        var d = Math.round(Number(fps) * 0.066666);
        var tm = h * 60 + m;
        total -= d * (tm - Math.floor(tm / 10));
      }
      return total;
    },
    parseTCLoose: function (str, fps, df) {
      // 接受 01:00:00:00 / 01000000 / 1:02:03 等
      return TC.tcToFrames(str, fps, df);
    }
  };

  /* ------------------------- 工具 ------------------------- */
  function err(msg, code) { var e = new Error(msg); e.code = code || ''; return e; }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function bool(v) { return v === true || v === 'TRUE' || v === 'true' || v === '1' || v === 1; }
  function num(v, d) { var n = Number(v); return isFinite(n) && v !== '' && v !== null && v !== undefined ? n : (d === undefined ? 0 : d); }
  function csv(v) { return str(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function parseTags(text) {
    var out = [], m, re = /#([\w一-鿿぀-ヿ-]{1,30})/g;
    while ((m = re.exec(text))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }
  function parseMentions(text) {
    var out = [], m, re = /@([A-Za-z0-9_.-]{2,32})/g;
    while ((m = re.exec(text))) { var u = m[1].toLowerCase(); if (out.indexOf(u) < 0) out.push(u); }
    return out;
  }

  /* ------------------------- 建立實例 ------------------------- */
  function create(env) {
    var db = env.db;

    function now() { return env.now ? env.now() : new Date().toISOString(); }
    function id(prefix) { return (prefix || '') + env.uuid().replace(/-/g, '').slice(0, 12); }
    function hashPin(pin, salt) { return env.hash(salt + ':' + pin); }

    function findBy(table, key, val) {
      var rows = db.all(table);
      for (var i = 0; i < rows.length; i++) if (rows[i][key] === val) return rows[i];
      return null;
    }
    function get(table, idv) { return findBy(table, 'id', str(idv)); }
    function insert(table, obj) {
      var row = {};
      SCHEMA[table].forEach(function (k) { row[k] = str(obj[k]); });
      db.insert(table, row);
      return row;
    }
    function update(table, idv, patch) {
      var p = {};
      Object.keys(patch).forEach(function (k) { if (SCHEMA[table].indexOf(k) >= 0 && k !== 'id') p[k] = str(patch[k]); });
      db.update(table, str(idv), p);
      return get(table, idv);
    }

    /* ---------- 使用者 / 權限 ---------- */
    function publicUser(u) {
      return {
        username: u.username, displayName: u.displayName || u.username, role: u.role, email: u.email,
        company: u.company, active: bool(u.active), notify: bool(u.notify), createdAt: u.createdAt
      };
    }
    function userName(username) {
      var u = get('Users', str(username).toLowerCase());
      return u ? (u.displayName || u.username) : str(username);
    }

    function auth(token) {
      if (!token) throw err('請先登入', 'AUTH');
      var raw = env.cache.get('s_' + token);
      if (!raw) throw err('登入已過期，請重新登入', 'AUTH');
      var s = JSON.parse(raw);
      if (s.t === 'guest') {
        var sh = get('Shares', s.share);
        if (!sh || !bool(sh.active) || (sh.expires && sh.expires < today())) throw err('分享連結已失效', 'AUTH');
        return { role: 'guest', username: 'guest:' + s.name, displayName: s.name + '（訪客）', share: sh, token: token };
      }
      var u = get('Users', s.u);
      if (!u || !bool(u.active)) throw err('帳號已停用', 'AUTH');
      return { role: u.role, username: u.username, displayName: u.displayName || u.username, user: u, token: token };
    }
    function requireAdmin(ctx) { if (ctx.role !== 'admin') throw err('只有管理者可以執行此動作', 'PERM'); }

    function canSeeProject(ctx, p) {
      if (!p) return false;
      if (ctx.role === 'admin') return true;
      if (ctx.role === 'guest') return ctx.share.projectId === p.id;
      return csv(p.members).map(function (s) { return s.toLowerCase(); }).indexOf(ctx.username.toLowerCase()) >= 0;
    }
    function canSeeVersion(ctx, v) {
      if (!v) return false;
      var p = get('Projects', v.projectId);
      if (!canSeeProject(ctx, p)) return false;
      if (ctx.role === 'guest' && ctx.share.versionId && ctx.share.versionId !== v.id) return false;
      return true;
    }
    function projectOrThrow(ctx, pid) {
      var p = get('Projects', pid);
      if (!canSeeProject(ctx, p)) throw err('找不到專案或沒有權限', 'PERM');
      return p;
    }
    function versionOrThrow(ctx, vid) {
      var v = get('Versions', vid);
      if (!canSeeVersion(ctx, v)) throw err('找不到版本或沒有權限', 'PERM');
      return v;
    }
    function canComment(ctx) { return ctx.role !== 'guest' || bool(ctx.share.canComment); }
    function seesInternal(ctx) { return ctx.role === 'admin'; }

    function peopleForProject(p) {
      var members = csv(p.members).map(function (s) { return s.toLowerCase(); });
      return db.all('Users').filter(function (u) {
        return bool(u.active) && (u.role === 'admin' || members.indexOf(u.id) >= 0);
      }).map(function (u) {
        return { username: u.username, displayName: u.displayName || u.username, role: u.role, company: u.company };
      });
    }

    /* ---------- 輸出格式 ---------- */
    function projectOut(p) {
      return {
        id: p.id, name: p.name, description: p.description, members: csv(p.members), status: p.status || '進行中',
        dueDate: p.dueDate, watermark: bool(p.watermark), createdAt: p.createdAt, createdBy: p.createdBy, updatedAt: p.updatedAt
      };
    }
    function versionOut(v) {
      return {
        id: v.id, projectId: v.projectId, label: v.label, sourceType: v.sourceType || 'local', fileName: v.fileName,
        fileSize: num(v.fileSize), url: v.url, fps: num(v.fps, 24), dropFrame: bool(v.dropFrame), startTC: v.startTC || '00:00:00:00',
        durationFrames: num(v.durationFrames), width: num(v.width), height: num(v.height), status: v.status || '審閱中',
        createdAt: v.createdAt, createdBy: v.createdBy, remark: v.remark
      };
    }
    function noteOut(n) {
      var drawing = null;
      if (n.drawing) { try { drawing = JSON.parse(n.drawing); } catch (e) { drawing = null; } }
      return {
        id: n.id, projectId: n.projectId, versionId: n.versionId, inFrame: num(n.inFrame), outFrame: num(n.outFrame, num(n.inFrame)),
        text: n.text, drawing: drawing, pinX: n.pinX === '' ? null : num(n.pinX), pinY: n.pinY === '' ? null : num(n.pinY),
        thumbId: n.thumbId, attachIds: csv(n.attachIds), status: n.status || '待修改', assignee: n.assignee, dueDate: n.dueDate,
        internal: bool(n.internal), tags: csv(n.tags), mentions: csv(n.mentions), author: n.author,
        authorName: authorName(n.author), createdAt: n.createdAt, updatedAt: n.updatedAt, carriedFrom: n.carriedFrom
      };
    }
    function replyOut(r) {
      return {
        id: r.id, noteId: r.noteId, author: r.author, authorName: authorName(r.author), text: r.text,
        attachIds: csv(r.attachIds), statusChange: r.statusChange, internal: bool(r.internal), createdAt: r.createdAt
      };
    }
    function authorName(a) {
      a = str(a);
      if (a.indexOf('guest:') === 0) return a.slice(6) + '（訪客）';
      return userName(a);
    }

    /* ---------- 檔案 ---------- */
    function saveFileData(ctx, projectId, dataUrl, name) {
      var m = /^data:([\w\/+.-]+);base64,(.+)$/.exec(str(dataUrl));
      if (!m) throw err('檔案格式錯誤');
      if (m[2].length > 8 * 1024 * 1024) throw err('檔案太大（上限約 6MB）');
      if (!/^image\//.test(m[1])) throw err('只接受圖片檔');
      var ref = env.files.save(m[1], m[2], str(name) || 'file');
      var f = insert('Files', { id: id('f'), projectId: projectId, name: name, mime: m[1], ref: ref, createdAt: now(), createdBy: ctx.username });
      return f.id;
    }
    function saveAttachments(ctx, projectId, list) {
      var ids = [];
      (list || []).slice(0, 6).forEach(function (a) { ids.push(saveFileData(ctx, projectId, a.dataUrl, a.name)); });
      return ids;
    }

    /* ---------- 通知 ---------- */
    function notify(toUsernames, subject, body, exceptUser) {
      if (!env.mail) return;
      var sent = {};
      toUsernames.forEach(function (un) {
        un = str(un).toLowerCase();
        if (!un || sent[un] || un === str(exceptUser).toLowerCase() || un.indexOf('guest:') === 0) return;
        var u = get('Users', un);
        if (!u || !bool(u.active) || !bool(u.notify) || !u.email) return;
        sent[un] = 1;
        try { env.mail(u.email, subject, body); } catch (e) { /* 寄信失敗不影響主要動作 */ }
      });
    }
    function admins() { return db.all('Users').filter(function (u) { return u.role === 'admin'; }).map(function (u) { return u.id; }); }
    function noteLabel(n, v) {
      return TC.framesToTC(TC.tcToFrames(v.startTC || '0', v.fps, bool(v.dropFrame)) + num(n.inFrame), num(v.fps, 24), bool(v.dropFrame));
    }
    function link(v) { return env.siteUrl ? env.siteUrl.replace(/#.*$/, '') + '#/r/' + v.id : ''; }

    /* =====================================================
     * Actions
     * ===================================================== */
    var A = {};

    A.ping = function () { return { message: 'Retake Notes API 運作中', time: now() }; };

    A.login = function (req) {
      var un = str(req.username).trim().toLowerCase();
      var pin = str(req.pin).trim();
      if (!un || !pin) throw err('請輸入帳號和 PIN');
      if (env.cache.get('lk_' + un)) throw err('錯誤次數過多，請 15 分鐘後再試');
      var u = get('Users', un);
      if (!u || !bool(u.active) || hashPin(pin, u.salt) !== u.pinHash) {
        var fails = num(env.cache.get('lf_' + un)) + 1;
        if (fails >= MAX_FAIL) {
          env.cache.put('lk_' + un, '1', LOCK_SECONDS);
          env.cache.remove('lf_' + un);
          throw err('錯誤次數過多，請 15 分鐘後再試');
        }
        env.cache.put('lf_' + un, String(fails), LOCK_SECONDS);
        throw err('帳號或 PIN 錯誤（還可以試 ' + (MAX_FAIL - fails) + ' 次）');
      }
      env.cache.remove('lf_' + un);
      var token = env.uuid() + env.uuid().slice(0, 8);
      env.cache.put('s_' + token, JSON.stringify({ t: 'user', u: u.id }), SESSION_SECONDS);
      return { token: token, user: publicUser(u) };
    };

    A.logout = function (req) { if (req.token) env.cache.remove('s_' + req.token); return {}; };

    A.me = function (req, ctx) {
      if (ctx.role === 'guest') {
        return { user: { username: ctx.username, displayName: ctx.displayName, role: 'guest' }, share: shareOut(ctx.share, true) };
      }
      return { user: publicUser(ctx.user) };
    };

    A.changePin = function (req, ctx) {
      if (ctx.role === 'guest') throw err('訪客無法變更 PIN');
      var u = ctx.user;
      if (hashPin(str(req.oldPin), u.salt) !== u.pinHash) throw err('目前的 PIN 不正確');
      validatePin(req.newPin);
      var salt = env.uuid().slice(0, 16);
      update('Users', u.id, { pinHash: hashPin(str(req.newPin), salt), salt: salt });
      return {};
    };

    function validatePin(pin) {
      if (!/^\d{4,12}$/.test(str(pin))) throw err('PIN 需為 4–12 位數字');
    }

    /* ---------- 使用者管理 ---------- */
    A.listUsers = function (req, ctx) {
      requireAdmin(ctx);
      return { users: db.all('Users').map(publicUser) };
    };

    A.saveUser = function (req, ctx) {
      requireAdmin(ctx);
      var d = req.user || {};
      var un = str(d.username).trim();
      if (!/^[A-Za-z0-9_.-]{2,32}$/.test(un)) throw err('帳號需為 2–32 個英數字（可含 _ . -）');
      var key = un.toLowerCase();
      var role = d.role === 'admin' ? 'admin' : 'vendor';
      var existing = get('Users', key);
      var patch = {
        username: existing ? existing.username : un, displayName: str(d.displayName).trim() || un, role: role,
        email: str(d.email).trim(), company: str(d.company).trim(), active: d.active === false ? '' : 'TRUE',
        notify: d.notify ? 'TRUE' : ''
      };
      if (existing) {
        if (existing.id === ctx.user.id && (role !== 'admin' || !patch.active)) throw err('不能停用自己或移除自己的管理者權限');
        if (d.pin) { validatePin(d.pin); patch.salt = env.uuid().slice(0, 16); patch.pinHash = hashPin(str(d.pin), patch.salt); }
        update('Users', key, patch);
      } else {
        validatePin(d.pin);
        patch.id = key; patch.salt = env.uuid().slice(0, 16); patch.pinHash = hashPin(str(d.pin), patch.salt); patch.createdAt = now();
        insert('Users', patch);
      }
      return { user: publicUser(get('Users', key)) };
    };

    /* ---------- 專案 ---------- */
    function stats(ctx, projectId, versionId) {
      var s = { total: 0, done: 0, overdue: 0, byStatus: {} };
      NOTE_STATUS.forEach(function (k) { s.byStatus[k] = 0; });
      var t = today();
      db.all('Notes').forEach(function (n) {
        if (n.projectId !== projectId) return;
        if (versionId && n.versionId !== versionId) return;
        if (bool(n.internal) && !seesInternal(ctx)) return;
        var st = n.status || '待修改';
        s.total++; s.byStatus[st] = (s.byStatus[st] || 0) + 1;
        if (NOTE_DONE.indexOf(st) >= 0) s.done++;
        else if (n.dueDate && n.dueDate < t) s.overdue++;
      });
      return s;
    }

    A.listProjects = function (req, ctx) {
      var versions = db.all('Versions');
      var list = db.all('Projects').filter(function (p) { return canSeeProject(ctx, p); }).map(function (p) {
        var o = projectOut(p);
        var vs = versions.filter(function (v) { return v.projectId === p.id && canSeeVersion(ctx, v); });
        vs.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
        o.versionCount = vs.length;
        o.latest = vs.length ? versionOut(vs[vs.length - 1]) : null;
        o.stats = stats(ctx, p.id);
        return o;
      });
      list.sort(function (a, b) { return (b.updatedAt || b.createdAt) < (a.updatedAt || a.createdAt) ? -1 : 1; });
      return { projects: list };
    };

    A.myTasks = function (req, ctx) {
      if (ctx.role === 'guest') return { tasks: [] };
      var me = ctx.username.toLowerCase();
      var tasks = [];
      db.all('Notes').forEach(function (n) {
        if (NOTE_DONE.indexOf(n.status) >= 0) return;
        if (str(n.assignee).toLowerCase() !== me && csv(n.mentions).indexOf(me) < 0) return;
        if (bool(n.internal) && !seesInternal(ctx)) return;
        var v = get('Versions', n.versionId);
        if (!canSeeVersion(ctx, v)) return;
        var p = get('Projects', n.projectId);
        var o = noteOut(n);
        o.drawing = null;
        o.projectName = p.name; o.versionLabel = v.label; o.tc = noteLabel(n, v);
        tasks.push(o);
      });
      tasks.sort(function (a, b) { return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1; });
      return { tasks: tasks.slice(0, 200) };
    };

    A.getProject = function (req, ctx) {
      var p = projectOrThrow(ctx, str(req.id));
      var vs = db.all('Versions').filter(function (v) { return v.projectId === p.id && canSeeVersion(ctx, v); });
      vs.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
      var out = {
        project: projectOut(p),
        versions: vs.map(function (v) { var o = versionOut(v); o.stats = stats(ctx, p.id, v.id); return o; }),
        people: peopleForProject(p),
        stats: stats(ctx, p.id)
      };
      if (ctx.role === 'admin') {
        out.shares = db.all('Shares').filter(function (s) { return s.projectId === p.id; }).map(function (s) { return shareOut(s); });
      }
      return out;
    };

    A.getReview = function (req, ctx) {
      var v = versionOrThrow(ctx, str(req.versionId));
      var out = A.getProject({ id: v.projectId }, ctx);
      out.versionId = v.id;
      out.notes = A.listNotes({ versionId: v.id }, ctx).notes;
      return out;
    };

    A.saveProject = function (req, ctx) {
      requireAdmin(ctx);
      var d = req.project || {};
      var name = str(d.name).trim();
      if (!name) throw err('請輸入專案名稱');
      var members = (Array.isArray(d.members) ? d.members : csv(d.members)).map(function (s) { return str(s).trim().toLowerCase(); }).filter(Boolean);
      var patch = {
        name: name, description: str(d.description), members: members.join(','),
        status: PROJECT_STATUS.indexOf(d.status) >= 0 ? d.status : '進行中', dueDate: str(d.dueDate),
        watermark: d.watermark ? 'TRUE' : '', updatedAt: now()
      };
      var p;
      if (d.id) {
        if (!get('Projects', d.id)) throw err('找不到專案');
        p = update('Projects', d.id, patch);
      } else {
        patch.id = id('p'); patch.createdAt = now(); patch.createdBy = ctx.username;
        p = insert('Projects', patch);
      }
      return { project: projectOut(p) };
    };

    function touchProject(pid) { if (get('Projects', pid)) update('Projects', pid, { updatedAt: now() }); }

    /* ---------- 版本 ---------- */
    A.saveVersion = function (req, ctx) {
      if (ctx.role === 'guest') throw err('訪客無法新增版本', 'PERM');
      var d = req.version || {};
      var patch = {};
      ['label', 'sourceType', 'fileName', 'fileSize', 'url', 'fps', 'startTC', 'durationFrames', 'width', 'height', 'remark'].forEach(function (k) {
        if (d[k] !== undefined) patch[k] = str(d[k]);
      });
      if (d.dropFrame !== undefined) patch.dropFrame = d.dropFrame ? 'TRUE' : '';
      if (patch.sourceType && ['local', 'url'].indexOf(patch.sourceType) < 0) patch.sourceType = 'local';
      if (d.status !== undefined) {
        if (VERSION_STATUS.indexOf(d.status) < 0) throw err('版本狀態不正確');
        if (d.status === '已核准' && ctx.role !== 'admin') throw err('只有管理者可以核准版本', 'PERM');
        patch.status = d.status;
      }
      if (patch.url && !/^https:\/\//i.test(patch.url) && !/^[\w.\/-]+$/.test(patch.url)) throw err('雲端連結需為 https:// 開頭');
      var v;
      if (d.id) {
        v = versionOrThrow(ctx, d.id);
        v = update('Versions', v.id, patch);
      } else {
        var p = projectOrThrow(ctx, str(d.projectId));
        var count = db.all('Versions').filter(function (x) { return x.projectId === p.id; }).length;
        patch.id = id('v'); patch.projectId = p.id; patch.createdAt = now(); patch.createdBy = ctx.username;
        patch.label = patch.label || ('v' + (count + 1));
        patch.status = patch.status || '審閱中';
        patch.fps = patch.fps || '24';
        patch.startTC = patch.startTC || '00:00:00:00';
        v = insert('Versions', patch);
        var carried = 0;
        var carryFrom = req.carryFrom || d.carryFrom;
        if (carryFrom) {
          var src = versionOrThrow(ctx, str(carryFrom));
          db.all('Notes').filter(function (n) { return n.versionId === src.id && NOTE_DONE.indexOf(n.status) < 0; }).forEach(function (n) {
            if (bool(n.internal) && !seesInternal(ctx)) return;
            var copy = {};
            SCHEMA.Notes.forEach(function (k) { copy[k] = n[k]; });
            copy.id = id('n'); copy.versionId = v.id; copy.createdAt = now(); copy.updatedAt = now();
            copy.carriedFrom = src.label + ':' + n.id;
            insert('Notes', copy);
            carried++;
          });
        }
        touchProject(p.id);
        notify(csv(p.members).concat(admins()), '[Retake] ' + p.name + ' 新版本 ' + v.label,
          ctx.displayName + ' 新增了版本 ' + v.label + (carried ? '（沿用 ' + carried + ' 則未解決註記）' : '') + '\n' + link(v), ctx.username);
        var o = versionOut(v); o.carried = carried;
        return { version: o };
      }
      touchProject(v.projectId);
      return { version: versionOut(v) };
    };

    A.deleteVersion = function (req, ctx) {
      requireAdmin(ctx);
      var v = versionOrThrow(ctx, str(req.id));
      db.all('Notes').filter(function (n) { return n.versionId === v.id; }).forEach(function (n) { removeNote(n); });
      db.remove('Versions', v.id);
      return {};
    };

    /* ---------- 註記 ---------- */
    A.listNotes = function (req, ctx) {
      var vids = {};
      if (req.versionId) { var v = versionOrThrow(ctx, str(req.versionId)); vids[v.id] = v; }
      else {
        var p = projectOrThrow(ctx, str(req.projectId));
        db.all('Versions').forEach(function (x) { if (x.projectId === p.id && canSeeVersion(ctx, x)) vids[x.id] = x; });
      }
      var notes = db.all('Notes').filter(function (n) { return vids[n.versionId] && (!bool(n.internal) || seesInternal(ctx)); });
      var noteIds = {};
      notes.forEach(function (n) { noteIds[n.id] = 1; });
      var replies = db.all('Replies').filter(function (r) { return noteIds[r.noteId] && (!bool(r.internal) || seesInternal(ctx)); });
      replies.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
      var byNote = {};
      replies.forEach(function (r) { (byNote[r.noteId] = byNote[r.noteId] || []).push(replyOut(r)); });
      var out = notes.map(function (n) { var o = noteOut(n); o.replies = byNote[n.id] || []; return o; });
      out.sort(function (a, b) { return a.inFrame - b.inFrame || (a.createdAt < b.createdAt ? -1 : 1); });
      return { notes: out };
    };

    function cleanDrawing(drawing) {
      if (!drawing) return '';
      var s = typeof drawing === 'string' ? drawing : JSON.stringify(drawing);
      if (s.length > MAX_CELL) throw err('畫記太複雜，請簡化後再送出');
      return s === '[]' ? '' : s;
    }

    A.saveNote = function (req, ctx) {
      var d = req.note || {};
      var n, v, p, statusBefore = null;
      if (d.id) {
        n = get('Notes', str(d.id));
        if (!n) throw err('找不到註記');
        v = versionOrThrow(ctx, n.versionId);
        if (bool(n.internal) && !seesInternal(ctx)) throw err('找不到註記');
        p = get('Projects', v.projectId);
        var isAuthor = n.author === ctx.username;
        var patch = { updatedAt: now() };
        var contentKeys = ['inFrame', 'outFrame', 'text', 'pinX', 'pinY'];
        var touchesContent = contentKeys.some(function (k) { return d[k] !== undefined; }) || d.drawing !== undefined;
        if (touchesContent) {
          if (!(isAuthor || ctx.role === 'admin')) throw err('只有作者或管理者可以修改內容', 'PERM');
          contentKeys.forEach(function (k) { if (d[k] !== undefined) patch[k] = d[k] === null ? '' : d[k]; });
          if (d.drawing !== undefined) patch.drawing = cleanDrawing(d.drawing);
          if (d.text !== undefined) {
            patch.tags = parseTags(d.text).join(',');
            patch.mentions = validMentions(parseMentions(d.text), p).join(',');
          }
        }
        if (d.assignee !== undefined || d.dueDate !== undefined) {
          if (ctx.role === 'guest') throw err('訪客無法指派', 'PERM');
          if (d.assignee !== undefined) patch.assignee = str(d.assignee).toLowerCase();
          if (d.dueDate !== undefined) patch.dueDate = str(d.dueDate);
        }
        if (d.internal !== undefined) {
          if (ctx.role !== 'admin') throw err('只有管理者可以設定內部註記', 'PERM');
          patch.internal = d.internal ? 'TRUE' : '';
        }
        if (d.status !== undefined && d.status !== n.status) {
          checkStatus(ctx, d.status);
          statusBefore = n.status || '待修改';
          patch.status = d.status;
        }
        n = update('Notes', n.id, patch);
        if (statusBefore !== null) {
          insert('Replies', {
            id: id('r'), noteId: n.id, projectId: n.projectId, author: ctx.username, text: str(d.statusComment),
            statusChange: statusBefore + '→' + n.status, internal: '', createdAt: now()
          });
          notify(admins().concat([n.author, n.assignee]), '[Retake] ' + p.name + ' ' + v.label + ' ' + noteLabel(n, v) + ' 狀態：' + n.status,
            ctx.displayName + ' 將註記狀態改為「' + n.status + '」\n\n' + n.text + '\n' + link(v), ctx.username);
        }
        if (patch.assignee && patch.assignee !== ctx.username.toLowerCase()) {
          notify([patch.assignee], '[Retake] 你被指派了一則註記：' + p.name + ' ' + v.label + ' ' + noteLabel(n, v), n.text + '\n' + link(v), ctx.username);
        }
      } else {
        v = versionOrThrow(ctx, str(d.versionId));
        p = get('Projects', v.projectId);
        if (!canComment(ctx)) throw err('此分享連結不能留言', 'PERM');
        var text = str(d.text).trim();
        if (!text && !d.drawing) throw err('請輸入註記內容或畫記');
        if (d.status && d.status !== '待修改') checkStatus(ctx, d.status);
        var internal = d.internal && ctx.role === 'admin';
        var inF = Math.max(0, Math.round(num(d.inFrame)));
        var outF = Math.max(inF, Math.round(num(d.outFrame, inF)));
        var row = {
          id: id('n'), projectId: v.projectId, versionId: v.id, inFrame: inF, outFrame: outF, text: text,
          drawing: cleanDrawing(d.drawing), pinX: d.pinX === null || d.pinX === undefined ? '' : d.pinX,
          pinY: d.pinY === null || d.pinY === undefined ? '' : d.pinY, status: d.status || '待修改',
          assignee: ctx.role === 'guest' ? '' : str(d.assignee).toLowerCase(), dueDate: ctx.role === 'guest' ? '' : str(d.dueDate),
          internal: internal ? 'TRUE' : '', tags: parseTags(text).join(','),
          mentions: validMentions(parseMentions(text), p).join(','), author: ctx.username, createdAt: now(), updatedAt: now()
        };
        if (d.thumbData) row.thumbId = saveFileData(ctx, v.projectId, d.thumbData, 'thumb.jpg');
        row.attachIds = saveAttachments(ctx, v.projectId, d.attachData).join(',');
        n = insert('Notes', row);
        touchProject(p.id);
        var tc = noteLabel(n, v);
        var body = ctx.displayName + ' 在 ' + p.name + ' ' + v.label + ' @ ' + tc + ' 留下註記：\n\n' + text + '\n\n' + link(v);
        if (!internal) notify(csv(p.members).concat(admins()), '[Retake] ' + p.name + ' ' + v.label + ' 新註記 ' + tc, body, ctx.username);
        notify(csv(n.mentions).concat(n.assignee ? [n.assignee] : []).filter(function (u) {
          return !internal || (get('Users', u) || {}).role === 'admin';
        }), '[Retake] 有人在註記中提到你：' + p.name + ' ' + tc, body, ctx.username);
      }
      var o = noteOut(n);
      o.replies = db.all('Replies').filter(function (r) { return r.noteId === n.id && (!bool(r.internal) || seesInternal(ctx)); })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; }).map(replyOut);
      return { note: o };
    };

    function checkStatus(ctx, st) {
      if (NOTE_STATUS.indexOf(st) < 0) throw err('狀態不正確');
      if (ctx.role === 'guest') throw err('訪客無法變更狀態', 'PERM');
      if (ctx.role !== 'admin' && VENDOR_NOTE_STATUS.indexOf(st) < 0) throw err('「' + st + '」只有管理者可以設定', 'PERM');
    }
    function validMentions(list, p) {
      var people = peopleForProject(p).map(function (x) { return x.username.toLowerCase(); });
      return list.filter(function (u) { return people.indexOf(u) >= 0; });
    }

    function removeNote(n) {
      db.all('Replies').filter(function (r) { return r.noteId === n.id; }).forEach(function (r) { db.remove('Replies', r.id); });
      db.remove('Notes', n.id);
    }

    A.deleteNote = function (req, ctx) {
      var n = get('Notes', str(req.id));
      if (!n) throw err('找不到註記');
      versionOrThrow(ctx, n.versionId);
      if (!(ctx.role === 'admin' || n.author === ctx.username)) throw err('只有作者或管理者可以刪除', 'PERM');
      removeNote(n);
      return {};
    };

    A.addReply = function (req, ctx) {
      var n = get('Notes', str(req.noteId));
      if (!n) throw err('找不到註記');
      var v = versionOrThrow(ctx, n.versionId);
      if (bool(n.internal) && !seesInternal(ctx)) throw err('找不到註記');
      if (!canComment(ctx)) throw err('此分享連結不能留言', 'PERM');
      var p = get('Projects', v.projectId);
      var text = str(req.text).trim();
      var change = '';
      if (req.status && req.status !== n.status) {
        checkStatus(ctx, req.status);
        change = (n.status || '待修改') + '→' + req.status;
        update('Notes', n.id, { status: req.status, updatedAt: now() });
      }
      var attach = saveAttachments(ctx, n.projectId, req.attachData);
      if (!text && !change && !attach.length) throw err('請輸入回覆內容');
      var internal = req.internal && ctx.role === 'admin';
      var r = insert('Replies', {
        id: id('r'), noteId: n.id, projectId: n.projectId, author: ctx.username, text: text, attachIds: attach.join(','),
        statusChange: change, internal: internal ? 'TRUE' : '', createdAt: now()
      });
      update('Notes', n.id, { updatedAt: now() });
      touchProject(p.id);
      var tc = noteLabel(n, v);
      var to = [n.author, n.assignee].concat(admins()).concat(validMentions(parseMentions(text), p));
      if (internal) to = to.filter(function (u) { return (get('Users', str(u).toLowerCase()) || {}).role === 'admin'; });
      notify(to, '[Retake] ' + p.name + ' ' + v.label + ' ' + tc + ' 新回覆' + (change ? '（' + req.status + '）' : ''),
        ctx.displayName + '：' + text + (change ? '\n狀態：' + change : '') + '\n\n原註記：' + n.text + '\n' + link(v), ctx.username);
      var o = noteOut(get('Notes', n.id));
      o.replies = db.all('Replies').filter(function (x) { return x.noteId === n.id && (!bool(x.internal) || seesInternal(ctx)); })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; }).map(replyOut);
      return { reply: replyOut(r), note: o };
    };

    A.deleteReply = function (req, ctx) {
      var r = get('Replies', str(req.id));
      if (!r) throw err('找不到回覆');
      var n = get('Notes', r.noteId);
      if (n) versionOrThrow(ctx, n.versionId);
      if (!(ctx.role === 'admin' || r.author === ctx.username)) throw err('只有作者或管理者可以刪除', 'PERM');
      db.remove('Replies', r.id);
      return {};
    };

    /* ---------- 檔案 ---------- */
    A.uploadFile = function (req, ctx) {
      var p = projectOrThrow(ctx, str(req.projectId));
      if (!canComment(ctx)) throw err('沒有上傳權限', 'PERM');
      return { id: saveFileData(ctx, p.id, req.dataUrl, req.name) };
    };

    A.getFiles = function (req, ctx) {
      var out = {};
      (req.ids || []).slice(0, 40).forEach(function (fid) {
        var f = get('Files', str(fid));
        if (!f) return;
        var p = get('Projects', f.projectId);
        if (!canSeeProject(ctx, p)) return;
        try { out[f.id] = 'data:' + f.mime + ';base64,' + env.files.get(f.ref); } catch (e) { /* 檔案遺失 */ }
      });
      return { files: out };
    };

    /* ---------- 分享連結 ---------- */
    function shareOut(s, forGuest) {
      var o = {
        id: s.id, projectId: s.projectId, versionId: s.versionId, label: s.label, canComment: bool(s.canComment),
        expires: s.expires, hasPass: !!s.passHash, active: bool(s.active)
      };
      if (!forGuest) { o.createdBy = s.createdBy; o.createdAt = s.createdAt; }
      return o;
    }

    A.saveShare = function (req, ctx) {
      requireAdmin(ctx);
      var d = req.share || {};
      var p = projectOrThrow(ctx, str(d.projectId));
      if (d.versionId) { var v = versionOrThrow(ctx, str(d.versionId)); if (v.projectId !== p.id) throw err('版本不屬於此專案'); }
      var row = {
        id: (env.uuid() + env.uuid()).replace(/-/g, '').slice(0, 24), projectId: p.id, versionId: str(d.versionId),
        label: str(d.label) || p.name, canComment: d.canComment ? 'TRUE' : '', expires: str(d.expires),
        createdBy: ctx.username, createdAt: now(), active: 'TRUE'
      };
      if (d.pass) { row.salt = env.uuid().slice(0, 16); row.passHash = hashPin(str(d.pass), row.salt); }
      insert('Shares', row);
      return { share: shareOut(get('Shares', row.id)) };
    };

    A.revokeShare = function (req, ctx) {
      requireAdmin(ctx);
      var s = get('Shares', str(req.id));
      if (!s) throw err('找不到分享連結');
      update('Shares', s.id, { active: '' });
      return {};
    };

    A.shareInfo = function (req) {
      var s = get('Shares', str(req.id));
      if (!s || !bool(s.active) || (s.expires && s.expires < today())) throw err('分享連結無效或已過期');
      var p = get('Projects', s.projectId);
      return { share: shareOut(s, true), projectName: p ? p.name : '' };
    };

    A.shareLogin = function (req) {
      var s = get('Shares', str(req.id));
      if (!s || !bool(s.active) || (s.expires && s.expires < today())) throw err('分享連結無效或已過期');
      var name = str(req.name).trim().slice(0, 30);
      if (!name) throw err('請輸入你的名字');
      var key = 'sh_' + s.id + '_' + (env.clientKey || '');
      if (s.passHash) {
        if (env.cache.get('lk_' + key)) throw err('錯誤次數過多，請 15 分鐘後再試');
        if (hashPin(str(req.pass), s.salt) !== s.passHash) {
          var fails = num(env.cache.get('lf_' + key)) + 1;
          env.cache.put('lf_' + key, String(fails), LOCK_SECONDS);
          if (fails >= MAX_FAIL * 2) env.cache.put('lk_' + key, '1', LOCK_SECONDS);
          throw err('密碼錯誤');
        }
      }
      var token = env.uuid() + env.uuid().slice(0, 8);
      env.cache.put('s_' + token, JSON.stringify({ t: 'guest', share: s.id, name: name }), SESSION_SECONDS);
      return { token: token, user: { username: 'guest:' + name, displayName: name + '（訪客）', role: 'guest' }, share: shareOut(s, true) };
    };

    /* ---------- 入口 ---------- */
    var PUBLIC = { ping: 1, login: 1, shareInfo: 1, shareLogin: 1, logout: 1 };

    function handle(req) {
      req = req || {};
      var fn = A[req.action];
      if (!fn) throw err('未知的動作：' + req.action);
      var run = function () {
        if (PUBLIC[req.action]) return fn(req, null);
        return fn(req, auth(req.token));
      };
      if (WRITE_ACTIONS[req.action] && env.withLock) return env.withLock(run);
      return run();
    }

    function bootstrap(username, pin, displayName) {
      if (db.all('Users').some(function (u) { return u.role === 'admin'; })) return false;
      var salt = env.uuid().slice(0, 16);
      insert('Users', {
        id: username.toLowerCase(), username: username, displayName: displayName || username, role: 'admin',
        pinHash: hashPin(pin, salt), salt: salt, active: 'TRUE', notify: '', createdAt: now()
      });
      return true;
    }

    return { handle: handle, bootstrap: bootstrap };
  }

  return {
    create: create, SCHEMA: SCHEMA, TC: TC, NOTE_STATUS: NOTE_STATUS, NOTE_DONE: NOTE_DONE,
    VENDOR_NOTE_STATUS: VENDOR_NOTE_STATUS, VERSION_STATUS: VERSION_STATUS, PROJECT_STATUS: PROJECT_STATUS
  };
})();
