const $ = (sel) => document.querySelector(sel);

const els = {
  filters: $('#filters'),
  sentenceList: $('#sentenceList'),
  sentenceCount: $('#sentenceCount'),
  catChip: $('#catChip'),
  sentenceEn: $('#sentenceEn'),
  sentenceZh: $('#sentenceZh'),
  btnRef: $('#btnRef'),
  btnRecord: $('#btnRecord'),
  btnStop: $('#btnStop'),
  btnMine: $('#btnMine'),
  btnAB: $('#btnAB'),
  btnFolder: $('#btnFolder'),
  btnImport: $('#btnImport'),
  btnDeleteSentence: $('#btnDeleteSentence'),
  importModal: $('#importModal'),
  importTitle: $('#importTitle'),
  importText: $('#importText'),
  btnPickFile: $('#btnPickFile'),
  btnDoImport: $('#btnDoImport'),
  btnCancelImport: $('#btnCancelImport'),
  btnCloseImport: $('#btnCloseImport'),
  speedGroup: $('#speedGroup'),
  timer: $('#timer'),
  hint: $('#hint'),
  wave: $('#wave'),
  compareCard: $('#compareCard'),
  compareText: $('#compareText'),
  compareMeta: $('#compareMeta'),
  compareActions: $('#compareActions'),
  recordList: $('#recordList'),
  recordCount: $('#recordCount'),
};

const state = {
  sentences: [],
  filter: '全部',
  current: null,
  rate: 0.85,
  recordings: [],
  audioEl: null,
  recording: false,
  recStart: 0,
  timerId: null,
  recorder: null,
  stream: null,
  audioCtx: null,
  analyser: null,
  raf: null,
  levels: new Float32Array(96),
  lastRecording: null,
  playingRecordId: null,
};

const api = () => (window.go && window.go.main && window.go.main.App) || null;

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */
async function init() {
  bindEvents();
  setupCanvas();

  if (!api()) {
    hint('未能连接到本地服务，请通过 Wails 启动应用。', 'error');
    return;
  }

  try {
    state.sentences = await api().ListSentences();
  } catch (err) {
    hint('加载句子库失败：' + err, 'error');
    return;
  }

  renderFilters();
  renderSentenceList();
  if (state.sentences.length) selectSentence(state.sentences[0]);
  await refreshRecordings();
  primeVoices();
}

function bindEvents() {
  els.btnRef.addEventListener('click', speakReference);

  els.btnRecord.addEventListener('click', startRecording);
  els.btnStop.addEventListener('click', stopRecording);
  els.btnMine.addEventListener('click', () => {
    if (state.lastRecording) playRecord(state.lastRecording);
  });
  els.btnAB.addEventListener('click', () => {
    if (state.lastRecording) compareRecord(state.lastRecording);
  });
  els.btnFolder.addEventListener('click', async () => {
    try {
      await api().OpenRecordingsFolder();
    } catch (err) {
      hint('打开目录失败：' + err, 'error');
    }
  });

  els.btnImport.addEventListener('click', openImportModal);
  els.btnCloseImport.addEventListener('click', closeImportModal);
  els.btnCancelImport.addEventListener('click', closeImportModal);
  els.btnPickFile.addEventListener('click', importFromFile);
  els.btnDoImport.addEventListener('click', importFromText);
  els.btnDeleteSentence.addEventListener('click', deleteCurrentImported);
  els.importModal.addEventListener('click', (e) => {
    if (e.target === els.importModal) closeImportModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.importModal.hidden) closeImportModal();
  });

  els.speedGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.speed-btn');
    if (!btn) return;
    state.rate = Number(btn.dataset.rate);
    [...els.speedGroup.querySelectorAll('.speed-btn')].forEach((b) =>
      b.classList.toggle('active', b === btn)
    );
  });

  window.addEventListener('beforeunload', () => {
    if (state.recording) stopRecording();
  });
}

