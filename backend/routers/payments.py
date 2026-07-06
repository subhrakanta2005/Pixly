import hashlib
import hmac
import json
import os
from datetime import datetime, timezone, timedelta

import razorpay
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.database import get_db
from core.deps import get_current_user

router = APIRouter(prefix="/payments", tags=["payments"])

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")

# Plan prices in paise (INR × 100)
PLAN_PRICES = {
    "pro": {"monthly": 24900, "yearly": 199 * 12 * 100},     # ₹249/mo, ₹199×12/yr
    "team": {"monthly": 59900, "yearly": 479 * 12 * 100},
}


class CreateOrderRequest(BaseModel):
    plan: str
    billing: str = "monthly"


class VerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    plan: str
    billing: str = "monthly"


def rzp_client():
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(501, "Razorpay not configured")
    return razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))


# ─── CREATE ORDER ────────────────────────────────────────────────────────────
@router.post("/create-order")
async def create_order(body: CreateOrderRequest, user=Depends(get_current_user)):
    if body.plan not in PLAN_PRICES:
        raise HTTPException(400, "Invalid plan")
    if body.billing not in ("monthly", "yearly"):
        raise HTTPException(400, "Invalid billing cycle")

    amount = PLAN_PRICES[body.plan][body.billing]
    client = rzp_client()

    order = client.order.create({
        "amount": amount,
        "currency": "INR",
        "receipt": f"{str(user['_id'])}_{body.plan}_{body.billing}",
        "notes": {
            "user_id": str(user["_id"]),
            "plan": body.plan,
            "billing": body.billing,
        },
    })

    return {
        "order_id": order["id"],
        "amount": amount,
        "currency": "INR",
        "key_id": RAZORPAY_KEY_ID,
    }


# ─── VERIFY PAYMENT ──────────────────────────────────────────────────────────
@router.post("/verify")
async def verify_payment(body: VerifyRequest, user=Depends(get_current_user)):
    if not RAZORPAY_KEY_SECRET:
        raise HTTPException(501, "Razorpay not configured")
    if body.plan not in PLAN_PRICES:
        raise HTTPException(400, "Invalid plan")
    if body.billing not in ("monthly", "yearly"):
        raise HTTPException(400, "Invalid billing cycle")

    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(400, "Payment verification failed")

    db = get_db()
    expires = datetime.now(timezone.utc) + (
        timedelta(days=365) if body.billing == "yearly" else timedelta(days=30)
    )

    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "plan": body.plan,
                "plan_billing": body.billing,
                "plan_expires_at": expires,
                "plan_payment_id": body.razorpay_payment_id,
            }
        },
    )

    await db.payments.insert_one({
        "user_id": user["_id"],
        "plan": body.plan,
        "billing": body.billing,
        "razorpay_order_id": body.razorpay_order_id,
        "razorpay_payment_id": body.razorpay_payment_id,
        "amount": PLAN_PRICES[body.plan][body.billing],
        "status": "paid",
        "created_at": datetime.now(timezone.utc),
    })

    return {"success": True, "plan": body.plan}


# ─── WEBHOOK ─────────────────────────────────────────────────────────────────
@router.post("/webhook")
async def razorpay_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")

    webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    if not webhook_secret:
        raise HTTPException(501, "Webhook secret not configured")

    expected = hmac.new(webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(400, "Invalid webhook signature")

    event = json.loads(payload)
    event_type = event.get("event")

    db = get_db()
    if event_type == "payment.captured":
        payment = event["payload"]["payment"]["entity"]
        notes = payment.get("notes", {})
        user_id = notes.get("user_id")
        plan = notes.get("plan")
        if user_id and plan:
            billing = notes.get("billing", "monthly")
            expires = datetime.now(timezone.utc) + (
                timedelta(days=365) if billing == "yearly" else timedelta(days=30)
            )
            await db.users.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"plan": plan, "plan_expires_at": expires}},
            )

    return {"status": "ok"}


# ─── GET SUBSCRIPTION STATUS ─────────────────────────────────────────────────
@router.get("/status")
async def subscription_status(user=Depends(get_current_user)):
    expires = user.get("plan_expires_at")
    return {
        "plan": user.get("plan", "free"),
        "billing": user.get("plan_billing"),
        "expires_at": expires.isoformat() if expires else None,
        "active": expires > datetime.now(timezone.utc) if expires else user.get("plan", "free") == "free",
    }
