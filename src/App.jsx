import { useState, useRef, useCallback, useEffect } from "react";

const TOOL = { NONE: "NONE", REMOVE_BG: "REMOVE_BG", ERASER: "ERASER" };

export default function ImageEditor() {
  const [hasImage, setHasImage] = useState(false);
  const [activeTool, setActiveTool] = useState(TOOL.NONE);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [eraserSize, setEraserSize] = useState(30);
  const [isDragOver, setIsDragOver] = useState(false);
  const [history, setHistory] = useState([]);
  const [bgRemoved, setBgRemoved] = useState(false);
  const [showCursor, setShowCursor] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef(null);
  const containerRef = useRef(null);

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHistory(h => [...h.slice(-9), canvas.toDataURL()]);
  }, []);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * sx,
      y: (src.clientY - rect.top) * sy,
      clientX: src.clientX,
      clientY: src.clientY,
    };
  };

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) {
      setStatusMsg("❌ File harus gambar ya!");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let w = img.width, h = img.height;
        const r = Math.min(MAX / w, MAX / h, 1);
        w = Math.round(w * r);
        h = Math.round(h * r);
        const canvas = canvasRef.current;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const overlay = overlayRef.current;
        overlay.width = w;
        overlay.height = h;
        setHasImage(true);
        setActiveTool(TOOL.NONE);
        setHistory([]);
        setBgRemoved(false);
        setStatusMsg("Gambar siap diedit!");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveBG = async () => {
    if (!hasImage || processing) return;
    saveHistory();
    setProcessing(true);
    setProgress(0);
    setStatusMsg("Memuat AI model...");
    setActiveTool(TOOL.REMOVE_BG);
    try {
      const { removeBackground } = await import(
        "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/browser.mjs"
      );
      const canvas = canvasRef.current;
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      setStatusMsg("Menghapus background...");
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
        setBgRemoved(true);
        setStatusMsg("Background berhasil dihapus!");
        setActiveTool(TOOL.NONE);
      };
      img.src = url;
    } catch (err) {
      setStatusMsg("Gagal, coba lagi ya.");
      setActiveTool(TOOL.NONE);
    } finally {
      setProcessing(false);
      setProgress(0);
    }
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

  const onPointerDown = (e) => {
    if (!hasImage || processing || activeTool !== TOOL.ERASER) return;
    e.preventDefault();
    const pos = getPos(e, canvasRef.current);
    isDrawingRef.current = true;
    lastPosRef.current = pos;
    saveHistory();
    doEraseLine(pos, pos);
  };

  const onPointerMove = (e) => {
    if (activeTool === TOOL.ERASER && hasImage) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const src = e.touches ? e.touches[0] : e;
        setCursorPos({ x: src.clientX, y: src.clientY });
        setShowCursor(true);
      }
    }
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const pos = getPos(e, canvasRef.current);
    if (activeTool === TOOL.ERASER) {
      doEraseLine(lastPosRef.current, pos);
      lastPosRef.current = pos;
    }
  };

  const onPointerUp = () => {
    isDrawingRef.current = false;
  };

  const onCanvasLeave = () => {
    isDrawingRef.current = false;
    setShowCursor(false);
  };

  const handleUndo = () => {
    if (!history.length) return;
    const last = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
      const overlay = overlayRef.current;
      overlay.width = img.width;
      overlay.height = img.height;
    };
    img.src = last;
    setStatusMsg("Undo berhasil!");
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.download = "edited-image.png";
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
    setStatusMsg("Gambar tersimpan!");
  };

  const handleReset = () => {
    setHasImage(false);
    setActiveTool(TOOL.NONE);
    setHistory([]);
    setBgRemoved(false);
    setStatusMsg("");
    setProcessing(false);
  };

  const canvasStyle = activeTool === TOOL.ERASER ? "none" : "auto";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      color: "#f0edf8",
      display: "flex",
      flexDirection: "column",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes progress-shimmer {
          0%{background-position:200% center}
          100%{background-position:-200% center}
        }
        @keyframes glow-pulse {
          0%,100%{ box-shadow: 0 0 20px rgba(99,102,241,0.3); }
          50%{ box-shadow: 0 0 40px rgba(99,102,241,0.6); }
        }

        .checker-bg {
          background-color: #1a1a24;
          background-image:
            linear-gradient(45deg, #252535 25%, transparent 25%),
            linear-gradient(-45deg, #252535 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #252535 75%),
            linear-gradient(-45deg, transparent 75%, #252535 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
        }

        .tool-btn {
          transition: all 0.2s cubic-bezier(0.34,1.56,0.64,1);
          cursor: pointer;
          border: none;
          outline: none;
        }
        .tool-btn:hover:not(:disabled) { transform: translateY(-3px); }
        .tool-btn:active:not(:disabled) { transform: scale(0.95); }
        .tool-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        .upload-zone { transition: all 0.25s ease; }
        .upload-zone:hover { transform: scale(1.01); }

        .action-btn {
          transition: all 0.18s ease;
          cursor: pointer;
        }
        .action-btn:hover:not(:disabled) { filter: brightness(1.12); transform: translateY(-1px); }
        .action-btn:active:not(:disabled) { transform: scale(0.97); }
        .action-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        .status-chip {
          animation: fadeUp 0.3s ease;
        }

        .download-btn {
          animation: glow-pulse 2s ease infinite;
        }

        input[type=range] {
          -webkit-appearance: none;
          height: 4px;
          background: #2a2a3a;
          border-radius: 999px;
          outline: none;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(99,102,241,0.5);
        }
        input[type=range]::-webkit-slider-runnable-track {
          background: linear-gradient(90deg, #6366f1, #a855f7);
          border-radius: 999px;
        }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0a0a0f; }
        ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 3px; }
      `}</style>

      {/* ─── NAVBAR ─── */}
      <nav style={{
        background: "rgba(10,10,15,0.9)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "0 24px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 200,
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34,
            background: "linear-gradient(135deg, #6366f1, #a855f7)",
            borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1rem",
            boxShadow: "0 4px 12px rgba(99,102,241,0.4)",
          }}>✂</div>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: "1rem",
            background: "linear-gradient(90deg, #a5b4fc, #c084fc)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>YannDemoTools</span>
        </div>

        {/* Nav actions */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {hasImage && (
            <>
              <button className="action-btn" onClick={handleUndo}
                disabled={!history.length}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#a5b4fc",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                ↩ Undo
              </button>
              <button className="action-btn" onClick={handleReset}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#94a3b8",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  fontFamily: "inherit",
                }}>
                Ganti Foto
              </button>
            </>
          )}
        </div>
      </nav>

      {/* ─── MAIN LAYOUT ─── */}
      <div style={{ display: "flex", flex: 1, minHeight: "calc(100vh - 56px)" }}>

        {/* ─── SIDEBAR ─── */}
        <aside style={{
          width: 220,
          minWidth: 220,
          background: "rgba(255,255,255,0.02)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 14px",
          gap: 8,
        }}>
          {/* Section label */}
          <div style={{
            fontSize: "0.6rem",
            fontWeight: 700,
            color: "#4a4a6a",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            paddingLeft: 8,
            marginBottom: 4,
          }}>Tools</div>

          {/* Remove BG */}
          <button
            className="tool-btn"
            onClick={handleRemoveBG}
            disabled={!hasImage || processing}
            style={{
              background: activeTool === TOOL.REMOVE_BG
                ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                : "rgba(99,102,241,0.06)",
              border: activeTool === TOOL.REMOVE_BG
                ? "1.5px solid rgba(99,102,241,0.6)"
                : "1.5px solid rgba(99,102,241,0.15)",
              borderRadius: 14,
              padding: "14px 12px",
              textAlign: "left",
              boxShadow: activeTool === TOOL.REMOVE_BG
                ? "0 8px 24px rgba(99,102,241,0.35)"
                : "none",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36,
                borderRadius: 10,
                background: activeTool === TOOL.REMOVE_BG
                  ? "rgba(255,255,255,0.2)"
                  : "rgba(99,102,241,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.1rem",
              }}>🪄</div>
              <div>
                <div style={{
                  fontWeight: 700, fontSize: "0.82rem",
                  color: activeTool === TOOL.REMOVE_BG ? "#fff" : "#c7d2fe",
                  fontFamily: "'Space Grotesk', sans-serif",
                }}>Remove BG</div>
                <div style={{
                  fontSize: "0.6rem",
                  color: activeTool === TOOL.REMOVE_BG
                    ? "rgba(255,255,255,0.65)"
                    : "#4f5a8f",
                  marginTop: 2,
                }}>Hapus background otomatis</div>
              </div>
            </div>
          </button>

          {/* Eraser */}
          <button
            className="tool-btn"
            onClick={() => {
              if (!hasImage || processing) return;
              setActiveTool(TOOL.ERASER);
              setStatusMsg("Mode eraser — klik & drag untuk hapus");
            }}
            disabled={!hasImage || processing}
            style={{
              background: activeTool === TOOL.ERASER
                ? "linear-gradient(135deg, #ec4899, #f43f5e)"
                : "rgba(236,72,153,0.06)",
              border: activeTool === TOOL.ERASER
                ? "1.5px solid rgba(236,72,153,0.6)"
                : "1.5px solid rgba(236,72,153,0.15)",
              borderRadius: 14,
              padding: "14px 12px",
              textAlign: "left",
              boxShadow: activeTool === TOOL.ERASER
                ? "0 8px 24px rgba(236,72,153,0.35)"
                : "none",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36,
                borderRadius: 10,
                background: activeTool === TOOL.ERASER
                  ? "rgba(255,255,255,0.2)"
                  : "rgba(236,72,153,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.1rem",
              }}>🧹</div>
              <div>
                <div style={{
                  fontWeight: 700, fontSize: "0.82rem",
                  color: activeTool === TOOL.ERASER ? "#fff" : "#fbcfe8",
                  fontFamily: "'Space Grotesk', sans-serif",
                }}>Eraser</div>
                <div style={{
                  fontSize: "0.6rem",
                  color: activeTool === TOOL.ERASER
                    ? "rgba(255,255,255,0.65)"
                    : "#6b3a52",
                  marginTop: 2,
                }}>Hapus area manual</div>
              </div>
            </div>
          </button>

          {/* Eraser size slider */}
          {activeTool === TOOL.ERASER && hasImage && (
            <div style={{
              background: "rgba(236,72,153,0.06)",
              border: "1px solid rgba(236,72,153,0.2)",
              borderRadius: 12,
              padding: "12px",
              animation: "fadeUp 0.2s ease",
            }}>
              <div style={{
                fontSize: "0.6rem",
                fontWeight: 700,
                color: "#9d174d",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}>Ukuran Brush</div>
              <input
                type="range" min={5} max={120} value={eraserSize}
                onChange={e => setEraserSize(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 10,
              }}>
                <span style={{ fontSize: "0.6rem", color: "#6b3a52" }}>5px</span>
                <div style={{
                  width: Math.min(eraserSize * 0.45, 44),
                  height: Math.min(eraserSize * 0.45, 44),
                  borderRadius: "50%",
                  border: "2px dashed rgba(236,72,153,0.5)",
                  background: "rgba(236,72,153,0.1)",
                  transition: "all 0.12s",
                }} />
                <span style={{ fontSize: "0.6rem", color: "#6b3a52" }}>120px</span>
              </div>
              <div style={{
                textAlign: "center",
                fontSize: "0.65rem",
                color: "#ec4899",
                fontWeight: 600,
                marginTop: 4,
              }}>{eraserSize}px</div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Status in sidebar */}
          {statusMsg && hasImage && (
            <div className="status-chip" style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: "0.62rem",
              color: "#7c8db0",
              lineHeight: 1.5,
            }}>
              {processing ? (
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{
                    width: 10, height: 10,
                    border: "2px solid rgba(99,102,241,0.3)",
                    borderTop: "2px solid #6366f1",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                    flexShrink: 0,
                  }} />
                  <span style={{ color: "#a5b4fc" }}>{statusMsg} {progress > 0 && `${progress}%`}</span>
                </div>
              ) : (
                <span>{statusMsg}</span>
              )}
            </div>
          )}
        </aside>

        {/* ─── CANVAS AREA ─── */}
        <main style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 24px",
          gap: 24,
          position: "relative",
          overflow: "hidden",
        }}>

          {/* Background grid decoration */}
          <div style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `
              linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px",
            pointerEvents: "none",
          }} />

          {/* Glow orbs */}
          <div style={{
            position: "absolute",
            width: 400, height: 400,
            background: "radial-gradient(circle, rgba(99,102,241,0.07), transparent 70%)",
            top: -100, right: -100,
            borderRadius: "50%",
            pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute",
            width: 300, height: 300,
            background: "radial-gradient(circle, rgba(168,85,247,0.05), transparent 70%)",
            bottom: 0, left: -100,
            borderRadius: "50%",
            pointerEvents: "none",
          }} />

          {!hasImage ? (
            /* ─── UPLOAD ZONE ─── */
            <label htmlFor="fileInput"
              className="upload-zone"
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              style={{
                width: "min(540px, 90vw)",
                height: 360,
                background: isDragOver
                  ? "rgba(99,102,241,0.08)"
                  : "rgba(255,255,255,0.02)",
                border: isDragOver
                  ? "2px dashed #6366f1"
                  : "2px dashed rgba(255,255,255,0.1)",
                borderRadius: 24,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                gap: 16,
                position: "relative",
                boxShadow: isDragOver
                  ? "0 0 60px rgba(99,102,241,0.15), inset 0 0 30px rgba(99,102,241,0.05)"
                  : "0 0 0 1px rgba(255,255,255,0.04)",
                transition: "all 0.2s ease",
              }}>
              {/* Corner accents */}
              {[
                { top: 0, left: 0 },
                { top: 0, right: 0 },
                { bottom: 0, left: 0 },
                { bottom: 0, right: 0 },
              ].map((pos, i) => (
                <div key={i} style={{
                  position: "absolute",
                  ...pos,
                  width: 20, height: 20,
                  border: "2px solid rgba(99,102,241,0.3)",
                  borderRadius: i === 0 ? "6px 0 0 0" : i === 1 ? "0 6px 0 0" : i === 2 ? "0 0 0 6px" : "0 0 6px 0",
                  borderRight: i === 0 || i === 2 ? "none" : undefined,
                  borderLeft: i === 1 || i === 3 ? "none" : undefined,
                  borderBottom: i === 0 || i === 1 ? "none" : undefined,
                  borderTop: i === 2 || i === 3 ? "none" : undefined,
                  pointerEvents: "none",
                }} />
              ))}

              <div style={{
                width: 72, height: 72,
                background: "rgba(99,102,241,0.1)",
                border: "1.5px solid rgba(99,102,241,0.2)",
                borderRadius: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.8rem",
              }}>
                {isDragOver ? "✨" : "🖼️"}
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: "1.1rem",
                  color: "#e0e7ff",
                  marginBottom: 6,
                }}>
                  {isDragOver ? "Lepas gambar di sini" : "Upload Gambar"}
                </div>
                <div style={{
                  fontSize: "0.72rem",
                  color: "#4f5a8f",
                  marginBottom: 16,
                }}>
                  Drag & drop atau klik untuk pilih file
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                  {["PNG", "JPG", "WEBP", "GIF"].map(f => (
                    <span key={f} style={{
                      background: "rgba(99,102,241,0.08)",
                      border: "1px solid rgba(99,102,241,0.2)",
                      color: "#818cf8",
                      borderRadius: 6,
                      padding: "3px 9px",
                      fontSize: "0.6rem",
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                    }}>{f}</span>
                  ))}
                </div>
              </div>
            </label>
          ) : (
            /* ─── CANVAS + DOWNLOAD BUTTON ─── */
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
              width: "100%",
            }}>
              {/* Canvas wrapper */}
              <div ref={containerRef} style={{
                position: "relative",
                borderRadius: 16,
                boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 20px 60px rgba(0,0,0,0.5)",
                overflow: "hidden",
                display: "inline-block",
              }}>
                {/* Checker pattern (transparent BG) */}
                <div className="checker-bg" style={{ borderRadius: 16 }}>
                  <canvas
                    ref={canvasRef}
                    style={{
                      display: "block",
                      maxWidth: "min(860px, calc(100vw - 280px))",
                      maxHeight: "calc(100vh - 220px)",
                      cursor: activeTool === TOOL.ERASER ? "none" : "default",
                      touchAction: "none",
                      borderRadius: 16,
                      userSelect: "none",
                    }}
                    onMouseDown={onPointerDown}
                    onMouseMove={onPointerMove}
                    onMouseUp={onPointerUp}
                    onMouseLeave={onCanvasLeave}
                    onTouchStart={onPointerDown}
                    onTouchMove={onPointerMove}
                    onTouchEnd={onPointerUp}
                  />
                </div>

                {/* Overlay canvas (for future crop tool) */}
                <canvas ref={overlayRef} style={{
                  position: "absolute",
                  top: 0, left: 0,
                  maxWidth: "100%",
                  maxHeight: "100%",
                  pointerEvents: "none",
                  borderRadius: 16,
                }} />

                {/* Processing overlay */}
                {processing && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(10,10,15,0.8)",
                    backdropFilter: "blur(8px)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 16,
                    borderRadius: 16,
                  }}>
                    <div style={{ fontSize: "2.5rem", animation: "pulse 1s ease infinite" }}>🪄</div>
                    <div style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 700,
                      color: "#a5b4fc",
                      fontSize: "0.9rem",
                    }}>
                      {statusMsg}
                    </div>
                    {progress > 0 && (
                      <div style={{ width: 200 }}>
                        <div style={{
                          height: 6,
                          background: "rgba(255,255,255,0.08)",
                          borderRadius: 99,
                          overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%",
                            width: `${progress}%`,
                            background: "linear-gradient(90deg, #6366f1, #a855f7, #6366f1)",
                            backgroundSize: "200% auto",
                            borderRadius: 99,
                            animation: "progress-shimmer 2s linear infinite",
                            transition: "width 0.3s",
                          }} />
                        </div>
                        <div style={{
                          textAlign: "center",
                          fontSize: "0.65rem",
                          color: "#6366f1",
                          marginTop: 6,
                          fontWeight: 700,
                        }}>{progress}%</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tool hint badge */}
                {!processing && activeTool === TOOL.ERASER && (
                  <div style={{
                    position: "absolute",
                    top: 12, left: "50%",
                    transform: "translateX(-50%)",
                    background: "rgba(236,72,153,0.9)",
                    backdropFilter: "blur(8px)",
                    borderRadius: 20,
                    padding: "4px 14px",
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    color: "white",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    animation: "fadeUp 0.2s ease",
                  }}>
                    🧹 Drag untuk menghapus area
                  </div>
                )}
              </div>

              {/* ─── DOWNLOAD BUTTON ─── */}
              <button
                className="action-btn download-btn"
                onClick={handleDownload}
                style={{
                  background: "linear-gradient(135deg, #6366f1, #a855f7)",
                  border: "none",
                  borderRadius: 14,
                  padding: "14px 40px",
                  color: "white",
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: "0.95rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  letterSpacing: "0.02em",
                }}>
                <span style={{ fontSize: "1.1rem" }}>⬇</span>
                Download Image
                <span style={{
                  background: "rgba(255,255,255,0.2)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                }}>PNG</span>
              </button>

              {/* Hint when no tool selected */}
              {!processing && activeTool === TOOL.NONE && (
                <div style={{
                  fontSize: "0.65rem",
                  color: "#2d2d4a",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  borderRadius: 8,
                  padding: "5px 14px",
                }}>
                  ← Pilih tool di sebelah kiri
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ─── CUSTOM ERASER CURSOR ─── */}
      {showCursor && activeTool === TOOL.ERASER && (
        <div style={{
          position: "fixed",
          left: cursorPos.x,
          top: cursorPos.y,
          width: eraserSize * (canvasRef.current
            ? canvasRef.current.getBoundingClientRect().width / canvasRef.current.width
            : 1),
          height: eraserSize * (canvasRef.current
            ? canvasRef.current.getBoundingClientRect().height / canvasRef.current.height
            : 1),
          borderRadius: "50%",
          border: "2px solid rgba(236,72,153,0.8)",
          background: "rgba(236,72,153,0.1)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 9999,
          mixBlendMode: "screen",
        }} />
      )}

      <input
        id="fileInput"
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={e => handleFile(e.target.files[0])}
      />
    </div>
  );
                  }
