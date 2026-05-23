import { useState, useRef, useCallback } from "react";

const TOOL = { NONE: "NONE", REMOVE_BG: "REMOVE_BG", ERASER: "ERASER", CROP: "CROP" };

export default function RemoveBGYan() {
  const [hasImage, setHasImage] = useState(false);
  const [activeTool, setActiveTool] = useState(TOOL.NONE);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [eraserSize, setEraserSize] = useState(40);
  const [isDragOver, setIsDragOver] = useState(false);
  const [history, setHistory] = useState([]);

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const isDrawingRef = useRef(false);
  const cropStartRef = useRef(null);
  const lastPosRef = useRef(null);

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
    return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
  };

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 880;
        let w = img.width, h = img.height;
        const r = Math.min(MAX / w, MAX / h, 1);
        w = Math.round(w * r); h = Math.round(h * r);
        const canvas = canvasRef.current;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const overlay = overlayRef.current;
        overlay.width = w; overlay.height = h;
        setHasImage(true);
        setActiveTool(TOOL.NONE);
        setHistory([]);
        setStatusMsg("Gambar berhasil diupload! ✨");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveBG = async () => {
    if (!hasImage || processing) return;
    saveHistory();
    setProcessing(true); setProgress(0);
    setStatusMsg("⏳ Loading AI... bentar ya~");
    setActiveTool(TOOL.REMOVE_BG);
    try {
      const { removeBackground } = await import(
        "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/browser.mjs"
      );
      const canvas = canvasRef.current;
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      setStatusMsg("🪄 Lagi proses nih...");
      const result = await removeBackground(blob, {
        progress: (key, cur, total) => { if (total > 0) setProgress(Math.round((cur / total) * 100)); }
      });
      const url = URL.createObjectURL(result);
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        setStatusMsg("🎉 Background udah hilang!");
      };
      img.src = url;
    } catch (err) {
      setStatusMsg("❌ Gagal nih, coba lagi ya");
    } finally {
      setProcessing(false); setProgress(0);
    }
  };

  const doEraseLine = (from, to) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.lineWidth = eraserSize;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.restore();
  };

  const drawCropOverlay = (start, end) => {
    if (!start || !end) return;
    const overlay = overlayRef.current;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    ctx.clearRect(x, y, w, h);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([cx,cy]) => {
      ctx.fillStyle = "#a855f7"; ctx.fillRect(cx-5, cy-5, 10, 10);
    });
  };

  const applyCrop = (start, end) => {
    if (!start || !end) return;
    const x = Math.round(Math.min(start.x, end.x)), y = Math.round(Math.min(start.y, end.y));
    const w = Math.round(Math.abs(end.x - start.x)), h = Math.round(Math.abs(end.y - start.y));
    if (w < 10 || h < 10) { setStatusMsg("⚠️ Terlalu kecil!"); return; }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(x, y, w, h);
    canvas.width = w; canvas.height = h;
    ctx.putImageData(imageData, 0, 0);
    const overlay = overlayRef.current;
    overlay.width = w; overlay.height = h;
    overlay.getContext("2d").clearRect(0, 0, w, h);
    setStatusMsg(`✂️ Dicrop jadi ${w}×${h}px!`);
  };

  const onPointerDown = (e) => {
    if (!hasImage || processing || activeTool === TOOL.NONE) return;
    e.preventDefault();
    const pos = getPos(e, canvasRef.current);
    isDrawingRef.current = true; lastPosRef.current = pos;
    if (activeTool === TOOL.ERASER) { saveHistory(); doEraseLine(pos, pos); }
    else if (activeTool === TOOL.CROP) cropStartRef.current = pos;
  };

  const onPointerMove = (e) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const pos = getPos(e, canvasRef.current);
    if (activeTool === TOOL.ERASER) { doEraseLine(lastPosRef.current, pos); lastPosRef.current = pos; }
    else if (activeTool === TOOL.CROP) drawCropOverlay(cropStartRef.current, pos);
  };

  const onPointerUp = (e) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (activeTool === TOOL.CROP) {
      const pos = getPos(e, canvasRef.current);
      saveHistory(); applyCrop(cropStartRef.current, pos);
      overlayRef.current.getContext("2d").clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      setActiveTool(TOOL.NONE);
    }
  };

  const handleUndo = () => {
    if (!history.length) return;
    const last = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
      const overlay = overlayRef.current;
      overlay.width = img.width; overlay.height = img.height;
    };
    img.src = last;
    setStatusMsg("↩️ Undo berhasil!");
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.download = "removebg-yan.png";
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
    setStatusMsg("💾 Tersimpan!");
  };

  const cursor = activeTool === TOOL.ERASER ? "crosshair" : activeTool === TOOL.CROP ? "crosshair" : "default";

  const tools = [
    {
      id: TOOL.REMOVE_BG,
      emoji: "🪄",
      label: "Remove BG",
      desc: "Hapus background otomatis",
      color: "#8b5cf6",
      bg: "linear-gradient(135deg, #8b5cf6, #6366f1)",
      action: handleRemoveBG,
    },
    {
      id: TOOL.ERASER,
      emoji: "🧹",
      label: "Eraser",
      desc: "Hapus bagian tertentu",
      color: "#ec4899",
      bg: "linear-gradient(135deg, #ec4899, #f43f5e)",
      action: () => { setActiveTool(TOOL.ERASER); setStatusMsg("🧹 Mode eraser aktif!"); },
    },
    {
      id: TOOL.CROP,
      emoji: "✂️",
      label: "Crop",
      desc: "Potong bagian gambar",
      color: "#f59e0b",
      bg: "linear-gradient(135deg, #f59e0b, #f97316)",
      action: () => { setActiveTool(TOOL.CROP); setStatusMsg("✂️ Drag untuk crop!"); },
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f5f0ff", fontFamily: "'Poppins', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f5f0ff; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer {
          0%{background-position:200% center}
          100%{background-position:-200% center}
        }
        .tool-card { transition: all 0.2s cubic-bezier(.34,1.56,.64,1); }
        .tool-card:hover:not(:disabled) { transform: translateY(-4px) scale(1.02); }
        .tool-card:active:not(:disabled) { transform: scale(0.96); }
        .upload-label { transition: all 0.2s ease; }
        .upload-label:hover { transform: scale(1.01); }
        .checker {
          background-image: linear-gradient(45deg,#e2d9f3 25%,transparent 25%),
            linear-gradient(-45deg,#e2d9f3 25%,transparent 25%),
            linear-gradient(45deg,transparent 75%,#e2d9f3 75%),
            linear-gradient(-45deg,transparent 75%,#e2d9f3 75%);
          background-size: 14px 14px;
          background-position: 0 0,0 7px,7px -7px,-7px 0;
          background-color: #ede9fe;
        }
        .btn-action { transition: all 0.18s ease; }
        .btn-action:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .btn-action:active { transform: scale(0.96); }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{
        background: "white",
        borderBottom: "3px solid #ede9fe",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 2px 12px rgba(139,92,246,0.08)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 42, height: 42,
            background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
            borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1.3rem",
            boxShadow: "0 4px 12px rgba(139,92,246,0.35)",
          }}>🌟</div>
          <div>
            <div style={{
              fontWeight: 800, fontSize: "1.15rem",
              background: "linear-gradient(90deg, #8b5cf6, #ec4899)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              letterSpacing: "-0.02em",
            }}>Remove BG Yan</div>
            <div style={{ fontSize: "0.6rem", color: "#a78bfa", fontWeight: 500, letterSpacing: "0.05em" }}>
              ✨ edit foto gratis
            </div>
          </div>
        </div>

        {hasImage && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-action" onClick={handleUndo} disabled={!history.length}
              style={{
                background: history.length ? "white" : "#f9f5ff",
                border: "2px solid " + (history.length ? "#ddd6fe" : "#ede9fe"),
                color: history.length ? "#7c3aed" : "#c4b5fd",
                borderRadius: 12, padding: "8px 14px",
                cursor: history.length ? "pointer" : "not-allowed",
                fontFamily: "inherit", fontWeight: 600, fontSize: "0.75rem",
              }}>↩ Undo</button>
            <button className="btn-action" onClick={handleDownload}
              style={{
                background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
                border: "none", color: "white",
                borderRadius: 12, padding: "8px 18px",
                cursor: "pointer", fontFamily: "inherit",
                fontWeight: 700, fontSize: "0.75rem",
                boxShadow: "0 4px 14px rgba(139,92,246,0.4)",
              }}>💾 Simpan PNG</button>
          </div>
        )}
      </header>

      <div style={{ display: "flex", minHeight: "calc(100vh - 73px)" }}>

        {/* ── SIDEBAR ── */}
        <aside style={{
          width: 210,
          minWidth: 210,
          background: "white",
          borderRight: "3px solid #ede9fe",
          padding: "20px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          <div style={{
            fontSize: "0.65rem", fontWeight: 700,
            color: "#c4b5fd", letterSpacing: "0.15em",
            paddingLeft: 4, marginBottom: 2,
          }}>TOOLS 🛠️</div>

          {tools.map((t) => (
            <button key={t.id} className="tool-card"
              onClick={t.action}
              disabled={!hasImage || processing}
              style={{
                background: activeTool === t.id
                  ? t.bg
                  : "white",
                border: activeTool === t.id
                  ? "2px solid transparent"
                  : "2px solid #ede9fe",
                borderRadius: 16,
                padding: "12px",
                cursor: !hasImage || processing ? "not-allowed" : "pointer",
                textAlign: "left",
                opacity: !hasImage ? 0.45 : 1,
                boxShadow: activeTool === t.id ? `0 6px 20px ${t.color}40` : "none",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 12,
                  background: activeTool === t.id ? "rgba(255,255,255,0.25)" : t.bg + "20",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.2rem",
                  boxShadow: activeTool === t.id ? "0 2px 8px rgba(0,0,0,0.1)" : "none",
                }}>
                  {t.emoji}
                </div>
                <div>
                  <div style={{
                    fontWeight: 700, fontSize: "0.82rem",
                    color: activeTool === t.id ? "white" : "#3b0764",
                  }}>{t.label}</div>
                  <div style={{
                    fontSize: "0.58rem",
                    color: activeTool === t.id ? "rgba(255,255,255,0.8)" : "#a78bfa",
                    marginTop: 2,
                  }}>{t.desc}</div>
                </div>
              </div>
            </button>
          ))}

          {/* Eraser size */}
          {activeTool === TOOL.ERASER && hasImage && (
            <div style={{
              background: "#fdf4ff",
              border: "2px solid #f0abfc",
              borderRadius: 14, padding: 12,
              animation: "fadeIn 0.25s ease",
            }}>
              <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "#a21caf", marginBottom: 8, letterSpacing: "0.1em" }}>
                UKURAN BRUSH
              </div>
              <input type="range" min={5} max={120} value={eraserSize}
                onChange={e => setEraserSize(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#ec4899", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                <div style={{
                  width: Math.min(eraserSize, 56), height: Math.min(eraserSize, 56),
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #f0abfc50, #ec489950)",
                  border: "2px dashed #ec4899",
                  transition: "all 0.15s",
                }} />
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          <label htmlFor="fileInput" className="upload-label" style={{
            background: "#fdf4ff",
            border: "2px dashed #ddd6fe",
            color: "#7c3aed",
            borderRadius: 14, padding: "10px",
            cursor: "pointer",
            fontFamily: "inherit", fontWeight: 600,
            fontSize: "0.72rem",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            📁 Ganti Gambar
          </label>
        </aside>

        {/* ── MAIN CANVAS AREA ── */}
        <main style={{
          flex: 1, display: "flex",
          flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "28px", gap: 16,
          background: "linear-gradient(135deg, #f5f0ff 0%, #fce7f3 100%)",
          position: "relative",
        }}>

          {/* Decorative blobs */}
          <div style={{
            position: "absolute", width: 300, height: 300,
            background: "radial-gradient(circle, rgba(167,139,250,0.15), transparent 70%)",
            top: -60, right: -60, pointerEvents: "none", borderRadius: "50%",
          }} />
          <div style={{
            position: "absolute", width: 200, height: 200,
            background: "radial-gradient(circle, rgba(244,114,182,0.12), transparent 70%)",
            bottom: 40, left: -40, pointerEvents: "none", borderRadius: "50%",
          }} />

          {/* Status chip */}
          {statusMsg && hasImage && (
            <div style={{
              position: "absolute", top: 16,
              background: "white",
              border: "2px solid #ddd6fe",
              borderRadius: 20, padding: "6px 16px",
              fontSize: "0.72rem", fontWeight: 600, color: "#6d28d9",
              boxShadow: "0 4px 16px rgba(139,92,246,0.12)",
              zIndex: 10, whiteSpace: "nowrap",
              animation: "fadeIn 0.3s ease",
            }}>
              {processing ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 12, height: 12,
                    border: "2.5px solid #ddd6fe",
                    borderTop: "2.5px solid #8b5cf6",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin 0.7s linear infinite",
                  }} />
                  {statusMsg} {progress > 0 && `${progress}%`}
                </span>
              ) : statusMsg}
            </div>
          )}

          {!hasImage ? (
            /* ── UPLOAD ZONE ── */
            <label htmlFor="fileInput" className="upload-label"
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              style={{
                width: "min(520px, 90vw)",
                height: 340,
                background: isDragOver
                  ? "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(236,72,153,0.1))"
                  : "white",
                border: isDragOver ? "3px dashed #8b5cf6" : "3px dashed #ddd6fe",
                borderRadius: 28,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                cursor: "pointer", gap: 14,
                boxShadow: isDragOver
                  ? "0 0 40px rgba(139,92,246,0.2)"
                  : "0 8px 40px rgba(139,92,246,0.08)",
                position: "relative", overflow: "hidden",
                transition: "all 0.25s ease",
              }}>
              {/* Decorative corner dots */}
              {["top:12px;left:12px", "top:12px;right:12px", "bottom:12px;left:12px", "bottom:12px;right:12px"].map((pos, i) => (
                <div key={i} style={{
                  position: "absolute",
                  ...(Object.fromEntries(pos.split(";").map(p => p.split(":")))),
                  width: 8, height: 8, borderRadius: "50%",
                  background: "linear-gradient(135deg, #a78bfa, #f9a8d4)",
                }} />
              ))}

              <div style={{
                width: 80, height: 80, borderRadius: 24,
                background: "linear-gradient(135deg, #ede9fe, #fce7f3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "2.2rem",
                animation: isDragOver ? "bounce 0.6s ease infinite" : "none",
                boxShadow: "0 8px 24px rgba(139,92,246,0.15)",
              }}>
                {isDragOver ? "✨" : "🖼️"}
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#3b0764", marginBottom: 6 }}>
                  {isDragOver ? "Lepas di sini!" : "Upload Gambar"}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#a78bfa", fontWeight: 500 }}>
                  Klik atau drag & drop foto kamu
                </div>
                <div style={{
                  marginTop: 12,
                  display: "flex", gap: 6, justifyContent: "center",
                }}>
                  {["PNG", "JPG", "WEBP"].map(f => (
                    <span key={f} style={{
                      background: "#f5f3ff",
                      border: "1px solid #ddd6fe",
                      color: "#7c3aed",
                      borderRadius: 8,
                      padding: "3px 10px",
                      fontSize: "0.6rem", fontWeight: 700,
                    }}>{f}</span>
                  ))}
                </div>
              </div>
            </label>
          ) : (
            /* ── CANVAS ── */
            <div style={{ position: "relative", borderRadius: 20, overflow: "hidden",
              boxShadow: "0 12px 50px rgba(139,92,246,0.2), 0 0 0 3px #ddd6fe",
            }}>
              <div className="checker" style={{ borderRadius: 18 }}>
                <canvas ref={canvasRef}
                  style={{
                    display: "block", maxWidth: "min(860px, 80vw)",
                    maxHeight: "calc(100vh - 200px)", cursor,
                    touchAction: "none", borderRadius: 18,
                  }}
                  onMouseDown={onPointerDown} onMouseMove={onPointerMove}
                  onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
                  onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp}
                />
              </div>
              <canvas ref={overlayRef}
                style={{
                  position: "absolute", top: 0, left: 0,
                  maxWidth: "100%", maxHeight: "100%", pointerEvents: "none",
                }}
              />
              {processing && (
                <div style={{
                  position: "absolute", inset: 0,
                  background: "rgba(245,240,255,0.85)",
                  backdropFilter: "blur(6px)",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 14,
                  borderRadius: 18,
                }}>
                  <div style={{ fontSize: "2.5rem", animation: "bounce 0.8s ease infinite" }}>🪄</div>
                  <div style={{ fontWeight: 700, color: "#6d28d9", fontSize: "0.9rem" }}>
                    Lagi hapus background...
                  </div>
                  {progress > 0 && (
                    <div style={{ width: 180 }}>
                      <div style={{ height: 8, background: "#ede9fe", borderRadius: 99 }}>
                        <div style={{
                          height: "100%", width: `${progress}%`,
                          background: "linear-gradient(90deg, #8b5cf6, #ec4899)",
                          borderRadius: 99, transition: "width 0.3s",
                        }} />
                      </div>
                      <div style={{ textAlign: "center", fontSize: "0.65rem", color: "#a78bfa", marginTop: 6, fontWeight: 600 }}>
                        {progress}%
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {hasImage && !processing && activeTool === TOOL.NONE && (
            <div style={{
              fontSize: "0.68rem", color: "#c4b5fd", fontWeight: 500,
              background: "white", borderRadius: 20, padding: "5px 14px",
              border: "1px solid #ede9fe",
            }}>
              👈 Pilih tool di samping kiri ya!
            </div>
          )}
        </main>
      </div>

      <input id="fileInput" type="file" accept="image/*"
        style={{ display: "none" }}
        onChange={e => handleFile(e.target.files[0])}
      />
    </div>
  );
}
