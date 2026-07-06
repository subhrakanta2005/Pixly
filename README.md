# Pixly — Free Online Image Editor

A full-stack image toolkit built on the same architecture as your PDFTools
project: FastAPI backend + React/Vite frontend, MongoDB for users, JWT
cookie auth (email + Google OAuth), Razorpay billing, and a config-driven
tool page that renders a workbench for each tool from a single `tools.js`
list. The auth, payments, database and security layers are carried over
almost unchanged — they don't care whether the files being processed are
PDFs or images. Everything image-specific is new: the processing endpoints
in `backend/main.py`, the tool configs in `frontend/src/tools.js`, and an
`ImageCropSelector` component (a plain-`<img>` version of your PDF page
cropper).

## Tools included

| Tool | Endpoint | Notes |
|---|---|---|
| Compress | `/compress` | Pillow re-encode with quality/format control |
| Resize / Bulk Image Resizer | `/resize` | Pixel dimensions or percent scale; accepts 1 or many files, zips the batch |
| Crop | `/crop` | Drag-select rectangle, pixel coordinates |
| Rotate | `/rotate` | 90°/180°/270° + horizontal/vertical flip |
| Flip Image | `/rotate` | Same endpoint as Rotate, UI locked to flip-only (angle fixed at 0) |
| Watermark | `/watermark` | Text overlay, position, opacity |
| Photo Editor | `/photo-editor` | Brightness/contrast/saturation/blur + caption |
| Meme Generator | `/meme-generator` | Bold top/bottom captions |
| Collage Maker | `/collage` | Grid layout, cover-crops each photo into equal cells |
| Color Picker | *(client-side only)* | Canvas `getImageData` in the browser — no upload at all |
| Convert to JPG / PNG to JPG / WebP to JPG / HEIC to JPG | `/convert-to-jpg` | Batch, background fill for transparency |
| Convert from JPG / JPG to PNG | `/convert-from-jpg` | PNG/WEBP/BMP, or animated GIF from multiple files |
| Image Converter | `/image-converter` | Generic any-format→any-format batch conversion |
| SVG Converter | `/svg-to-raster` | `cairosvg` rasterizes SVG to PNG/JPG |
| Image to PDF | `/image-to-pdf` | Pillow writes a multi-page PDF directly — no PDF library needed |
| Blur Face **(Pro)** | `/blur-face` | OpenCV Haar cascade + Gaussian blur |
| Remove Background **(Pro)** | `/remove-background` | `rembg` (U²-Net) segmentation |
| Upscale / Image Enlarger **(Pro)** | `/upscale` | Lanczos resample + unsharp mask — *not* AI super-resolution, see note below |
| HTML to Image **(Pro)** | `/html-to-image` | Playwright headless Chromium screenshot |

**Not included:** PDF → JPG/PNG (would need a full PDF-rendering dependency
like PyMuPDF/poppler — deliberately scoped out to keep this an image-only
toolkit) and PNG → SVG (bitmap-to-vector tracing has no clean, free solution
comparable to the other conversions here).

**Honesty note on "Upscale":** this uses classic Lanczos resampling plus a
sharpening pass, the same technique described in image editors as "smart
enlarge." It is not a neural super-resolution model. If you want true
AI upscaling later, swap `_upscale_sync` in `main.py` for a Real-ESRGAN
or similar ONNX model — the endpoint contract stays the same.

## Local setup

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
playwright install chromium   # only needed for html-to-image
cp .env.example .env          # fill in MongoDB URL at minimum
uvicorn main:app --reload
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Visit `http://localhost:5173`. The Vite dev server proxies `/api` to the
backend, and `VITE_API_URL` points the frontend's fetch calls directly at
`http://localhost:8000`.

## System dependencies

- **rembg / onnxruntime** — downloads a ~170 MB segmentation model to
  `MODEL_CACHE_DIR` (default `/tmp/pixly-models`) on first use. On Render's
  free tier this re-downloads on every cold start; a paid instance with a
  persistent disk avoids that.
- **Playwright** — needs `playwright install --with-deps chromium` at build
  time (already wired into `render.yaml`). This is the heaviest dependency
  in the stack; if you don't need HTML-to-image, you can drop `playwright`
  from `requirements.txt` and remove the `/html-to-image` route.
- **opencv-python-headless** — used only for face detection in `/blur-face`;
  the headless build avoids pulling in GUI libraries you don't need on a
  server.
- **pillow-heif** — registers HEIC/HEIF support with Pillow at startup
  (`main.py` calls `register_heif_opener()`). If it fails to import, the app
  still starts — HEIC files just won't open correctly until it's installed.
- **cairosvg** — needs the system Cairo graphics library. It's usually
  present on Debian/Ubuntu images (Render's default) but if you deploy
  elsewhere and `/svg-to-raster` fails, install `libcairo2` via apt first.

## Deployment

Same split as your PDF site: **backend → Render**, **frontend → Vercel**.

1. Push this repo to GitHub.
2. On Render: New → Blueprint → point at the repo (`render.yaml` is
   pre-configured). Add your MongoDB URL, Google OAuth, Razorpay and Brevo
   secrets in the dashboard — they're marked `sync: false` so Render
   prompts for them rather than committing them.
3. On Vercel: import the repo, set root directory to `frontend`, add
   `VITE_API_URL` (your Render URL) and `VITE_RAZORPAY_KEY_ID`.
4. Update `GOOGLE_REDIRECT_URI` and Razorpay webhook URL to point at the
   deployed backend once you have its URL.

## Plan limits

Defined once in `backend/core/limits.py`:

- **Free** — 5 MB files, 8 ops/day, 3 batch ops/day, core tools only
- **Pro** (₹249/mo or ₹199×12/yr) — 50 MB files, 150 ops/day, all tools
  including background removal, upscale, HTML-to-image, and face blur
- **Team** (₹599/mo or ₹479×12/yr) — 200 MB files, unlimited ops
- **Enterprise** — custom

Adjust `PLAN_LIMITS` and `PAID_ONLY_TOOLS` in that one file to change what's
gated.

## What's genuinely reused vs. new

**Reused near-verbatim** (rebranded, otherwise unchanged): `core/config.py`,
`core/database.py`, `core/deps.py`, `core/email.py`, `core/security.py`,
`core/background.py`, `models/user.py`, `routers/auth.py`,
`routers/payments.py`, `context/AuthContext.jsx`, `context/ThemeContext.jsx`,
`components/ThemeToggle.jsx`, `App.jsx`, `main.jsx`, and the auth/pricing/
dashboard pages (styling ported to CSS variables for dark-mode support,
copy and numbers updated).

**New for this project**: `main.py` endpoints and all `_*_sync` processing
functions, `core/limits.py` tool list, `tools.js`, `ToolPage.jsx` (file
handling simplified since images don't need PDF.js thumbnails),
`ImageCropSelector.jsx`, and `HomePage.jsx` copy/categories.