/* ------------------------------------------------------------------ */
/* 句子库                                                              */
/* ------------------------------------------------------------------ */
const LEVELS = ['全部', 'B1', 'B2', 'C1', '导入'];

function filteredSentences() {
  return state.sentences.filter((s) => state.filter === '全部' || s.level === state.filter);
}

function levelClass(level) {
  if (level === 'B1') return 'lv lv-b1';
  if (level === 'B2') return 'lv lv-b2';
  if (level === 'C1') return 'lv lv-c1';
  return 'lv lv-imp';
}

function renderFilters() {
  els.filters.innerHTML = '';
  LEVELS.forEach((level) => {
    const count = state.sentences.filter((s) => level === '全部' || s.level === level).length;
    if (level === '导入' && count === 0) return;
    const btn = document.createElement('button');
    btn.className = 'filter' + (level === state.filter ? ' active' : '');
    btn.textContent = level === '全部' ? '全部' : `${level} ${count}`;
    btn.addEventListener('click', () => {
      state.filter = level;
      renderFilters();
      renderSentenceList();
      const list = filteredSentences();
      if (list.length && (!state.current || !list.some((s) => s.id === state.current.id))) {
        selectSentence(list[0]);
      }
    });
    els.filters.appendChild(btn);
  });
}

function renderSentenceList() {
  const list = filteredSentences();
  els.sentenceList.innerHTML = '';
  els.sentenceCount.textContent = list.length + ' 句';

  list.forEach((s, i) => {
    const done = state.recordings.some((r) => r.sentenceId === s.id);
    const item = document.createElement('div');
    item.className = 'sentence-item' + (state.current && state.current.id === s.id ? ' active' : '');
    item.innerHTML = `
      <span class="idx">${String(i + 1).padStart(2, '0')}</span>
      <span class="txt"></span>
      <span class="meta">
        ${done ? '<span class="done" title="已练习">✓</span>' : ''}
        <span class="${levelClass(s.level)}">${s.level}</span>
      </span>
    `;
    item.querySelector('.txt').textContent = s.text;
    item.addEventListener('click', () => selectSentence(s));
    els.sentenceList.appendChild(item);
  });
}

function selectSentence(sentence) {
  stopAllPlayback();
  state.current = sentence;
  els.catChip.textContent = `${sentence.level} · ${sentence.category}`;
  els.btnDeleteSentence.hidden = !sentence.imported;
  appendWordSpans(els.sentenceEn, sentence.text);
  els.sentenceZh.textContent = sentence.translation || '（无对照译文）';
  els.compareText.textContent = sentence.text;
  els.compareMeta.textContent = '原文';
  els.compareActions.innerHTML = '';
  state.lastRecording =
    state.recordings.find((r) => r.sentenceId === sentence.id) || null;
  els.timer.textContent = '00:00.0';
  hint('点击「听原音」熟悉发音，再点「开始录音」跟读');
  syncUI();
  renderSentenceList();
}

/* ------------------------------------------------------------------ */
/* 材料导入                                                            */
/* ------------------------------------------------------------------ */
function openImportModal() {
  els.importModal.hidden = false;
  els.importTitle.value = '';
  els.importText.value = '';
  els.importText.focus();
}

function closeImportModal() {
  els.importModal.hidden = true;
}

async function importFromFile() {
  try {
    const res = await api().ImportFromFile();
    if (!res || !res.title) return; // 用户取消
    await afterImport(res);
  } catch (err) {
    hint('导入失败：' + err, 'error');
  }
}

async function importFromText() {
  const content = els.importText.value.trim();
  if (!content) {
    hint('请先粘贴要导入的材料', 'warn');
    return;
  }
  try {
    const res = await api().ImportFromText(els.importTitle.value.trim(), content);
    await afterImport(res);
  } catch (err) {
    hint('导入失败：' + err, 'error');
  }
}

