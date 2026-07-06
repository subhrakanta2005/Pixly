import { useState } from "react";
import { TOOL_CATEGORIES, ALL_TOOLS } from "../tools";
import { useAuth } from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";

export default function HomePage({ onSelectTool, onLogin, onRegister, onPricing, onDashboard }) {
  const { user, logout } = useAuth();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const filtered = ALL_TOOLS.filter((t) => {
    const matchSearch = t.label.toLowerCase().includes(search.toLowerCase()) || t.desc.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === "all" || t.category === activeCategory;
    return matchSearch && matchCat;
  });

  const groupedFiltered = TOOL_CATEGORIES.map((cat) => ({
    ...cat,
    tools: filtered.filter((t) => t.category === cat.id),
  })).filter((cat) => cat.tools.length > 0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <nav style={{ background: "var(--nav-bg)", borderBottom: "1px solid var(--nav-border)", padding: "0 2rem", display: "flex", alignItems: "center", height: 60, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontFamily: "'Fraunces', serif", fontSize: 21, color: "var(--brand)" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", border: "2.5px solid var(--brand)", display: "inline-block", position: "relative" }}>
            <span style={{ position: "absolute", right: -6, bottom: -2, width: 7, height: 2.5, background: "var(--brand)", transform: "rotate(45deg)", borderRadius: 2 }} />
          </span>
          Pixly
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14 }}>
          <span onClick={onPricing} style={{ cursor: "pointer", color: "var(--text-secondary)", fontWeight: 500, fontSize: 14 }}>Pricing</span>
          <ThemeToggle />
          {user ? (
            <>
              <div onClick={onDashboard} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                {user.avatar
                  ? <img src={user.avatar} alt={user.name} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
                  : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>{user.name[0].toUpperCase()}</div>
                }
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{user.name.split(" ")[0]}</span>
              </div>
              <button onClick={logout} style={{ padding: "7px 16px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <button onClick={onLogin} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
                Sign in
              </button>
              <button onClick={onRegister} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                Sign up free
              </button>
            </>
          )}
        </div>
      </nav>

      <div style={{ background: "linear-gradient(135deg, var(--brand) 0%, var(--brand-deep) 100%)", padding: "60px 2rem", textAlign: "center", color: "#fff" }}>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", fontFamily: "'Fraunces', serif", fontWeight: 700, margin: "0 0 12px", letterSpacing: "-1px" }}>
          Every image tool you need
        </h1>
        <p style={{ fontSize: 18, opacity: 0.92, margin: "0 0 32px", fontWeight: 400 }}>
          Compress, resize, convert and edit — with AI background removal and upscaling. Free to start.
        </p>
        <div style={{ maxWidth: 520, margin: "0 auto", position: "relative" }}>
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18, opacity: 0.5 }}>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools… (compress, crop, background)"
            style={{ width: "100%", padding: "14px 18px 14px 46px", borderRadius: 12, border: "none", fontSize: 16, boxSizing: "border-box", boxShadow: "0 4px 20px rgba(0,0,0,0.15)", outline: "none" }}
          />
        </div>
      </div>

      <div style={{ background: "var(--nav-bg)", borderBottom: "1px solid var(--border)", padding: "0 2rem", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 4, minWidth: "max-content", padding: "8px 0" }}>
          {[{ id: "all", label: "All Tools", color: "#8a8496" }, ...TOOL_CATEGORIES].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                padding: "8px 18px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: activeCategory === cat.id ? cat.color || "var(--brand)" : "transparent",
                color: activeCategory === cat.id ? "#fff" : "var(--text-secondary)",
                transition: "all 0.15s",
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
        {groupedFiltered.map((cat) => (
          <div key={cat.id} style={{ marginBottom: "3rem" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 4, height: 20, background: cat.color, borderRadius: 2, display: "inline-block" }} />
              {cat.label}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" }}>
              {cat.tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} color={cat.color} onClick={() => onSelectTool(tool)} />
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
            <p>No tools found for "{search}"</p>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 2rem 3rem" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: "'Fraunces', serif", marginBottom: "1.25rem" }}>
          Work your way
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          <FeatureCard
            icon="⚡"
            title="Fast, in the browser"
            desc="No install, no account required for most tools. Upload a file and get your result in seconds."
          />
          <FeatureCard
            icon="🔒"
            title="Private by default"
            desc="Files are processed and then removed — nothing sits around after your job is done."
          />
          <FeatureCard
            icon="📈"
            title="Built to grow with you"
            desc="Start free, then unlock higher limits and priority processing as you need more."
          />
        </div>

        <div style={{
          background: "linear-gradient(135deg, #0f1b2d 0%, #1c2f4a 100%)",
          borderRadius: 16,
          padding: "2rem 2.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1.5rem",
          marginBottom: "1.5rem",
        }}>
          <div>
            <div style={{ color: "#ff5a7a", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", marginBottom: 8 }}>PREMIUM</div>
            <h3 style={{ color: "#fff", fontSize: 26, fontFamily: "'Fraunces', serif", fontWeight: 700, margin: "0 0 10px" }}>
              Get more out of Pixly
            </h3>
            <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 15, margin: 0, maxWidth: 480 }}>
              Higher file size limits, no wait between jobs, and priority processing on every tool.
            </p>
          </div>
          <button
            onClick={onPricing}
            style={{ padding: "13px 26px", borderRadius: 10, border: "none", background: "#ff3355", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            See plans
          </button>
        </div>

        <a
          href="https://pdftools-henna.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1.5rem",
            flexWrap: "wrap",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "1.75rem 2rem",
            textDecoration: "none",
            marginBottom: "2rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span style={{ fontSize: 28 }}>📄</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: "var(--text-primary)", marginBottom: 4 }}>Also working with PDFs?</div>
              <div style={{ fontSize: 14, color: "var(--text-muted)" }}>Try our PDF toolkit — merge, split, compress and convert just as easily.</div>
            </div>
          </div>
          <span style={{ padding: "10px 20px", borderRadius: 8, border: "1.5px solid var(--border-strong)", color: "var(--text-primary)", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>
            Explore →
          </span>
        </a>

        <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          🔒 Files are processed securely and removed automatically — your images stay private.
        </p>
      </div>

      <footer style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", color: "var(--text-muted)", padding: "3rem 2rem", textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontFamily: "'Fraunces', serif", fontSize: 20, color: "var(--text-primary)", marginBottom: 8 }}>Pixly</div>
        <p style={{ margin: 0, fontSize: 14 }}>Free image tools — compress, resize, crop, convert and more.</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, desc }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.5rem" }}>
      <div style={{ fontSize: 24, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

function ToolCard({ tool, color, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        background: hover ? color : "var(--surface)",
        border: `2px solid ${hover ? color : "var(--border)"}`,
        borderRadius: 14,
        padding: "1.5rem 1.25rem",
        cursor: "pointer",
        transition: "all 0.18s",
        transform: hover ? "translateY(-3px)" : "none",
        boxShadow: hover ? `0 8px 24px ${color}33` : "var(--card-shadow)",
      }}
    >
      {tool.badge && (
        <span style={{ position: "absolute", top: 12, right: 12, background: hover ? "rgba(255,255,255,0.25)" : "var(--mint)", color: hover ? "#fff" : "#04241a", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999 }}>
          {tool.badge}
        </span>
      )}
      <div style={{ fontSize: 26, marginBottom: 10, color: hover ? "#fff" : color }}>{tool.icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: hover ? "#fff" : "var(--text-primary)", marginBottom: 6 }}>{tool.label}</div>
      <div style={{ fontSize: 12, color: hover ? "rgba(255,255,255,0.85)" : "var(--text-muted)", lineHeight: 1.5 }}>{tool.desc}</div>
    </div>
  );
}
