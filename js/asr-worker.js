/* 語音辨識背景程式（Web Worker）：Whisper 模型在這台電腦上執行，聲音不會上傳 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true; // 模型下載一次後留在瀏覽器快取
try { env.backends.onnx.logLevel = 'error'; } catch (e) { /* 舊版沒有這個設定 */ }

let asr = null;
let loadedKey = '';

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const key = m.model + '|' + m.device + '|' + JSON.stringify(m.dtype);
      if (asr && loadedKey === key) { self.postMessage({ type: 'ready', cached: true }); return; }
      if (asr && asr.dispose) { try { await asr.dispose(); } catch (err) { /* ignore */ } }
      asr = null; loadedKey = '';
      const files = {};
      asr = await pipeline('automatic-speech-recognition', m.model, {
        device: m.device,
        dtype: m.dtype,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file && p.total) {
            files[p.file] = { loaded: p.loaded, total: p.total };
            let loaded = 0, total = 0;
            Object.keys(files).forEach((k) => { loaded += files[k].loaded; total += files[k].total; });
            self.postMessage({ type: 'download', loaded, total });
          }
        }
      });
      loadedKey = key;
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'run') {
      if (!asr) throw new Error('模型尚未載入');
      const opts = { task: 'transcribe', return_timestamps: true };
      if (m.language) opts.language = m.language;
      const out = await asr(m.audio, opts);
      self.postMessage({ type: 'result', id: m.id, text: out.text || '', chunks: (out.chunks || []).map((c) => ({ ts: c.timestamp, text: c.text })) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