async function afterImport(res) {
  closeImportModal();
  if (!res.added) {
    hint(`没有新增材料：${res.skipped} 句与已有内容重复或为空`, 'warn');
    return;
  }
  state.filter = '导入';
  await reloadSentences(true);
  const skipped = res.skipped ? `，跳过 ${res.skipped} 句重复内容` : '';
  hint(`已从「${res.title}」导入 ${res.added} 句${skipped}`);
}

async function reloadSentences(selectFirst = false) {
  try {
    state.sentences = await api().ListSentences();
  } catch (err) {
    hint('刷新材料失败：' + err, 'error');
    return;
  }
  renderFilters();
  renderSentenceList();

  if (selectFirst) {
    const list = filteredSentences();
    if (list.length) selectSentence(list[0]);
  } else if (state.current) {
    const found = state.sentences.find((s) => s.id === state.current.id);
    if (found) {
      state.current = found;
      syncUI();
    }
  }
}

async function deleteCurrentImported() {
  const target = state.current;
  if (!target || !target.imported) return;
  if (!confirm('删除这条导入材料？（已录的音不会被删除）')) return;

  try {
    await api().DeleteImportedSentence(target.id);
    state.current = null;
    await reloadSentences(false);
    if (state.filter === '导入' && !filteredSentences().length) {
      state.filter = '全部';
      renderFilters();
      renderSentenceList();
    }
    const next = filteredSentences()[0];
    if (next) {
      selectSentence(next);
    } else {
      els.sentenceEn.textContent = '暂无材料';
      els.sentenceZh.textContent = '';
      els.catChip.textContent = '—';
      els.btnDeleteSentence.hidden = true;
      syncUI();
    }
    hint('已删除该导入材料');
  } catch (err) {
    hint('删除失败：' + err, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* 原音朗读（系统 TTS）                                                 */
/* ------------------------------------------------------------------ */
let voices = [];

function primeVoices() {
  if (!('speechSynthesis' in window)) return;
  const load = () => {
    voices = window.speechSynthesis.getVoices() || [];
  };
  load();
  window.speechSynthesis.addEventListener('voiceschanged', load);
}

function pickVoice() {
  if (!voices.length && 'speechSynthesis' in window) {
    voices = window.speechSynthesis.getVoices() || [];
  }
  const en = voices.filter((v) => /^en/i.test(v.lang));
  if (!en.length) return null;
  const preferred = en.find((v) => /natural|aria|jenny|guy|zira|google us/i.test(v.name));
  return preferred || en[0];
}

// 把文本拆成带 offset 的逐词 span 并写入容器，便于朗读时逐词高亮
function appendWordSpans(container, text) {
  container.innerHTML = '';
  const parts = text.split(/(\s+)/);
  let offset = 0;
  parts.forEach((part) => {
    if (/^\s+$/.test(part)) {
      container.appendChild(document.createTextNode(part));
      offset += part.length;
      return;
    }
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = part;
    span.dataset.offset = String(offset);
    offset += part.length;
    container.appendChild(span);
  });
}

function speak(text, { target = els.compareText, onEnd } = {}) {
  if (!('speechSynthesis' in window)) {
    hint('当前运行环境不支持系统朗读，请直接参考原文跟读。', 'warn');
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = state.rate;
  const v = pickVoice();
  if (v) u.voice = v;

  const words = target.querySelectorAll('.word');
  u.onboundary = (e) => {
    if (e.name && e.name !== 'word') return;
    let hit = null;
    words.forEach((w) => {
      const start = Number(w.dataset.offset || 0);
      if (start <= e.charIndex) hit = w;
      w.classList.remove('active');
    });
    if (hit) hit.classList.add('active');
  };
  u.onend = () => {
    words.forEach((w) => w.classList.remove('active'));
    if (onEnd) onEnd();
  };
  u.onerror = () => {
    words.forEach((w) => w.classList.remove('active'));
    if (onEnd) onEnd();
  };
  window.speechSynthesis.speak(u);
}

// 对照区使用原文逐词高亮
function speakReference() {
  const sentence = state.current;
  if (!sentence || state.recording) return;
  stopAllPlayback();
  els.compareMeta.textContent = '原文朗读 · ' + state.rate + '×';
  els.compareActions.innerHTML = '';
  appendWordSpans(els.compareText, sentence.text);

  hint('正在播放原音，注意重音与连读');
  speak(sentence.text, {
    target: els.compareText,
    onEnd: () => hint('原音播放结束，可以开始跟读录音'),
  });
}

/* ------------------------------------------------------------------ */
/* 录音                                                                */
/* ------------------------------------------------------------------ */
async function startRecording() {
  if (!state.current || state.recording) return;
  stopAllPlayback();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    state.stream = stream;
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioCtx.createMediaStreamSource(stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 1024;
    source.connect(state.analyser);

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : '';
    state.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    state.chunks = [];
    state.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) state.chunks.push(e.data);
    };
    state.recorder.onstop = handleRecorderStop;
    state.recorder.start();

    state.recording = true;
    state.recStart = performance.now();
    state.levels.fill(0);
    tickTimer();
    drawLiveWave();
    hint('录音中… 请跟着原文朗读，读完点「停止」');
    syncUI();
  } catch (err) {
    hint(
      '无法访问麦克风：' + (err && err.message ? err.message : err) +
        '。请在 Windows「设置 → 隐私和安全性 → 麦克风」中允许应用访问。',
      'error'
    );
    cleanupRecorder();
  }
}

function stopRecording() {
  if (!state.recording || !state.recorder) return;
  try {
    state.recorder.stop();
  } catch (_) {
    cleanupRecorder();
  }
}

async function handleRecorderStop() {
  const durationMs = Math.round(performance.now() - state.recStart);
  const blob = new Blob(state.chunks, { type: 'audio/webm' });
  const sentence = state.current;

  cleanupRecorder();
  state.recording = false;
  syncUI();

  if (!blob.size) {
    hint('没有录到声音，请检查麦克风后重试。', 'error');
    return;
  }

  hint('正在保存录音…');
  try {
    const wav = await blobToWav(blob);
    const wavBytes = new Uint8Array(wav);
    const b64 = bytesToBase64(wavBytes);
    const rec = await api().SaveRecording(
      sentence.id,
      sentence.text,
      sentence.translation,
      durationMs,
      b64
    );
    state.lastRecording = rec;
    await refreshRecordings();
    hint('录音已保存，正在回放，请对照原文检查发音');
    playRecord(rec);
  } catch (err) {
    hint('保存录音失败：' + err, 'error');
  }
}

function cleanupRecorder() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (state.audioCtx) {
    state.audioCtx.close().catch(() => {});
    state.audioCtx = null;
  }
  state.analyser = null;
  state.recorder = null;
  state.recording = false;
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = null;
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
  drawIdleWave();
}

function tickTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = setInterval(() => {
    if (!state.recording) return;
    const ms = performance.now() - state.recStart;
    els.timer.textContent = formatDuration(ms);
  }, 100);
}

