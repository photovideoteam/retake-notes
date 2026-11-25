/* 記住本機檔案（只存在這台電腦的瀏覽器）
 * - 影片：用 File System Access API 記住「檔案位置」（不複製影片），下次開啟一鍵或自動載入。
 *   支援 Chrome / Edge 桌機版；其他瀏覽器沿用每次重新選檔。
 * - 字幕：檔案很小，直接把文字存起來。 */
(function () {
  'use strict';
  var RT = window.RT = window.RT || {};
  var DB_NAME = 'rt_files', STORE = 'kv';
  var dbp = null;

  function db() {
    if (!dbp) {
      dbp = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
        var r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
      dbp.catch(function () { dbp = null; });
    }
    return dbp;
  }
  function run(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, mode), req = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(req ? req.result : undefined); };
        t.onerror = t.onabort = function () { reject(t.error); };
      });
    });
  }

  var FS = RT.fileStore = {
    /* 瀏覽器能不能記住檔案位置 */
    canRemember: typeof window.showOpenFilePicker === 'function' && typeof FileSystemFileHandle !== 'undefined' &&
      'queryPermission' in FileSystemFileHandle.prototype,
    get: function (key) { return run('readonly', function (s) { return s.get(key); }).catch(function () { return null; }); },
    set: function (key, val) { return run('readwrite', function (s) { return s.put(val, key); }).catch(function () { /* 私密視窗等情況無法儲存 */ }); },
    del: function (key) { return run('readwrite', function (s) { return s.delete(key); }).catch(function () { /* ignore */ }); },

    /* 開啟檔案選擇器，回傳 { file, handle }；使用者取消回傳 null */
    pickVideo: async function () {
      var last = await FS.get('lastVideo');
      var opts = { types: [{ description: '影片', accept: { 'video/*': ['.mp4', '.mov', '.m4v'] } }], excludeAcceptAllOption: false };
      if (last) opts.startIn = last; // 從上次的資料夾開始
      var handles;
      try { handles = await window.showOpenFilePicker(opts); }
      catch (e) {
        if (e.name === 'AbortError') return null;
        if (opts.startIn) { delete opts.startIn; handles = await window.showOpenFilePicker(opts); } // 上次的位置失效
        else throw e;
      }
      return { file: await handles[0].getFile(), handle: handles[0] };
    },

    /* 從記住的位置取得檔案。interactive=true 時可跳出權限詢問（必須在點擊事件中呼叫）
     * 回傳 File；沒有權限時丟出 code=PERM，檔案不見時 code=MISSING */
    fileFrom: async function (handle, interactive) {
      var opt = { mode: 'read' };
      var p = await handle.queryPermission(opt);
      if (p !== 'granted' && interactive) p = await handle.requestPermission(opt);
      if (p !== 'granted') { var e1 = new Error('需要你允許讀取這個檔案'); e1.code = 'PERM'; throw e1; }
      try { return await handle.getFile(); }
      catch (err) { var e2 = new Error('找不到上次的檔案，可能已被移動、改名或刪除'); e2.code = 'MISSING'; throw e2; }
    },

    remember: function (vid, handle) {
      if (!handle) return;
      FS.set('video:' + vid, handle);
      FS.set('lastVideo', handle);
    }
  };
})();
