import { useRef, useState } from "react";
import ThemeToggle from "../components/ThemeToggle";

export default function ColorPickerPage({ tool, onBack }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [picked, setPicked] = useState(null); // { hex, rgb }
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef();
  const inputRef = useRef();

  const loadFile = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    setPicked(null);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const maxW = 640;
      const scale = Math.min(1, maxW / img.naturalWidth);
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = url;
  };

  const toHex = (n) => n.toString(16).padStart(2, "0");

  const handleClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    const ctx = canvas.getContext("2d");
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    const entry = { hex, rgb: `rgb(${r}, ${g}, ${b})` };
    setPicked(entry);
    setHistory((prev) => [entry, ...prev.filter((h) => h.hex !== hex)].slice(0, 8));
    setCopied(false);
  };

  const copyHex = () => {
    if (!picked) return;
    navigator.clipboard?.writeText(picked.hex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
        <p style={{ opacity: 0.92, margin: 0, fontSize: 16 }}>{tool.desc} — processed entirely in your browser, nothing is uploaded.</p>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem" }}>
        {!imgUrl ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); loadFile(e.dataTransfer.files[0]); }}
            onClick={() => inputRef.current.click()}
            style={{
              border: `2px dashed ${isDragging ? tool.color : "var(--border-strong)"}`,
              borderRadius: 16, padding: "3rem 2rem", textAlign: "center", cursor: "pointer",
              background: isDragging ? `${tool.color}11` : "var(--surface)",
            }}
          >
            <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => loadFile(e.target.files[0])} />
            <div style={{ fontSize: 44, marginBottom: 12 }}>📂</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text-primary)" }}>Select an image or drag & drop</div>
          </div>
        ) : (
          <>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem", textAlign: "center" }}>
              <canvas
                ref={canvasRef}
                onClick={handleClick}
                style={{ maxWidth: "100%", borderRadius: 10, cursor: "crosshair", border: "1px solid var(--border)" }}
              />
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>Click anywhere on the image to sample that pixel's color.</div>
            </div>

            {picked && (
              <div style={{ display: "flex", alignItems: "center", gap: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
                <div style={{ width: 56, height: 56, borderRadius: 12, background: picked.hex, border: "1px solid var(--border-strong)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text-primary)", fontFamily: "'JetBrains Mono', monospace" }}>{picked.hex}</div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{picked.rgb}</div>
                </div>
                <button
                  onClick={copyHex}
                  style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: tool.color, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                >
                  {copied ? "Copied!" : "Copy hex"}
                </button>
              </div>
            )}

            {history.length > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>Recently picked</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {history.map((h, i) => (
                    <div
                      key={i}
                      onClick={() => { setPicked(h); setCopied(false); }}
                      title={h.hex}
                      style={{ width: 32, height: 32, borderRadius: 8, background: h.hex, border: "1px solid var(--border-strong)", cursor: "pointer" }}
                    />
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => inputRef.current.click()}
              style={{ background: "none", border: "1.5px solid var(--border-strong)", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer" }}
            >
              Choose a different image
            </button>
            <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => loadFile(e.target.files[0])} />
          </>
        )}
      </div>
    </div>
  );
}