/* ------------------------------------------------------------------ */
/* WAV 编码（16kHz 单声道，体积小且时长精确）                            */
/* ------------------------------------------------------------------ */
async function blobToWav(blob) {
  const buf = await blob.arrayBuffer();
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await decodeCtx.decodeAudioData(buf.slice(0));
  await decodeCtx.close();

  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), rendered.sampleRate);
}

function encodeWav(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return ab;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------ */
/* 播放录音                                                            */
/* ------------------------------------------------------------------ */
async function playRecord(rec) {
  stopAllPlayback();
  hint('正在加载录音…');
  try {
    const dataUrl = await api().GetRecordingAudio(rec.id);
    const audio = new Audio(dataUrl);
    state.audioEl = audio;
    state.playingRecordId = rec.id;
    showCompare(rec);
    markPlaying(rec.id);

    audio.onended = () => {
      state.playingRecordId = null;
      markPlaying(null);
      els.compareMeta.textContent = '原文';
      hint('回放结束，对比一下重音、连读和语调');
    };
    audio.onerror = () => {
      state.playingRecordId = null;
      markPlaying(null);
      hint('录音播放失败', 'error');
    };
    await audio.play();
    hint('正在回放你的录音，对照原文检查发音');
  } catch (err) {
    hint('播放录音失败：' + err, 'error');
  }
}

function compareRecord(rec) {
  if (state.recording) return;
  stopAllPlayback();
  const text = rec.text || state.current.text;
  showCompare(rec);
  els.compareMeta.textContent = 'AB 对比 · 原音 → 我的录音';
  hint('先听原音，再听你的录音…');

  speak(text, {
    target: els.compareText,
    onEnd: () => {
      setTimeout(() => playRecord(rec), 350);
    },
  });
}

function showCompare(rec) {
  const text = rec.text || state.current.text;
  appendWordSpans(els.compareText, text);
  els.compareMeta.textContent = rec.durationMs
    ? `我的录音 · ${formatDuration(rec.durationMs)}`
    : '我的录音';

  els.compareActions.innerHTML = '';
  const again = document.createElement('button');
  again.className = 'mini';
  again.textContent = '再听原音';
  again.addEventListener('click', () => {
    stopAllPlayback();
    speak(text, { target: els.compareText });
  });
  const mine = document.createElement('button');
  mine.className = 'mini';
  mine.textContent = '听我的录音';
  mine.addEventListener('click', () => playRecord(rec));
  els.compareActions.append(again, mine);
}

function markPlaying(id) {
  [...els.recordList.querySelectorAll('.record-item')].forEach((el) => {
    el.classList.toggle('playing', el.dataset.id === id);
  });
}

function stopAllPlayback() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (state.audioEl) {
    state.audioEl.pause();
    state.audioEl = null;
  }
  state.playingRecordId = null;
  markPlaying(null);
}

