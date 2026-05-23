import { useState, useRef, useEffect, useCallback } from "react";

const TOOL = { NONE: "NONE", REMOVE_BG: "REMOVE_BG", ERASER: "ERASER", CROP: "CROP" };

const ToolIcon = ({ tool }) => {
  if (tool === TOOL.REMOVE_BG) return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
      <path d="M8 12s1.5-2 4-2 4 2 4 2" strokeLinecap="round"/>
      <path d="M9 9h.01M15 9h.01"/>
    </svg>
  );
  if (tool === TOOL.ERASER) return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 20H7L3 16l10-10 7 7-3 3" strokeLinejoin="round"/>
      <path d="m6.5 17.5 3-3" strokeLinecap="round"/>
    </svg>
  );
  if (tool === TOOL.CROP) return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" strokeLinecap="round"/>
    </svg>
  );
  return null;
};

export default function RemoveBGYan() {
  const [hasImage, setHasImage] = useState(false);
  const [activeTool, setActiveTool] = useState(TOOL.NONE);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Upload an image to start editing");
  const [eraserSize, setEraserSize] = useState(40);
  const [isDragOver, setIsDragOver] = useState(false);
  const [history, setHistory] = useState([]);

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const fileInputRef = useRef(null);
  const isDrawingRef = useRef(false);
  const cropStartRef = useRef(null);
  const lastPosRef = useRef(null);

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snapshot = canvas.toDataURL();
    setHistory(h => [...h.slice(-9), snapshot]);
  }, []);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * sx,
      y: (src.clientY - rect.top) * sy,
    };
  };

  const loadImageToCanvas = (src) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX_W = 880, MAX_H = 580;
        let w = img.width, h = img.height;
        const ratio = Math.min(MAX_W / w, MAX_H / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
        const canvas = canvasRef.current;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const overlay = overlayRef.current;
        overlay.width = w;
        overlay.height = h;
        resolve({ w, h });
      };
      img.src = src;
    });
  };

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) {
      setStatusMsg("⚠️ Please upload a valid image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      await loadImageToCanvas(ev.target.result);
      setHasImage(true);
      setActiveTool(TOOL.NONE);
      setHistory([]);
      setStatusMsg("✅ Image loaded — choose a tool below");
    };
    reader.readAsDataURL(file);
  };

  // ── REMOVE BG ──────────────────────────────────────────
  const handleRemoveBG = async () => {
    if (!hasImage || processing) return;
    saveHistory();
    setProcessing(true);
    setProgress(0);
    setStatusMsg("🤖 Loading AI model (first run may take ~10s)...");
    setActiveTool(TOOL.REMOVE_BG);
    try {
      const { removeBackground } = await import(
        "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/browser.mjs"
      );
      const canvas = canvasRef.current;
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      setStatusMsg("🎯 Removing background...");
      const result = await removeBackground(blob, {
        progress: (key, cur, total) => {
          if (total > 0) setProgress(Math.round((cur / total) * 100));
        },
      });
      const url = URL.createObjectURL(result);
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        setStatusMsg("✅ Background removed! Use Eraser to clean edges.");
      };
      img.src = url;
    } catch (err) {
      setStatusMsg("❌ " + (err.message || "Failed — try refreshing"));
      console.error(err);
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  };

  // ── ERASER ─────────────────────────────────────────────
  const doErase = (pos) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, eraserSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fill();
    ctx.restore();
  };

  const doEraseLine = (from, to) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.lineWidth = eraserSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  // ── CROP ───────────────────────────────────────────────
  const drawCropOverlay = (start, end) => {
    if (!start || !end) return;
    const overlay = overlayRef.current;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    ctx.clearRect(x, y, w, h);
    ctx.strokeStyle = "#00f5d4";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    const corners = [[x,y],[x+w,y],[x,y+h],[x+w,y+h]];
    corners.forEach(([cx, cy]) => {
      ctx.fillStyle = "#00f5d4";
      ctx.fillRect(cx - 5, cy - 5, 10, 10);
    });
  };

  const applyCrop = (start, end) => {
    if (!start || !end) return;
    const x = Math.round(Math.min(start.x, end.x));
    const y = Math.round(Math.min(start.y, end.y));
    const w = Math.round(Math.abs(end.x - start.x));
    const h = Math.round(Math.abs(end.y - start.y));
    if (w < 10 || h < 10) { setStatusMsg("⚠️ Selection too small"); return; }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(x, y, w, h);
    canvas.width = w;
    canvas.height = h;
    ctx.putImageData(imageData, 0, 0);
    const overlay = overlayRef.current;
    overlay.width = w;
    overlay.height = h;
    const octx = overlay.getContext("2d");
    octx.clearRect(0, 0, w, h);
    setStatusMsg("✂️ Cropped! " + w + " × " + h + "px");
  };

  const clearOverlay = () => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  };

  // ── POINTER EVENTS ────────────────────────────────────
  const onPointerDown = (e) => {
    if (!hasImage || processing) return;
    if (activeTool === TOOL.NONE) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const pos = getPos(e, canvas);
    isDrawingRef.current = true;
    lastPosRef.current = pos;
    if (activeTool === TOOL.ERASER) {
      saveHistory();
      doErase(pos);
    } else if (activeTool === TOOL.CROP) {
      cropStartRef.current = pos;
    }
  };

  const onPointerMove = (e) => {
    if (!isDrawingRef.current || !hasImage) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const pos = getPos(e, canvas);
    if (activeTool === TOOL.ERASER) {
      doEraseLine(lastPosRef.current, pos);
      lastPosRef.current = pos;
    } else if (activeTool === TOOL.CROP) {
      drawCropOverlay(cropStartRef.current, pos);
    }
  };

  const onPointerUp = (e) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (activeTool === TOOL.CROP) {
      const canvas = canvasRef.current;
      const pos = getPos(e, canvas);
      saveHistory();
      applyCrop(cropStartRef.current, pos);
      clearOverlay();
      setActiveTool(TOOL.NONE);
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);
      const overlay = overlayRef.current;
      overlay.width = img.width;
      overlay.height = img.height;
    };
    img.src = last;
    setStatusMsg("↩️ Undone");
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    const link = document.createElement("a");
    link.download = "removebg-yan.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    setStatusMsg("💾 Saved as PNG with transparency!");
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const cursor = activeTool === TOOL.ERASER
    ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${eraserSize}' height='${eraserSize}' viewBox='0 0 ${eraserSize} ${eraserSize}'%3E%3Ccircle cx='${eraserSize/2}' cy='${eraserSize/2}' r='${eraserSize/2-1}' stroke='%2300f5d4' stroke-width='2' fill='none'/%3E%3C/svg%3E") ${eraserSize/2} ${eraserSize/2}, crosshair`
    : activeTool === TOOL.CROP ? "crosshair" : "default";

  const tools = [
    { id: TOOL.REMOVE_BG, label: "Remove BG", sub: "AI Background Removal", action: handleRemoveBG },
    { id: TOOL.ERASER,    label: "Eraser",    sub: "Paint to erase pixels",  action: () => setActiveTool(TOOL.ERASER) },
    { id: TOOL.CROP,      label: "Crop",      sub: "Drag to select & crop",  action: () => setActiveTool(TOOL.CROP) },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#070b0f",
      fontFamily: "'Space Mono', 'Courier New', monospace",
      display: "flex",
      flexDirection: "column",
      color: "#e0e8f0",
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #070b0f; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #1e3040; border-radius: 3px; }
        .tool-btn { transition: all 0.18s ease; }
        .tool-btn:hover { transform: translateY(-2px); }
        .upload-zone { transition: all 0.2s ease; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .slide-up { animation: slideUp 0.3s ease; }
        .checker {
          background-image: linear-gradient(45deg, #1a1a2e 25%, transparent 25%),
            linear-gradient(-45deg, #1a1a2e 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #1a1a2e 75%),
            linear-gradient(-45deg, transparent 75%, #1a1a2e 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
          background-color: #12151c;
        }
        .glow { box-shadow: 0 0 20px rgba(0,245,212,0.15); }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{
        padding: "18px 32px",
        borderBottom: "1px solid #1a2535",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(7,11,15,0.95)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: 36, height: 36,
            background: "linear-gradient(135deg, #00f5d4, #0070f3)",
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <div style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: "1.2rem",
              letterSpacing: "-0.02em",
              background: "linear-gradient(90deg, #00f5d4, #0070f3)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>REMOVE BG YAN</div>
            <div style={{ fontSize: "0.62rem", color: "#4a6080", letterSpacing: "0.12em" }}>IMAGE EDITOR v1.0</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {hasImage && (
            <>
              <button onClick={handleUndo} disabled={history.length === 0}
                title="Undo"
                style={{
                  background: history.length === 0 ? "#111820" : "#1a2535",
                  border: "1px solid #2a3a50",
                  color: history.length === 0 ? "#2a3a50" : "#7a9bb5",
                  borderRadius: 8,
                  padding: "8px 14px",
                  cursor: history.length === 0 ? "not-allowed" : "pointer",
                  fontSize: "0.75rem",
                  fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                ↩ Undo
              </button>
              <button onClick={handleDownload}
                style={{
                  background: "linear-gradient(135deg, #00f5d4, #0070f3)",
                  border: "none",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "8px 18px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                ↓ Export PNG
              </button>
            </>
          )}
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, gap: 0 }}>
        {/* ── SIDEBAR ── */}
        <aside style={{
          width: 220,
          minWidth: 220,
          background: "#0a0e14",
          borderRight: "1px solid #151e28",
          padding: "24px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <div style={{ fontSize: "0.62rem", color: "#2a4060", letterSpacing: "0.2em", marginBottom: 8, paddingLeft: 4 }}>
            TOOLS
          </div>

          {tools.map((t) => (
            <button key={t.id} className="tool-btn"
              onClick={t.action}
              disabled={!hasImage || processing}
              style={{
                background: activeTool === t.id
                  ? "linear-gradient(135deg, rgba(0,245,212,0.12), rgba(0,112,243,0.12))"
                  : "transparent",
                border: activeTool === t.id
                  ? "1px solid rgba(0,245,212,0.4)"
                  : "1px solid #1a2535",
                borderRadius: 10,
                padding: "12px 14px",
                cursor: !hasImage || processing ? "not-allowed" : "pointer",
                textAlign: "left",
                color: !hasImage || processing ? "#2a3a50"
                  : activeTool === t.id ? "#00f5d4" : "#7a9bb5",
                fontFamily: "inherit",
                opacity: !hasImage && !processing ? 0.4 : 1,
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 34, height: 34,
                  borderRadius: 8,
                  background: activeTool === t.id ? "rgba(0,245,212,0.15)" : "#111820",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: activeTool === t.id ? "#00f5d4" : "#4a6080",
                }}>
                  <ToolIcon tool={t.id} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.8rem", letterSpacing: "0.02em" }}>{t.label}</div>
                  <div style={{ fontSize: "0.6rem", color: activeTool === t.id ? "rgba(0,245,212,0.6)" : "#2a4060", marginTop: 2 }}>{t.sub}</div>
                </div>
              </div>
            </button>
          ))}

          {/* Eraser size slider */}
          {activeTool === TOOL.ERASER && hasImage && (
            <div className="slide-up" style={{
              background: "rgba(0,245,212,0.05)",
              border: "1px solid rgba(0,245,212,0.2)",
              borderRadius: 10, padding: "14px",
              marginTop: 4,
            }}>
              <div style={{ fontSize: "0.62rem", color: "#00f5d4", letterSpacing: "0.15em", marginBottom: 10 }}>
                BRUSH SIZE
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min={5} max={120} value={eraserSize}
                  onChange={(e) => setEraserSize(Number(e.target.value))}
                  style={{ flex: 1, accentColor: "#00f5d4", cursor: "pointer" }}
                />
                <span style={{ fontSize: "0.7rem", color: "#00f5d4", minWidth: 28, textAlign: "right" }}>{eraserSize}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 10 }}>
                <div style={{
                  width: Math.min(eraserSize, 60),
                  height: Math.min(eraserSize, 60),
                  borderRadius: "50%",
                  border: "2px solid rgba(0,245,212,0.4)",
                  background: "rgba(0,245,212,0.1)",
                  transition: "all 0.15s",
                }} />
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Upload new */}
          <button onClick={() => fileInputRef.current.click()}
            style={{
              background: "transparent",
              border: "1px dashed #2a3a50",
              color: "#4a6080",
              borderRadius: 10,
              padding: "10px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "0.7rem",
              letterSpacing: "0.05em",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <span style={{ fontSize: "1rem" }}>+</span> New Image
          </button>
        </aside>

        {/* ── CANVAS AREA ── */}
        <main style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#070b0f",
          position: "relative",
          minHeight: "calc(100vh - 73px)",
        }}>
          {/* Status bar */}
          {hasImage && (
            <div style={{
              position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
              background: "#0d1520",
              border: "1px solid #1a2535",
              borderRadius: 20,
              padding: "6px 16px",
              fontSize: "0.7rem",
              color: "#7a9bb5",
              letterSpacing: "0.03em",
              whiteSpace: "nowrap",
              zIndex: 10,
            }}>
              {processing ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid #00f5d4", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  {statusMsg} {progress > 0 && `${progress}%`}
                </span>
              ) : statusMsg}
            </div>
          )}

          {!hasImage ? (
            /* ── UPLOAD ZONE ── */
            <div
              className="upload-zone"
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}
              style={{
                width: "min(600px, 90vw)",
                height: 360,
                border: isDragOver ? "2px solid #00f5d4" : "2px dashed #1e3040",
                borderRadius: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                background: isDragOver ? "rgba(0,245,212,0.04)" : "rgba(13,20,32,0.6)",
                boxShadow: isDragOver ? "0 0 40px rgba(0,245,212,0.1)" : "none",
                transition: "all 0.2s ease",
                gap: 16,
              }}>
              <div style={{
                width: 72, height: 72,
                borderRadius: 18,
                background: "linear-gradient(135deg, rgba(0,245,212,0.15), rgba(0,112,243,0.15))",
                border: "1px solid rgba(0,245,212,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round"/>
                  <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{
                  fontFamily: "'Syne', sans-serif", fontWeight: 700,
                  fontSize: "1.1rem", color: "#c0d0e0", marginBottom: 6,
                }}>
                  {isDragOver ? "Drop it here!" : "Upload Image"}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#3a5070", letterSpacing: "0.05em" }}>
                  Drag & drop or click to browse
                </div>
                <div style={{ fontSize: "0.65rem", color: "#2a3a50", marginTop: 6 }}>
                  PNG · JPG · WEBP supported
                </div>
              </div>
            </div>
          ) : (
            /* ── CANVAS ── */
            <div className="checker" style={{
              position: "relative",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 0 0 1px #1a2535, 0 20px 60px rgba(0,0,0,0.6)",
              maxWidth: "100%",
              maxHeight: "calc(100vh - 160px)",
            }}>
              <canvas
                ref={canvasRef}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "calc(100vh - 160px)",
                  cursor,
                  touchAction: "none",
                }}
                onMouseDown={onPointerDown}
                onMouseMove={onPointerMove}
                onMouseUp={onPointerUp}
                onMouseLeave={onPointerUp}
                onTouchStart={onPointerDown}
                onTouchMove={onPointerMove}
                onTouchEnd={onPointerUp}
              />
              {/* Overlay for crop selection */}
              <canvas
                ref={overlayRef}
                style={{
                  position: "absolute",
                  top: 0, left: 0,
                  maxWidth: "100%",
                  maxHeight: "100%",
                  pointerEvents: "none",
                }}
              />
              {/* Processing overlay */}
              {processing && (
                <div style={{
                  position: "absolute", inset: 0,
                  background: "rgba(7,11,15,0.75)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 16,
                  backdropFilter: "blur(4px)",
                }}>
                  <div style={{
                    width: 56, height: 56,
                    border: "3px solid rgba(0,245,212,0.2)",
                    borderTop: "3px solid #00f5d4",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }} />
                  {progress > 0 && (
                    <div style={{ width: 200 }}>
                      <div style={{ fontSize: "0.65rem", color: "#00f5d4", textAlign: "center", marginBottom: 8, letterSpacing: "0.1em" }}>
                        {progress}%
                      </div>
                      <div style={{ height: 4, background: "#1a2535", borderRadius: 2 }}>
                        <div style={{
                          height: "100%", width: `${progress}%`,
                          background: "linear-gradient(90deg, #00f5d4, #0070f3)",
                          borderRadius: 2,
                          transition: "width 0.2s",
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Hint at bottom */}
          {hasImage && activeTool === TOOL.NONE && !processing && (
            <div style={{
              position: "absolute", bottom: 16,
              fontSize: "0.65rem", color: "#2a3a50", letterSpacing: "0.05em",
            }}>
              SELECT A TOOL FROM THE SIDEBAR →
            </div>
          )}
        </main>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files[0])}
      />
    </div>
  );
}

