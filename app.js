/* ═══════════════════════════════════════
   app.js — CutOut Studio
   Semua logic: upload, remove bg, eraser,
   undo, download, dan UI state.
═══════════════════════════════════════ */

// ── DOM references ──
const canvas  = document.getElementById('mainCanvas');
const ctx     = canvas.getContext('2d', { willReadFrequently: true });
const overlay = document.getElementById('overlayCanvas');
const cursor  = document.getElementById('customCursor');

// ── App state ──
let activeTool = 'none'; // 'none' | 'removebg' | 'eraser'
let hasImage   = false;
let processing = false;
let eraserSize = 30;
let isDrawing  = false;
let lastPos    = null;
let history    = [];

/* ════════════════════════════════════════
   FILE UPLOAD
════════════════════════════════════════ */

/** Dipanggil saat file input berubah */
function onFileChange(e) {
  const file = e.target.files[0];
  if (file) loadFile(file);
  e.target.value = ''; // reset supaya file sama bisa diupload ulang
}

/** Drag over — highlight zona upload */
function onDragOver(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.add('dragover');
  document.getElementById('uploadIcon').textContent  = '✨';
  document.getElementById('uploadTitle').textContent = 'Lepas di sini!';
}

/** Drag leave — kembalikan zona upload */
function onDragLeave() {
  document.getElementById('uploadZone').classList.remove('dragover');
  document.getElementById('uploadIcon').textContent  = '🖼️';
  document.getElementById('uploadTitle').textContent = 'Upload Gambar';
}

/** Drop file */
function onDrop(e) {
  e.preventDefault();
  onDragLeave();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadFile(file);
}

/** Load gambar ke canvas */
function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      // Scale down jika terlalu besar
      const MAX = 900;
      let w = img.width, h = img.height;
      const ratio = Math.min(MAX / w, MAX / h, 1);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);

      canvas.width  = w;
      canvas.height = h;
      overlay.width  = w;
      overlay.height = h;

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      hasImage   = true;
      history    = [];
      activeTool = 'none';

      updateUI();
      setStatus('Gambar siap diedit ✓', false);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

/* ════════════════════════════════════════
   UI STATE
════════════════════════════════════════ */

/** Sync semua tampilan sesuai state */
function updateUI() {
  // Upload zone vs canvas
  document.getElementById('uploadZone').style.display = hasImage ? 'none' : '';
  document.getElementById('canvasWrap').classList.toggle('show', hasImage);
  document.getElementById('downloadBtn').classList.toggle('show', hasImage);
  document.getElementById('hintText').classList.toggle('show',
    hasImage && activeTool === 'none' && !processing
  );
  document.getElementById('resetBtn').style.display  = hasImage ? 'flex' : 'none';
  document.getElementById('changeBtn').classList.toggle('show', hasImage);

  // Tool buttons
  document.getElementById('btnRemoveBG').disabled = !hasImage || processing;
  document.getElementById('btnEraser').disabled   = !hasImage || processing;
  document.getElementById('undoBtn').disabled     = history.length === 0;

  // Active tool highlight
  document.getElementById('btnRemoveBG').className =
    'tool-btn' + (activeTool === 'removebg' ? ' active-removebg' : '');
  document.getElementById('btnEraser').className =
    'tool-btn' + (activeTool === 'eraser' ? ' active-eraser' : '');

  // Eraser slider & hint
  document.getElementById('sliderPanel').classList.toggle('show',
    activeTool === 'eraser' && hasImage
  );
  document.getElementById('eraserHint').classList.toggle('show',
    activeTool === 'eraser' && hasImage && !processing
  );

  // Cursor style pada canvas
  canvas.style.cursor = activeTool === 'eraser' ? 'none' : 'default';
}

/** Tampilkan pesan status di sidebar */
function setStatus(msg, isProcessing) {
  const chip = document.getElementById('statusChip');
  chip.classList.toggle('show', !!msg);
  chip.classList.toggle('processing', isProcessing);

  if (isProcessing) {
    chip.innerHTML = `<span class="spinner"></span>${msg}`;
  } else {
    chip.textContent = msg;
  }
}

/* ════════════════════════════════════════
   REMOVE BACKGROUND
════════════════════════════════════════ */

async function handleRemoveBG() {
  if (!hasImage || processing) return;

  saveHistory();
  processing = true;
  activeTool = 'removebg';
  updateUI();
  setStatus('Memuat AI model...', true);

  const procOverlay = document.getElementById('processingOverlay');
  procOverlay.classList.add('show');
  document.getElementById('procText').textContent     = 'Memuat AI model...';
  document.getElementById('progressBar').style.width  = '0%';
  document.getElementById('progressPct').textContent  = '';

  try {
    // Dynamic import library dari CDN
    const { removeBackground } = await import(
      'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/browser.mjs'
    );

    // Ambil gambar dari canvas sebagai blob
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));

    document.getElementById('procText').textContent = 'Menghapus background...';
    setStatus('Menghapus background...', true);

    // Proses dengan callback progress
    const result = await removeBackground(blob, {
      progress: (key, cur, total) => {
        if (total > 0) {
          const pct = Math.round((cur / total) * 100);
          document.getElementById('progressBar').style.width = pct + '%';
          document.getElementById('progressPct').textContent = pct + '%';
        }
      }
    });

    // Gambar hasil ke canvas
    const url = URL.createObjectURL(result);
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      processing = false;
      activeTool = 'none';
      procOverlay.classList.remove('show');
      updateUI();
      setStatus('✓ Background berhasil dihapus!', false);
    };
    img.src = url;

  } catch (err) {
    console.error('Remove BG error:', err);
    processing = false;
    activeTool = 'none';
    procOverlay.classList.remove('show');
    updateUI();
    setStatus('❌ Gagal, coba lagi ya', false);
  }
}