/* ------------------------------------------------------------------ */
/* 录音列表                                                            */
/* ------------------------------------------------------------------ */
async function refreshRecordings() {
  try {
    state.recordings = await api().ListRecordings();
  } catch (err) {
    hint('读取录音列表失败：' + err, 'error');
    return;
  }
  renderRecordings();
  renderSentenceList();
  syncUI();
}

function renderRecordings() {
  els.recordCount.textContent = state.recordings.length ? `(${state.recordings.length})` : '';
  els.recordList.innerHTML = '';

  if (!state.recordings.length) {
    els.recordList.innerHTML = '<div class="empty">还没有录音，先跟读一句试试。</div>';
    return;
  }

  state.recordings.forEach((rec) => {
    const item = document.createElement('div');
    item.className = 'record-item';
    item.dataset.id = rec.id;
    item.innerHTML = `
      <button class="rec-play" title="播放">▶</button>
      <div class="rec-body">
        <div class="rec-text"></div>
        <div class="rec-sub">
          <span class="rec-time"></span>
          <span class="rec-dur"></span>
        </div>
      </div>
      <div class="rec-actions">
        <button class="icon-btn" data-act="ab" title="AB 对比">⇄</button>
        <button class="icon-btn danger" data-act="del" title="删除">✕</button>
      </div>
    `;
    item.querySelector('.rec-text').textContent = rec.text;
    item.querySelector('.rec-time').textContent = formatTime(rec.createdAt);
    item.querySelector('.rec-dur').textContent = formatDuration(rec.durationMs);

    item.querySelector('.rec-play').addEventListener('click', () => playRecord(rec));
    item.querySelector('[data-act="ab"]').addEventListener('click', () => compareRecord(rec));
    item.querySelector('[data-act="del"]').addEventListener('click', async () => {
      if (!confirm('删除这条录音？')) return;
      try {
        await api().DeleteRecording(rec.id);
        if (state.lastRecording && state.lastRecording.id === rec.id) {
          state.lastRecording = null;
        }
        await refreshRecordings();
        hint('已删除该录音');
      } catch (err) {
        hint('删除失败：' + err, 'error');
      }
    });
    els.recordList.appendChild(item);
  });
}

