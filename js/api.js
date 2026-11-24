/* API 層：遠端 (Apps Script) 或試用模式 (localStorage + 同一份 core.js) */
(function () {
  'use strict';
  var RT = window.RT = window.RT || {};
  var cfg = window.RT_CONFIG || {};

  RT.isDemo = !cfg.API_URL;

  /* ---------------- 同步 SHA-256（試用模式用） ---------------- */
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var bytes = unescape(encodeURIComponent(ascii));
    var maxWord = Math.pow(2, 32), result = '', words = [], bitLen = bytes.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], pl = k.length;
    var composite = {};
    for (var cand = 2; pl < 64; cand++) {
      if (!composite[cand]) {
        for (var i = 0; i < 313; i += cand) composite[i] = cand;
        hash[pl] = (Math.pow(cand, .5) * maxWord) | 0;
        k[pl++] = (Math.pow(cand, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    bytes += '\x80';
    while (bytes.length % 64 - 56) bytes += '\x00';
    for (i = 0; i < bytes.length; i++) {
      var j = bytes.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLen / maxWord) | 0);
    words[words.length] = (bitLen);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
    return result;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  /* ---------------- 試用模式的資料庫 ---------------- */
  var DB_KEY = 'rt_demo_db';
  function localDb() {
    var data;
    try { data = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e) { data = null; }
    if (!data) data = {};
    Object.keys(RTCore.SCHEMA).forEach(function (t) { data[t] = data[t] || []; });
    function save() {
      try { localStorage.setItem(DB_KEY, JSON.stringify(data)); }
      catch (e) { throw new Error('瀏覽器儲存空間已滿（試用模式），請刪除部分資料或改用正式後端'); }
    }
    return {
      all: function (t) { return data[t]; },
      insert: function (t, obj) { data[t].push(obj); save(); },
      update: function (t, id, patch) {
        var row = data[t].filter(function (r) { return r.id === id; })[0];
        if (!row) throw new Error('找不到資料 ' + id);
        Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
        save();
      },
      remove: function (t, id) { data[t] = data[t].filter(function (r) { return r.id !== id; }); save(); }
    };
  }

  function localEnv() {
    return {
      db: localDb(),
      uuid: uuid,
      hash: sha256,
      cache: {
        get: function (k) {
          try {
            var v = JSON.parse(localStorage.getItem('rt_cache_' + k) || 'null');
            if (!v || v.exp < Date.now()) return null;
            return v.val;
          } catch (e) { return null; }
        },
        put: function (k, val, sec) { localStorage.setItem('rt_cache_' + k, JSON.stringify({ val: val, exp: Date.now() + sec * 1000 })); },
        remove: function (k) { localStorage.removeItem('rt_cache_' + k); }
      },
      files: {
        save: function (mime, b64) {
          var id = uuid();
          try { localStorage.setItem('rt_file_' + id, b64); }
          catch (e) { throw new Error('瀏覽器儲存空間已滿（試用模式），截圖無法儲存'); }
          return id;
        },
        get: function (ref) {
          var v = localStorage.getItem('rt_file_' + ref);
          if (v === null) throw new Error('missing');
          return v;
        }
      },
      mail: function (to, subject, body) { console.info('[試用模式 Email] →', to, '\n', subject, '\n', body); },
      siteUrl: location.href.replace(/#.*$/, '')
    };
  }

  function seedDemo(core, env) {
    if (env.db.all('Users').length) return;
    core.bootstrap('admin', '1234', '管理者');
    var adminToken = core.handle({ action: 'login', username: 'admin', pin: '1234' }).token;
    core.handle({ action: 'saveUser', token: adminToken, user: { username: 'studio_a', displayName: '動畫廠商 A', role: 'vendor', company: 'Studio A', pin: '5678', notify: true, email: 'vendor@example.com' } });
    core.handle({ action: 'saveProject', token: adminToken, project: { name: '範例專案：品牌形象短片', description: '試用模式的範例專案，可以自由修改或刪除。', members: ['studio_a'], status: '進行中', watermark: true } });
    core.handle({ action: 'logout', token: adminToken });
  }

  var localCore = null;
  function getLocalCore() {
    if (!localCore) {
      var env = localEnv();
      localCore = RTCore.create(env);
      seedDemo(localCore, env);
    }
    return localCore;
  }

  RT.resetDemo = function () {
    Object.keys(localStorage).forEach(function (k) { if (/^rt_(demo_db|cache_|file_)/.test(k)) localStorage.removeItem(k); });
    localCore = null;
  };

  /* ---------------- 呼叫 ---------------- */
  RT.call = function (action, data) {
    var req = Object.assign({}, data || {}, { action: action });
    if (RT.session && RT.session.token && !req.token) req.token = RT.session.token;
    if (RT.isDemo) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try { resolve(JSON.parse(JSON.stringify(getLocalCore().handle(req)))); }
          catch (e) { var er = new Error(e.message); er.code = e.code; reject(er); }
        }, 60);
      });
    }
    return fetch(cfg.API_URL, { method: 'POST', body: JSON.stringify(req), redirect: 'follow' })
      .then(function (r) {
        if (!r.ok) throw new Error('伺服器錯誤（' + r.status + '）');
        return r.json();
      })
      .then(function (res) {
        if (!res.ok) { var e = new Error(res.error || '發生錯誤'); e.code = res.code; throw e; }
        return res;
      }, function (e) {
        if (e.code) throw e;
        throw new Error(e.message && /fetch|network/i.test(e.message) ? '無法連線到伺服器，請檢查網路' : e.message);
      });
  };

  /* 檔案（截圖、附件）快取 */
  var fileCache = {};
  var pending = {};
  RT.getFiles = function (ids) {
    ids = (ids || []).filter(Boolean);
    var need = ids.filter(function (id) { return !(id in fileCache) && !pending[id]; });
    var waits = [];
    for (var i = 0; i < need.length; i += 20) {
      (function (chunk) {
        var p = RT.call('getFiles', { ids: chunk }).then(function (res) {
          chunk.forEach(function (id) { fileCache[id] = res.files[id] || null; delete pending[id]; });
        }, function () { chunk.forEach(function (id) { delete pending[id]; }); });
        chunk.forEach(function (id) { pending[id] = p; });
        waits.push(p);
      })(need.slice(i, i + 20));
    }
    ids.forEach(function (id) { if (pending[id] && waits.indexOf(pending[id]) < 0) waits.push(pending[id]); });
    return Promise.all(waits).then(function () {
      var out = {};
      ids.forEach(function (id) { out[id] = fileCache[id] || null; });
      return out;
    });
  };
  RT.putFileCache = function (id, dataUrl) { fileCache[id] = dataUrl; };
})();
