import { useState, useRef, useEffect } from "react";
import ThemeToggle from "../components/ThemeToggle";
import { DoneCard } from "./ToolPage";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_FILE_MB = 5;

const SOCIAL_PRESETS = [
  { id: "ig-post", label: "Instagram Post (1080×1080)", w: 1080, h: 1080 },
  { id: "ig-story", label: "Instagram Story (1080×1920)", w: 1080, h: 1920 },
  { id: "fb-cover", label: "Facebook Cover (820×312)", w: 820, h: 312 },
  { id: "fb-post", label: "Facebook Post (1200×630)", w: 1200, h: 630 },
  { id: "twitter-post", label: "X / Twitter Post (1200×675)", w: 1200, h: 675 },
  { id: "linkedin-banner", label: "LinkedIn Banner (1584×396)", w: 1584, h: 396 },
  { id: "youtube-thumb", label: "YouTube Thumbnail (1280×720)", w: 1280, h: 720 },
  { id: "pinterest-pin", label: "Pinterest Pin (1000×1500)", w: 1000, h: 1500 },
];

export default function ResizePage({ tool, onBack }) {
  const [files, setFiles] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [mode, setMode] = useState("size"); // size | percent | social
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [lockRatio, setLockRatio] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(null);
  const [percent, setPercent] = useState(100);
  const [socialPreset, setSocialPreset] = useState(SOCIAL_PRESETS[0].id);
  const [targetSizeKb, setTargetSizeKb] = useState("");
  const [saveAs, setSaveAs] = useState("original");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadName, setDownloadName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef();

  const fileKey = (f) => `${f.name}_${f.size}_${f.lastModified}`;

  useEffect(() => {
    const urls = [];
    files.forEach((f) => {
      const key = fileKey(f);
      if (thumbs[key]) return;
      const url = URL.createObjectURL(f);
      urls.push(url);
      setThumbs((prev) => ({ ...prev, [key]: url }));
    });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  useEffect(() => {
    if (files.length === 1 && !aspectRatio) {
      const img = new Image();
      img.onload = () => {
        setAspectRatio(img.naturalWidth / img.naturalHeight);
        setWidth(img.naturalWidth);
        setHeight(img.naturalHeight);
      };
      img.src = URL.createObjectURL(files[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const handleFiles = (newFiles) => {
    const arr = Array.from(newFiles).filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
    if (arr.length < newFiles.length) {
      setError(`Some files were skipped — the max file size is ${MAX_FILE_MB} MB.`);
    } else {
      setError("");
    }
    if (tool.multiFile) {
      setFiles((prev) => [...prev, ...arr]);
    } else {
      setFiles(arr.slice(0, 1));
      setAspectRatio(null);
    }
  };

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleWidthChange = (v) => {
    setWidth(v);
    if (lockRatio && aspectRatio && v) setHeight(Math.round(v / aspectRatio));
  };
  const handleHeightChange = (v) => {
    setHeight(v);
    if (lockRatio && aspectRatio && v) setWidth(Math.round(v * aspectRatio));
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setStatus("uploading");
    setError("");
    setDownloadUrl(null);

    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));

      if (mode === "percent") {
        form.append("percent", percent);
      } else if (mode === "social") {
        const preset = SOCIAL_PRESETS.find((p) => p.id === socialPreset);
        form.append("width", preset.w);
        form.append("height", preset.h);
      } else {
        if (width) form.append("width", width);
        if (height) form.append("height", height);
      }

      if (saveAs !== "original") form.append("output_format", saveAs);
      if (targetSizeKb) form.append("target_size_kb", targetSizeKb);

      const res = await fetch(`${API}/resize`, { method: "POST", body: form, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Server error" }));
        throw new Error(err.detail || "Resize failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const name = match ? match[1] : "resized-image";

      setDownloadUrl(url);
      setDownloadName(name);
      setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  };

  const reset = () => {
    setFiles([]);
    setThumbs({});
    setStatus("idle");
    setError("");
    setDownloadUrl(null);
    setWidth("");
    setHeight("");
    setAspectRatio(null);
  };

  const tabBtn = (id, label) => (
    <button
      onClick={() => setMode(id)}
      style={{
        padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
        background: mode === id ? tool.color : "transparent",
        color: mode === id ? "#fff" : "var(--text-secondary)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <nav style={{ background: "var(--nav-bg)", borderBottom: "1px solid var(--border)", padding: "0 2rem", display: "flex", alignItems: "center", height: 60, position: "sticky", top: 0, zIndex: 100 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8 }}>
          ← All Tools
        </button>
        <div style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>{tool.icon} {tool.label}</div>
        <ThemeToggle />
      </nav>

      <div style={{ background: `linear-gradient(135deg, ${tool.color} 0%, ${tool.color}cc 100%)`, padding: "40px 2rem", textAlign: "center", color: "#fff" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>{tool.icon}</div>
        <h1 style={{ fontSize: 28, fontFamily: "'Fraunces', serif", fontWeight: 700, margin: "0 0 8px" }}>{tool.label}</h1>
        <p style={{ opacity: 0.92, margin: 0, fontSize: 16 }}>{tool.desc}</p>
        <p style={{ opacity: 0.8, margin: "6px 0 0", fontSize: 13 }}>Max file size: {MAX_FILE_MB} MB</p>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "2rem" }}>
        {status === "done" ? (
          <DoneCard downloadUrl={downloadUrl} downloadName={downloadName} onReset={reset} color={tool.color} />
        ) : (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current.click()}
              style={{
                border: `2px dashed ${isDragging ? tool.color : "var(--border-strong)"}`,
                borderRadius: 16, padding: "3rem 2rem", textAlign: "center", cursor: "pointer",
                background: isDragging ? `${tool.color}11` : "var(--surface)", marginBottom: "1.5rem",
              }}
            >
              <input ref={inputRef} type="file" multiple={tool.multiFile} accept="image/*" style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
              {files.length === 0 ? (
                <>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>📂</div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text-primary)" }}>
                    {tool.multiFile ? "Select images or drag & drop" : "Select an image or drag & drop"}
                  </div>
                </>
              ) : (
                <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center" }}>
                  {files.map((f, i) => (
                    <div key={fileKey(f) + i} style={{ position: "relative", width: 110 }}>
                      <button onClick={() => removeFile(i)} style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12, cursor: "pointer", zIndex: 2 }}>✕</button>
                      <img src={thumbs[fileKey(f)]} alt={f.name} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 8, display: "block" }} />
                    </div>
                  ))}
                  {tool.multiFile && (
                    <div onClick={() => inputRef.current.click()} style={{ width: 110, height: 110, borderRadius: 8, border: `2px dashed ${tool.color}55`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: tool.color, fontSize: 24 }}>＋</div>
                  )}
                </div>
              )}
            </div>

            <div style={{ background: "var(--surface)", borderRadius: 16, padding: "1.5rem", border: "1px solid var(--border)", marginBottom: "1.5rem" }}>
              <h3 style={{ margin: "0 0 1rem", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Resize Settings</h3>
              <div style={{ display: "flex", gap: 4, background: "var(--surface2)", borderRadius: 10, padding: 4, marginBottom: "1.25rem" }}>
                {tabBtn("size", "By Size")}
                {tabBtn("percent", "As Percentage")}
                {tabBtn("social", "Social Media")}
              </div>

              {mode === "size" && (
                <>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={styles.label}>width</label>
                      <div style={{ position: "relative" }}>
                        <input type="number" value={width} onChange={(e) => handleWidthChange(e.target.value)} style={styles.input} />
                        <span style={styles.unit}>px</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 18, color: "var(--text-muted)", paddingBottom: 10 }}>×</div>
                    <div style={{ flex: 1 }}>
                      <label style={styles.label}>height</label>
                      <div style={{ position: "relative" }}>
                        <input type="number" value={height} onChange={(e) => handleHeightChange(e.target.value)} style={styles.input} />
                        <span style={styles.unit}>px</span>
                      </div>
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
                    <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} />
                    Lock aspect ratio
                  </label>
                </>
              )}

              {mode === "percent" && (
                <div>
                  <label style={styles.label}>Scale <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-primary)" }}>{percent}%</span></label>
                  <input type="range" min="1" max="200" value={percent} onChange={(e) => setPercent(e.target.value)} style={{ width: "100%", accentColor: tool.color }} />
                </div>
              )}

              {mode === "social" && (
                <div>
                  <label style={styles.label}>Preset</label>
                  <select value={socialPreset} onChange={(e) => setSocialPreset(e.target.value)} style={styles.input}>
                    {SOCIAL_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div style={{ background: "var(--surface)", borderRadius: 16, padding: "1.5rem", border: "1px solid var(--border)", marginBottom: "1.5rem" }}>
              <h3 style={{ margin: "0 0 1rem", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Export Settings</h3>

              <div style={{ marginBottom: "1rem" }}>
                <label style={styles.label}>Target file size (optional)</label>
                <div style={{ position: "relative" }}>
                  <input
                    type="number"
                    value={targetSizeKb}
                    onChange={(e) => setTargetSizeKb(e.target.value)}
                    placeholder="e.g. 200"
                    style={styles.input}
                  />
                  <span style={styles.unit}>KB</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                  Set a max output file size. Only works for JPG files.
                </div>
              </div>

              <div>
                <label style={styles.label}>Save Image As</label>
                <select value={saveAs} onChange={(e) => setSaveAs(e.target.value)} style={styles.input}>
                  <option value="original">Original</option>
                  <option value="jpg">JPG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WEBP</option>
                </select>
              </div>
            </div>

            {error && (
              <div style={{ background: "#fff0f0", border: "1px solid #fcc", borderRadius: 10, padding: "12px 16px", color: "#c33", marginBottom: "1rem", fontSize: 14 }}>
                ⚠️ {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={files.length === 0 || status === "uploading"}
              style={{
                width: "100%", padding: "16px", borderRadius: 12, border: "none",
                background: files.length === 0 ? "#ccc" : tool.color, color: "#fff",
                fontSize: 16, fontWeight: 700, cursor: files.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              {status === "uploading" ? "⏳ Resizing…" : `${tool.label} →`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "lowercase" },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid var(--border-strong)", background: "var(--input-bg)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" },
  unit: { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)", pointerEvents: "none" },
};