/* ------------------------------------------------------------------ */
/* 波形绘制                                                            */
/* ------------------------------------------------------------------ */
function setupCanvas() {
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const rect = els.wave.getBoundingClientRect();
    els.wave.width = Math.max(1, Math.floor(rect.width * dpr));
    els.wave.height = Math.max(1, Math.floor(rect.height * dpr));
    drawIdleWave();
  };
  resize();
  window.addEventListener('resize', resize);
}

function waveContext() {
  const ctx = els.wave.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawIdleWave() {
  const ctx = waveContext();
  const w = els.wave.width / (window.devicePixelRatio || 1);
  const h = els.wave.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  const count = 72;
  const gap = 4;
  const barW = Math.max(2, (w - gap * (count - 1)) / count);
  const mid = h / 2;
  ctx.fillStyle = 'rgba(96, 165, 250, 0.16)';
  for (let i = 0; i < count; i++) {
    const bh = 3;
    const x = i * (barW + gap);
    roundRect(ctx, x, mid - bh / 2, barW, bh, bh / 2);
  }
  ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('等待录音…', w / 2, mid + 26);
}

function drawLiveWave() {
  if (!state.analyser) return;
  const data = new Uint8Array(state.analyser.fftSize);
  const loop = () => {
    if (!state.analyser) return;
    state.analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const level = Math.min(1, rms * 3.2);

    state.levels.copyWithin(0, 1);
    state.levels[state.levels.length - 1] = level;

    const ctx = waveContext();
    const dpr = window.devicePixelRatio || 1;
    const w = els.wave.width / dpr;
    const h = els.wave.height / dpr;
    ctx.clearRect(0, 0, w, h);

    const count = state.levels.length;
    const gap = 2;
    const barW = Math.max(1.5, (w - gap * (count - 1)) / count);
    const mid = h / 2;

    for (let i = 0; i < count; i++) {
      const ratio = i / count;
      const bh = Math.max(3, state.levels[i] * h * 0.9);
      const x = i * (barW + gap);
      const grad = ctx.createLinearGradient(0, mid - bh / 2, 0, mid + bh / 2);
      grad.addColorStop(0, `rgba(74, 222, 128, ${0.45 + ratio * 0.5})`);
      grad.addColorStop(1, `rgba(34, 211, 238, ${0.35 + ratio * 0.45})`);
      ctx.fillStyle = grad;
      roundRect(ctx, x, mid - bh / 2, barW, bh, barW / 2);
    }
    state.raf = requestAnimationFrame(loop);
  };
  state.raf = requestAnimationFrame(loop);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/* UI 状态                                                             */
/* ------------------------------------------------------------------ */
function syncUI() {
  const recording = state.recording;
  const hasMine = !!state.lastRecording && !recording;

  els.btnRecord.disabled = recording;
  els.btnRecord.classList.toggle('recording', recording);
  els.btnRecord.innerHTML = recording
    ? '<span class="dot"></span> 录音中…'
    : '<span class="dot"></span> 开始录音';
  els.btnStop.disabled = !recording;
  els.btnMine.disabled = !hasMine;
  els.btnAB.disabled = !hasMine;
  els.btnRef.disabled = recording;
}

function hint(text, type = '') {
  els.hint.textContent = text;
  els.hint.className = 'hint' + (type ? ' ' + type : '');
}

function formatDuration(ms) {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const ds = Math.floor((total * 10) % 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ds}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

init();
