import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ForgotPasswordPage({ onBack }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Something went wrong. Please try again.");
      }
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.logo}>Pixly</div>
        <h2 style={styles.title}>Reset your password</h2>
        <p style={styles.sub}>Enter your email and we'll send you a reset link</p>

        {sent ? (
          <div style={styles.success}>
            If an account exists for <strong>{email}</strong>, a password reset
            link is on its way. Check your inbox (and spam folder).
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required style={styles.input} />
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button type="submit" disabled={loading} style={styles.submitBtn}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p style={styles.switch}>
          <span onClick={onBack} style={styles.link}>Back to sign in</span>
        </p>
      </div>
    </div>
  );
}

const styles = {
  overlay: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg)", padding: "1rem" },
  card: { background: "var(--surface)", borderRadius: 20, padding: "2.5rem", width: "100%", maxWidth: 420, boxShadow: "var(--card-shadow)", border: "1px solid var(--border)" },
  logo: { fontWeight: 700, fontFamily: "'Fraunces', serif", fontSize: 22, color: "var(--brand)", marginBottom: "1.5rem", textAlign: "center" },
  title: { fontSize: 24, fontWeight: 700, fontFamily: "'Fraunces', serif", color: "var(--text-primary)", margin: "0 0 4px", textAlign: "center" },
  sub: { color: "var(--text-muted)", fontSize: 14, margin: "0 0 1.5rem", textAlign: "center" },
  field: { marginBottom: "1rem" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 },
  input: { width: "100%", padding: "11px 14px", borderRadius: 10, border: "1.5px solid var(--border-strong)", background: "var(--input-bg)", color: "var(--text-primary)", fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "inherit" },
  error: { background: "#fff0f0", border: "1px solid #fcc", borderRadius: 8, padding: "10px 14px", color: "#c33", fontSize: 13, marginBottom: "1rem" },
  success: { background: "#f0fff4", border: "1px solid #b7e4c7", borderRadius: 8, padding: "14px", color: "#1b4332", fontSize: 14, marginBottom: "1rem", lineHeight: 1.5 },
  submitBtn: { width: "100%", padding: "13px", borderRadius: 10, border: "none", background: "var(--brand)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 4 },
  switch: { textAlign: "center", fontSize: 14, color: "var(--text-muted)", marginTop: "1.5rem" },
  link: { color: "var(--brand)", fontWeight: 600, cursor: "pointer" },
};