/* ════════════════════════════════════════
   ERASER TOOL
════════════════════════════════════════ */

/** Aktifkan mode eraser */
function activateEraser() {
  if (!hasImage || processing) return;
  activeTool = 'eraser';
  updateUI();
  setStatus('Mode eraser aktif', false);
}

/** Ambil posisi pointer relatif terhadap canvas */
function getPos(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY,
    cx: src.clientX,
    cy: src.clientY,
  };
}

/** Hapus piksel dari titik `from` ke `to` */
function erase(from, to) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth   = eraserSize;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

// Mouse events
canvas.addEventListener('mousedown', e => {
  if (activeTool !== 'eraser' || !hasImage || processing) return;
  e.preventDefault();
  const pos = getPos(e);
  isDrawing = true;
  lastPos   = pos;
  saveHistory();
  erase(pos, pos);
});

canvas.addEventListener('mousemove', e => {
  // Tampilkan custom cursor saat mode eraser
  if (activeTool === 'eraser' && hasImage) {
    const rect  = canvas.getBoundingClientRect();
    const scale = rect.width / canvas.width;
    const sz    = eraserSize * scale;
    cursor.style.display = 'block';
    cursor.style.width   = sz + 'px';
    cursor.style.height  = sz + 'px';
    cursor.style.left    = e.clientX + 'px';
    cursor.style.top     = e.clientY + 'px';
  }
  if (!isDrawing) return;
  e.preventDefault();
  const pos = getPos(e);
  erase(lastPos, pos);
  lastPos = pos;
});

canvas.addEventListener('mouseup',    () => { isDrawing = false; });
canvas.addEventListener('mouseleave', () => {
  isDrawing = false;
  cursor.style.display = 'none';
});

// Touch events (untuk mobile)
canvas.addEventListener('touchstart', e => {
  if (activeTool !== 'eraser' || !hasImage) return;
  e.preventDefault();
  const pos = getPos(e);
  isDrawing = true;
  lastPos   = pos;
  saveHistory();
  erase(pos, pos);
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  if (!isDrawing) return;
  e.preventDefault();
  const pos = getPos(e);
  erase(lastPos, pos);
  lastPos = pos;
}, { passive: false });

canvas.addEventListener('touchend', () => { isDrawing = false; });

/* ════════════════════════════════════════
   BRUSH SIZE
════════════════════════════════════════ */

function updateBrush(val) {
  eraserSize = Number(val);

  // Update label
  document.getElementById('sliderVal').textContent = val + 'px';

  // Update preview circle
  const sz = Math.min(Number(val) * 0.5, 46);
  const bc = document.getElementById('brushCircle');
  bc.style.width  = sz + 'px';
  bc.style.height = sz + 'px';
}

/* ════════════════════════════════════════
   HISTORY (UNDO)
════════════════════════════════════════ */

/** Simpan snapshot canvas ke history */
function saveHistory() {
  history = [...history.slice(-9), canvas.toDataURL()];
  document.getElementById('undoBtn').disabled = false;
}

/** Kembalikan ke snapshot terakhir */
function undo() {
  if (!history.length) return;
  const last = history[history.length - 1];
  history = history.slice(0, -1);

  const img = new Image();
  img.onload = () => {
    canvas.width  = img.width;
    canvas.height = img.height;
    overlay.width  = img.width;
    overlay.height = img.height;
    ctx.drawImage(img, 0, 0);
    document.getElementById('undoBtn').disabled = history.length === 0;
    setStatus('Undo berhasil', false);
  };
  img.src = last;
}

/* ════════════════════════════════════════
   DOWNLOAD
════════════════════════════════════════ */

function downloadImage() {
  const link  = document.createElement('a');
  link.download = 'cutout-studio.png';
  link.href     = canvas.toDataURL('image/png');
  link.click();
  setStatus('✓ Gambar tersimpan!', false);
}

/* ════════════════════════════════════════
   RESET
════════════════════════════════════════ */

function resetAll() {
  hasImage   = false;
  activeTool = 'none';
  processing = false;
  history    = [];

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('processingOverlay').classList.remove('show');

  setStatus('', false);
  updateUI();
}

/* ════════════════════════════════════════
   EXPOSE ke HTML (onclick attributes)
════════════════════════════════════════ */
window.handleRemoveBG = handleRemoveBG;
window.activateEraser = activateEraser;
window.updateBrush    = updateBrush;
window.undo           = undo;
window.resetAll       = resetAll;
window.downloadImage  = downloadImage;
window.onFileChange   = onFileChange;
window.onDragOver     = onDragOver;
window.onDragLeave    = onDragLeave;
window.onDrop         = onDrop;

// ── Init ──
updateUI();
