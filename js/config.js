/* 網站設定 —— 部署 Apps Script 後，把網頁應用程式網址貼到 API_URL。
 * API_URL 留空 = 「試用模式」：資料只存在這台電腦的瀏覽器裡，方便先試用。 */
window.RT_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxCWfbXqYDS5Rw-Td5X8rCcJ3p0F6DQgqRA02M04OE2YJDd94FFLZLrzGcbx5c6Yqaa/exec',

  // 網站名稱（顯示在左上角與瀏覽器分頁）
  SITE_NAME: 'Retake Notes',

  // 選填：Google API 金鑰。有填的話，Google Drive 分享連結會改用 Drive API 串流，
  // 支援大檔案與逐格跳轉；沒填則使用一般下載連結（大於約 100MB 的檔案可能無法播放）。
  // 這把金鑰只能從 https://photovideoteam.github.io/* 使用、只能呼叫 Drive API
  // （Google Cloud 專案 retake-notes，帳號 acervideoteam）
  GOOGLE_API_KEY: 'AIzaSyBPVUTJ5AF-sp_NuCpYVO89syMV3jyLMtk',

  // 預設 fps（偵測不到時使用）
  DEFAULT_FPS: 24,

  // 審閱頁面自動更新註記的間隔（秒），0 = 不自動更新
  REFRESH_SECONDS: 30
};
