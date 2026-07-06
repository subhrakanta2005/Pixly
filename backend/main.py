import base64
import io
import ipaddress
import logging
import os
import socket
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlparse

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from core.database import connect_db, close_db, get_db
from core.config import settings
from core.deps import get_optional_user
from core.limits import check_file_size, check_tool_access, check_and_increment_ops
from core.background import start_background_tasks, cleanup_temp_files
from routers import auth as auth_router
from routers import payments as payments_router
from routers.auth import limiter

ADMIN_EMAILS = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}


def get_plan(user) -> str:
    """Returns the user's *effective* plan — falls back to free if their paid
    plan has lapsed, even if the `plan` field on the user doc is stale."""
    if not user:
        return "free"
    if user.get("email", "").lower() in ADMIN_EMAILS:
        return "enterprise"
    plan = user.get("plan", "free")
    if plan == "free":
        return "free"
    expires = user.get("plan_expires_at")
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return "free"
    return plan

logger = logging.getLogger("pixly")

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    logger.warning("pillow-heif not installed — HEIC/HEIF files will not open correctly.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    await cleanup_temp_files()
    app_url = os.getenv("RENDER_EXTERNAL_URL", "")
    start_background_tasks(app_url)
    yield
    await close_db()


app = FastAPI(title="Pixly API", version="1.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(payments_router.router)

UPLOAD_DIR = Path(tempfile.gettempdir()) / "pixly"
UPLOAD_DIR.mkdir(exist_ok=True)


@app.get("/health")
async def health():
    return {"status": "ok"}


# ─── SHARED HELPERS ───────────────────────────────────────────────────────────

def sanitize_filename(name: Optional[str]) -> str:
    base = Path(name or "file").name
    return base or "file"


def new_work_dir() -> Path:
    """Fresh isolated directory per request — only used by html-to-image,
    which needs a real browser context. Everything else stays in memory."""
    return Path(tempfile.mkdtemp(dir=UPLOAD_DIR, prefix=f"{uuid.uuid4().hex}_"))


async def _read_capped(file: UploadFile, cap: int) -> bytes:
    chunks = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > cap:
            raise HTTPException(
                413, f"File exceeds the maximum allowed upload size ({cap // (1024 * 1024)} MB)."
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _apply_checks(size: int, user, tool_id: str):
    await check_file_size(size, user)
    await check_tool_access(tool_id, user)
    db_ref = get_db()
    if db_ref is not None:
        await check_and_increment_ops(user, db_ref, tool_id)


async def intake_bytes(file: UploadFile, user, tool_id: str) -> bytes:
    data = await _read_capped(file, settings.MAX_UPLOAD_BYTES)
    await _apply_checks(len(data), user, tool_id)
    return data


async def intake_bytes_many(files: List[UploadFile], user, tool_id: str) -> List[Tuple[str, bytes]]:
    items = []
    total = 0
    for f in files:
        data = await _read_capped(f, settings.MAX_UPLOAD_BYTES)
        total += len(data)
        if total > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Combined upload size is too large.")
        items.append((sanitize_filename(f.filename), data))
    await _apply_checks(total, user, tool_id)
    return items


def image_response(data: bytes, media_type: str, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def zip_response(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _open_image(data: bytes):
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def _flatten_to_rgb(img, bg_hex: str = "#ffffff"):
    """Flatten an image with an alpha channel onto a solid background —
    needed before saving as JPEG, which has no transparency support."""
    from PIL import Image
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        bg = Image.new("RGB", img.size, bg_hex)
        rgba = img.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        return bg
    return img.convert("RGB")


def _load_font(size: int):
    from PIL import ImageFont
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


# ─── SYNC PROCESSING (run off the event loop via run_in_threadpool) ──────────

def _compress_sync(data: bytes, quality: int, out_format: str, bg_hex: str) -> bytes:
    img = _open_image(data)
    buf = io.BytesIO()
    fmt = out_format.upper()
    if fmt in ("JPEG", "JPG"):
        img = _flatten_to_rgb(img, bg_hex)
        img.save(buf, format="JPEG", quality=quality, optimize=True)
    elif fmt == "WEBP":
        img.save(buf, format="WEBP", quality=quality)
    else:  # PNG — lossless, quality maps loosely to compress_level
        level = max(0, min(9, round((100 - quality) / 11)))
        img.save(buf, format="PNG", optimize=True, compress_level=level)
    return buf.getvalue()


def _resize_sync(
    data: bytes,
    width: Optional[int],
    height: Optional[int],
    percent: Optional[float],
    output_format: Optional[str] = None,
    target_size_kb: Optional[int] = None,
) -> bytes:
    from PIL import Image
    img = _open_image(data)
    ow, oh = img.size
    if percent:
        w, h = max(1, round(ow * percent / 100)), max(1, round(oh * percent / 100))
    else:
        w = width or ow
        h = height or oh
    resized = img.resize((int(w), int(h)), Image.LANCZOS)

    src_fmt = (img.format or "PNG").upper()
    fmt = (output_format or src_fmt).upper()
    if fmt in ("ORIGINAL", ""):
        fmt = src_fmt
    if fmt == "JPG":
        fmt = "JPEG"
    if fmt == "JPEG":
        resized = _flatten_to_rgb(resized)

    if fmt == "JPEG" and target_size_kb:
        target_bytes = max(1, target_size_kb) * 1024
        lo, hi = 5, 95
        best = None
        for _ in range(8):
            mid = (lo + hi) // 2
            test_buf = io.BytesIO()
            resized.save(test_buf, format="JPEG", quality=mid, optimize=True)
            size = test_buf.tell()
            if size <= target_bytes:
                best = test_buf.getvalue()
                lo = mid + 1
            else:
                hi = mid - 1
        if best is None:
            # Even the lowest quality exceeds the target — return best effort
            # rather than silently ignoring the target.
            fallback_buf = io.BytesIO()
            resized.save(fallback_buf, format="JPEG", quality=5, optimize=True)
            best = fallback_buf.getvalue()
        return best, "JPEG"

    buf = io.BytesIO()
    resized.save(buf, format=fmt)
    return buf.getvalue(), fmt


def _crop_sync(data: bytes, x1: int, y1: int, x2: int, y2: int) -> bytes:
    img = _open_image(data)
    cropped = img.crop((x1, y1, x2, y2))
    buf = io.BytesIO()
    fmt = img.format or "PNG"
    cropped.save(buf, format=fmt)
    return buf.getvalue(), fmt


def _rotate_sync(data: bytes, angle: int, flip_h: bool, flip_v: bool) -> bytes:
    from PIL import Image
    img = _open_image(data)
    if angle:
        img = img.rotate(-angle, expand=True)
    if flip_h:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if flip_v:
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
    buf = io.BytesIO()
    fmt = img.format or "PNG"
    img.save(buf, format="PNG" if fmt == "MPO" else fmt)
    return buf.getvalue(), fmt


def _watermark_sync(data: bytes, text: str, opacity: float, position: str, font_size: int) -> bytes:
    from PIL import Image, ImageDraw
    base = _open_image(data).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _load_font(font_size)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    margin = 20
    positions = {
        "center": ((base.width - tw) / 2, (base.height - th) / 2),
        "top-left": (margin, margin),
        "top-right": (base.width - tw - margin, margin),
        "bottom-left": (margin, base.height - th - margin),
        "bottom-right": (base.width - tw - margin, base.height - th - margin),
    }
    xy = positions.get(position, positions["bottom-right"])
    alpha = max(0, min(255, round(opacity * 255)))
    draw.text(xy, text, font=font, fill=(255, 255, 255, alpha))
    draw.text((xy[0] + 1, xy[1] + 1), text, font=font, fill=(0, 0, 0, int(alpha * 0.6)))
    out = Image.alpha_composite(base, overlay)
    buf = io.BytesIO()
    out.convert("RGB").save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _convert_to_jpg_sync(data: bytes, bg_hex: str, quality: int) -> bytes:
    img = _open_image(data)
    img = _flatten_to_rgb(img, bg_hex)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _convert_format_sync(data: bytes, target: str) -> bytes:
    img = _open_image(data)
    buf = io.BytesIO()
    fmt = target.upper()
    if fmt == "JPG":
        fmt = "JPEG"
        img = _flatten_to_rgb(img)
    img.save(buf, format=fmt)
    return buf.getvalue()


def _make_gif_sync(images: List[bytes], duration_ms: int) -> bytes:
    from PIL import Image
    frames = [_open_image(d).convert("RGB") for d in images]
    buf = io.BytesIO()
    frames[0].save(
        buf, format="GIF", save_all=True, append_images=frames[1:],
        duration=duration_ms, loop=0,
    )
    return buf.getvalue()


def _photo_editor_sync(
    data: bytes, brightness: float, contrast: float, saturation: float,
    blur: float, caption: str, caption_color: str, caption_size: int,
) -> bytes:
    from PIL import ImageEnhance, ImageFilter, ImageDraw
    img = _open_image(data).convert("RGB")
    if brightness != 1.0:
        img = ImageEnhance.Brightness(img).enhance(brightness)
    if contrast != 1.0:
        img = ImageEnhance.Contrast(img).enhance(contrast)
    if saturation != 1.0:
        img = ImageEnhance.Color(img).enhance(saturation)
    if blur > 0:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    if caption:
        draw = ImageDraw.Draw(img)
        font = _load_font(caption_size)
        bbox = draw.textbbox((0, 0), caption, font=font)
        tw = bbox[2] - bbox[0]
        xy = ((img.width - tw) / 2, img.height - caption_size - 30)
        draw.text((xy[0] + 2, xy[1] + 2), caption, font=font, fill="black")
        draw.text(xy, caption, font=font, fill=caption_color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _meme_sync(data: bytes, top_text: str, bottom_text: str) -> bytes:
    from PIL import ImageDraw
    img = _open_image(data).convert("RGB")
    draw = ImageDraw.Draw(img)
    font_size = max(24, img.width // 12)
    font = _load_font(font_size)

    def draw_caption(text, y):
        text = text.upper()
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        x = (img.width - tw) / 2
        # Stroke effect: draw black outline by offsetting in 8 directions.
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                if dx or dy:
                    draw.text((x + dx, y + dy), text, font=font, fill="black")
        draw.text((x, y), text, font=font, fill="white")

    if top_text:
        draw_caption(top_text, 14)
    if bottom_text:
        bbox = draw.textbbox((0, 0), bottom_text.upper(), font=font)
        th = bbox[3] - bbox[1]
        draw_caption(bottom_text, img.height - th - 34)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _blur_face_sync(data: bytes, strength: int) -> bytes:
    import cv2
    import numpy as np
    from PIL import Image

    img = _open_image(data).convert("RGB")
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

    k = max(15, strength | 1)  # kernel must be odd
    for (x, y, w, h) in faces:
        roi = arr[y:y + h, x:x + w]
        arr[y:y + h, x:x + w] = cv2.GaussianBlur(roi, (k | 1, k | 1), 0)

    out = Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=92)
    return buf.getvalue(), len(faces)


def _remove_background_sync(data: bytes) -> bytes:
    from rembg import remove
    return remove(data)


def _upscale_sync(data: bytes, factor: int) -> bytes:
    """Classic (non-AI) upscale: Lanczos resampling followed by an unsharp
    mask pass to recover perceived sharpness. Documented as such — this is
    not a neural super-resolution model."""
    from PIL import Image, ImageFilter
    img = _open_image(data)
    w, h = img.size
    max_dim = 6000
    factor = min(factor, max(1, max_dim // max(w, h)))
    upscaled = img.resize((w * factor, h * factor), Image.LANCZOS)
    upscaled = upscaled.filter(ImageFilter.UnsharpMask(radius=2, percent=120, threshold=2))
    buf = io.BytesIO()
    fmt = img.format or "PNG"
    if fmt.upper() in ("JPEG", "JPG"):
        upscaled = _flatten_to_rgb(upscaled)
    upscaled.save(buf, format=fmt)
    return buf.getvalue(), fmt


def _collage_sync(images: List[bytes], columns: int, spacing: int, bg_hex: str, cell_size: int) -> bytes:
    """Lay images out in a fixed-size grid. Each image is resized to fit a
    square cell (cover-crop, not stretched) so mismatched aspect ratios don't
    distort — the same approach a photo collage tool would take."""
    from PIL import Image, ImageOps
    imgs = [_open_image(d).convert("RGB") for d in images]
    columns = max(1, columns)
    rows = (len(imgs) + columns - 1) // columns

    canvas_w = columns * cell_size + (columns + 1) * spacing
    canvas_h = rows * cell_size + (rows + 1) * spacing
    canvas = Image.new("RGB", (canvas_w, canvas_h), bg_hex)

    for idx, img in enumerate(imgs):
        r, c = divmod(idx, columns)
        cell_img = ImageOps.fit(img, (cell_size, cell_size), Image.LANCZOS)
        x = spacing + c * (cell_size + spacing)
        y = spacing + r * (cell_size + spacing)
        canvas.paste(cell_img, (x, y))

    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _images_to_pdf_sync(images: List[bytes], page_fit: bool) -> bytes:
    """Combine one or more images into a single multi-page PDF. Pillow can
    write PDF directly — no separate PDF library needed for this direction."""
    from PIL import Image
    frames = [_open_image(d).convert("RGB") for d in images]
    buf = io.BytesIO()
    frames[0].save(buf, format="PDF", save_all=True, append_images=frames[1:])
    return buf.getvalue()


def _svg_to_raster_sync(data: bytes, out_format: str, width: Optional[int], height: Optional[int]) -> bytes:
    import cairosvg
    kwargs = {}
    if width:
        kwargs["output_width"] = width
    if height:
        kwargs["output_height"] = height
    if out_format == "jpg":
        png_bytes = cairosvg.svg2png(bytestring=data, **kwargs)
        img = _open_image(png_bytes)
        img = _flatten_to_rgb(img)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        return buf.getvalue()
    return cairosvg.svg2png(bytestring=data, **kwargs)


class UnsafeURLError(Exception):
    pass


def _assert_safe_url(url: str) -> None:
    """Blocks SSRF: rejects non-http(s) schemes and any hostname that
    resolves to a private, loopback, link-local, or reserved address
    (localhost, internal Render services, cloud metadata endpoints, etc.)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeURLError("Only http/https URLs are allowed.")
    if not parsed.hostname:
        raise UnsafeURLError("URL has no hostname.")

    try:
        addrs = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        raise UnsafeURLError("Could not resolve hostname.")

    for family, _, _, _, sockaddr in addrs:
        ip = ipaddress.ip_address(sockaddr[0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise UnsafeURLError("URL resolves to a blocked internal address.")


def _html_to_image_sync(html: str, url: str, width: int, height: int, out_format: str) -> bytes:
    """Renders HTML (or a URL) with a headless Chromium via Playwright.
    Requires `playwright install chromium --with-deps` at deploy time — see
    README system dependencies."""
    from playwright.sync_api import sync_playwright

    if url:
        _assert_safe_url(url)  # raises UnsafeURLError before we ever launch a browser

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height})

        # Defense-in-depth: also block at the network layer, since a page
        # can redirect or load sub-resources pointing at an internal address
        # even after the initial URL passed the DNS check above.
        def _guard_route(route):
            try:
                _assert_safe_url(route.request.url)
                route.continue_()
            except UnsafeURLError:
                route.abort()

        page.route("**/*", _guard_route)

        try:
            if url:
                page.goto(url, wait_until="networkidle", timeout=20000)
            else:
                page.set_content(html, wait_until="networkidle")
            screenshot = page.screenshot(
                type="jpeg" if out_format == "jpg" else "png",
                full_page=True,
            )
        finally:
            browser.close()
    return screenshot


def _png_to_svg_sync(data: bytes) -> bytes:
    """Wraps a raster image in a valid SVG container (base64-embedded <image>).

    Honesty note: this is NOT vector tracing — the pixels aren't converted to
    paths/shapes. True bitmap-to-vector tracing needs potrace or vtracer,
    which we deliberately don't depend on (see README). This produces a
    valid, scalable SVG file that embeds the original raster — the same
    technique most free "PNG to SVG" tools use for photos, since true
    tracing only looks good on simple logos/line art anyway.
    """
    img = _open_image(data)
    w, h = img.size
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}">'
        f'<image width="{w}" height="{h}" '
        f'href="data:image/png;base64,{b64}"/></svg>'
    )
    return svg.encode("utf-8")


# ─── ENDPOINTS ────────────────────────────────────────────────────────────────

@app.post("/compress")
async def compress_image(
    file: UploadFile = File(...),
    quality: int = Form(75),
    format: str = Form("jpeg"),
    background: str = Form("#ffffff"),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "compress")
    result = await run_in_threadpool(_compress_sync, data, quality, format, background)
    ext = {"jpeg": "jpg", "webp": "webp", "png": "png"}.get(format.lower(), "jpg")
    media = {"jpg": "image/jpeg", "webp": "image/webp", "png": "image/png"}[ext]
    name = f"compressed-{sanitize_filename(file.filename).rsplit('.', 1)[0]}.{ext}"
    return image_response(result, media, name)


@app.post("/resize")
async def resize_image(
    files: List[UploadFile] = File(...),
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    percent: Optional[float] = Form(None),
    output_format: Optional[str] = Form(None),
    target_size_kb: Optional[int] = Form(None),
    user=Depends(get_optional_user),
):
    items = await intake_bytes_many(files, user, "resize")

    if len(items) == 1:
        name, data = items[0]
        result, fmt = await run_in_threadpool(
            _resize_sync, data, width, height, percent, output_format, target_size_kb,
        )
        media = f"image/{fmt.lower() if fmt else 'png'}"
        ext = fmt.lower() if fmt else None
        out_name = f"resized-{name.rsplit('.', 1)[0]}.{ext}" if ext else f"resized-{name}"
        return image_response(result, media, out_name)

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        for name, data in items:
            result, fmt = await run_in_threadpool(
                _resize_sync, data, width, height, percent, output_format, target_size_kb,
            )
            ext = fmt.lower() if fmt else name.rsplit(".", 1)[-1]
            zf.writestr(f"resized-{name.rsplit('.', 1)[0]}.{ext}", result)
    return zip_response(zip_buf.getvalue(), "resized-batch.zip")


@app.post("/crop")
async def crop_image(
    file: UploadFile = File(...),
    x1: int = Form(...), y1: int = Form(...),
    x2: int = Form(...), y2: int = Form(...),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "crop")
    result, fmt = await run_in_threadpool(_crop_sync, data, x1, y1, x2, y2)
    media = f"image/{fmt.lower() if fmt else 'png'}"
    name = f"cropped-{sanitize_filename(file.filename)}"
    return image_response(result, media, name)


@app.post("/rotate")
async def rotate_image(
    file: UploadFile = File(...),
    angle: int = Form(90),
    flip_h: bool = Form(False),
    flip_v: bool = Form(False),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "rotate")
    result, fmt = await run_in_threadpool(_rotate_sync, data, angle, flip_h, flip_v)
    media = f"image/{fmt.lower() if fmt else 'png'}"
    name = f"rotated-{sanitize_filename(file.filename)}"
    return image_response(result, media, name)


@app.post("/watermark")
async def watermark_image(
    file: UploadFile = File(...),
    text: str = Form("WATERMARK"),
    opacity: float = Form(0.5),
    position: str = Form("bottom-right"),
    font_size: int = Form(36),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "watermark")
    result = await run_in_threadpool(_watermark_sync, data, text, opacity, position, font_size)
    name = f"watermarked-{sanitize_filename(file.filename).rsplit('.', 1)[0]}.jpg"
    return image_response(result, "image/jpeg", name)


@app.post("/convert-to-jpg")
async def convert_to_jpg(
    files: List[UploadFile] = File(...),
    background: str = Form("#ffffff"),
    quality: int = Form(92),
    user=Depends(get_optional_user),
):
    items = await intake_bytes_many(files, user, "convert-to-jpg")
    if len(items) == 1:
        name, data = items[0]
        result = await run_in_threadpool(_convert_to_jpg_sync, data, background, quality)
        out_name = f"{name.rsplit('.', 1)[0]}.jpg"
        return image_response(result, "image/jpeg", out_name)

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        for name, data in items:
            result = await run_in_threadpool(_convert_to_jpg_sync, data, background, quality)
            zf.writestr(f"{name.rsplit('.', 1)[0]}.jpg", result)
    return zip_response(zip_buf.getvalue(), "converted-to-jpg.zip")


@app.post("/convert-from-jpg")
async def convert_from_jpg(
    files: List[UploadFile] = File(...),
    target_format: str = Form("png"),
    gif_frame_ms: int = Form(500),
    user=Depends(get_optional_user),
):
    items = await intake_bytes_many(files, user, "convert-from-jpg")

    if target_format.lower() == "gif" and len(items) > 1:
        result = await run_in_threadpool(_make_gif_sync, [d for _, d in items], gif_frame_ms)
        return image_response(result, "image/gif", "animated.gif")

    if len(items) == 1:
        name, data = items[0]
        result = await run_in_threadpool(_convert_format_sync, data, target_format)
        ext = "jpg" if target_format.lower() == "jpg" else target_format.lower()
        return image_response(result, f"image/{ext}", f"{name.rsplit('.', 1)[0]}.{ext}")

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        for name, data in items:
            result = await run_in_threadpool(_convert_format_sync, data, target_format)
            ext = target_format.lower()
            zf.writestr(f"{name.rsplit('.', 1)[0]}.{ext}", result)
    return zip_response(zip_buf.getvalue(), f"converted-to-{target_format.lower()}.zip")


@app.post("/photo-editor")
async def photo_editor(
    file: UploadFile = File(...),
    brightness: float = Form(1.0),
    contrast: float = Form(1.0),
    saturation: float = Form(1.0),
    blur: float = Form(0),
    caption: str = Form(""),
    caption_color: str = Form("#ffffff"),
    caption_size: int = Form(36),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "photo-editor")
    result = await run_in_threadpool(
        _photo_editor_sync, data, brightness, contrast, saturation, blur,
        caption, caption_color, caption_size,
    )
    name = f"edited-{sanitize_filename(file.filename).rsplit('.', 1)[0]}.jpg"
    return image_response(result, "image/jpeg", name)


@app.post("/meme-generator")
async def meme_generator(
    file: UploadFile = File(...),
    top_text: str = Form(""),
    bottom_text: str = Form(""),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "meme-generator")
    result = await run_in_threadpool(_meme_sync, data, top_text, bottom_text)
    name = f"meme-{sanitize_filename(file.filename).rsplit('.', 1)[0]}.jpg"
    return image_response(result, "image/jpeg", name)


@app.post("/blur-face")
async def blur_face(
    file: UploadFile = File(...),
    strength: int = Form(35),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "blur-face")
    result, face_count = await run_in_threadpool(_blur_face_sync, data, strength)
    name = f"face-blurred-{sanitize_filename(file.filename).rsplit('.', 1)[0]}.jpg"
    resp = image_response(result, "image/jpeg", name)
    resp.headers["X-Faces-Detected"] = str(face_count)
    return resp


@app.post("/remove-background")
async def remove_background(
    file: UploadFile = File(...),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "remove-background")
    result = await run_in_threadpool(_remove_background_sync, data)
    name = f"no-bg-{sanitize_filename(file.filename).rsplit('.', 1)[0]}.png"
    return image_response(result, "image/png", name)


@app.post("/upscale")
async def upscale_image(
    file: UploadFile = File(...),
    factor: int = Form(2),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "upscale")
    result, fmt = await run_in_threadpool(_upscale_sync, data, factor)
    media = f"image/{fmt.lower() if fmt else 'png'}"
    name = f"upscaled-{sanitize_filename(file.filename)}"
    return image_response(result, media, name)


@app.post("/collage")
async def collage_maker(
    files: List[UploadFile] = File(...),
    columns: int = Form(3),
    spacing: int = Form(12),
    background: str = Form("#ffffff"),
    cell_size: int = Form(400),
    user=Depends(get_optional_user),
):
    items = await intake_bytes_many(files, user, "collage")
    if len(items) < 2:
        raise HTTPException(400, "Upload at least 2 images to make a collage.")
    result = await run_in_threadpool(
        _collage_sync, [d for _, d in items], columns, spacing, background, cell_size,
    )
    return image_response(result, "image/jpeg", "collage.jpg")


@app.post("/image-to-pdf")
async def image_to_pdf(
    files: List[UploadFile] = File(...),
    user=Depends(get_optional_user),
):
    items = await intake_bytes_many(files, user, "image-to-pdf")
    result = await run_in_threadpool(_images_to_pdf_sync, [d for _, d in items], True)
    return image_response(result, "application/pdf", "images.pdf")


@app.post("/svg-to-raster")
async def svg_to_raster(
    file: UploadFile = File(...),
    out_format: str = Form("png"),
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    user=Depends(get_optional_user),
):
    data = await intake_bytes(file, user, "svg-to-raster")
    result = await run_in_threadpool(_svg_to_raster_sync, data, out_format, width, height)
    media = "image/jpeg" if out_format == "jpg" else "image/png"
    name = f"{sanitize_filename(file.filename).rsplit('.', 1)[0]}.{out_format}"
    return image_response(result, media, name)


@app.post("/png-to-svg")
async def png_to_svg(file: UploadFile = File(...), user=Depends(get_optional_user)):
    data = await intake_bytes(file, user, "png-to-svg")
    result = await run_in_threadpool(_png_to_svg_sync, data)
    name = f"{sanitize_filename(file.filename).rsplit('.', 1)[0]}.svg"
    return image_response(result, "image/svg+xml", name)


@app.post("/image-converter")
async def image_converter(
    files: List[UploadFile] = File(...),
    target_format: str = Form("png"),
    user=Depends(get_optional_user),
):
    items = await intake_bytes_many(files, user, "image-converter")
    ext = "jpg" if target_format.lower() == "jpg" else target_format.lower()
    media = f"image/{'jpeg' if ext == 'jpg' else ext}"

    if len(items) == 1:
        name, data = items[0]
        result = await run_in_threadpool(_convert_format_sync, data, target_format)
        return image_response(result, media, f"{name.rsplit('.', 1)[0]}.{ext}")

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        for name, data in items:
            result = await run_in_threadpool(_convert_format_sync, data, target_format)
            zf.writestr(f"{name.rsplit('.', 1)[0]}.{ext}", result)
    return zip_response(zip_buf.getvalue(), f"converted-to-{ext}.zip")


@app.post("/html-to-image")
async def html_to_image(
    html: str = Form(""),
    url: str = Form(""),
    width: int = Form(1280),
    height: int = Form(800),
    out_format: str = Form("png"),
    user=Depends(get_optional_user),
):
    if not html and not url:
        raise HTTPException(400, "Provide either html or url")
    # Text input has no file size, but still gate on tool access/quota.
    await check_tool_access("html-to-image", user)
    db_ref = get_db()
    if db_ref is not None:
        await check_and_increment_ops(user, db_ref, "html-to-image")
    try:
        result = await run_in_threadpool(_html_to_image_sync, html, url, width, height, out_format)
    except UnsafeURLError as e:
        raise HTTPException(400, str(e))
    media = "image/jpeg" if out_format == "jpg" else "image/png"
    return image_response(result, media, f"webpage.{out_format}")


@app.post("/info")
async def image_info(file: UploadFile = File(...), user=Depends(get_optional_user)):
    data = await intake_bytes(file, user, "info")
    img = await run_in_threadpool(_open_image, data)
    return {
        "width": img.width,
        "height": img.height,
        "format": img.format,
        "mode": img.mode,
        "size_bytes": len(data),
    }

