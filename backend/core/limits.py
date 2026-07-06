from datetime import date, datetime, timezone
from fastapi import HTTPException

# Plan definitions — single source of truth
PLAN_LIMITS = {
    "free": {
        "max_file_mb": 5,
        "daily_ops": 8,
        "batch_daily": 3,
        "tools": "basic",
    },
    "pro": {
        "max_file_mb": 50,
        "daily_ops": 150,
        "batch_daily": None,
        "tools": "all",
    },
    "team": {
        "max_file_mb": 200,
        "daily_ops": None,
        "batch_daily": None,
        "tools": "all",
    },
    "enterprise": {
        "max_file_mb": None,
        "daily_ops": None,
        "batch_daily": None,
        "tools": "all",
    },
}

# Tools restricted to paid plans — the heaviest / most compute-intensive ones
# (background removal runs a segmentation model, upscale does multi-pass
# resampling + sharpening, html-to-image spins up a headless browser).
PAID_ONLY_TOOLS = {
    "remove-background", "upscale", "html-to-image", "blur-face",
}

# Every tool id used by main.py must be listed here so check_tool_access has a
# complete picture — anything not explicitly paid-only is free.
FREE_TOOLS = {
    "compress", "resize", "crop", "rotate", "convert-to-jpg", "convert-from-jpg",
    "watermark", "photo-editor", "meme-generator", "info",
    "collage", "image-to-pdf", "svg-to-raster", "image-converter",
}


def get_plan(user) -> str:
    """Returns the user's *effective* plan — falls back to free if their paid
    plan has lapsed, even if the `plan` field on the user doc is stale."""
    if not user:
        return "free"
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


def get_limits(user) -> dict:
    return PLAN_LIMITS[get_plan(user)]


async def check_file_size(file_bytes: int, user):
    limits = get_limits(user)
    max_mb = limits["max_file_mb"]
    if max_mb is None:
        return
    max_bytes = max_mb * 1024 * 1024
    if file_bytes > max_bytes:
        raise HTTPException(
            413,
            f"File too large. Your plan allows up to {max_mb} MB. "
            f"Upgrade to Pro for up to 50 MB.",
        )


async def check_tool_access(tool_id: str, user):
    plan = get_plan(user)
    if plan == "free" and tool_id in PAID_ONLY_TOOLS:
        raise HTTPException(
            403,
            f"'{tool_id}' is not available on the Free plan. Upgrade to Pro to unlock all tools.",
        )


async def check_and_increment_ops(user, db, tool_id: str = None):
    """Check daily ops quota and atomically increment the counter.

    Guests are not rate-limited per-request but tool access is still checked
    separately in check_tool_access.
    """
    if not user:
        return

    plan = get_plan(user)
    limits = PLAN_LIMITS[plan]
    today = str(date.today())

    if limits["daily_ops"] is None:
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$inc": {"usage_count": 1, f"daily_usage.{today}": 1}},
        )
        return

    result = await db.users.update_one(
        {
            "_id": user["_id"],
            "$or": [
                {f"daily_usage.{today}": {"$lt": limits["daily_ops"]}},
                {f"daily_usage.{today}": {"$exists": False}},
            ],
        },
        {"$inc": {"usage_count": 1, f"daily_usage.{today}": 1}},
    )

    if result.modified_count == 0:
        raise HTTPException(
            429,
            f"Daily limit reached ({limits['daily_ops']} operations). "
            f"Resets at midnight IST. Upgrade to Pro for more.",
        )
