from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import datetime
from bson import ObjectId

from .db import get_db
from .config import Config

auth_bp = Blueprint("auth", __name__)

def _make_token(user_id: str) -> str:
    now = datetime.datetime.utcnow()
    exp = now + datetime.timedelta(minutes=Config.JWT_EXPIRES_MIN)
    payload = {"sub": user_id, "iat": now, "exp": exp}
    return jwt.encode(payload, Config.JWT_SECRET, algorithm="HS256")

@auth_bp.post("/register")
def register():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    display_name = (data.get("displayName") or "").strip() or email.split("@")[0]

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400

    db = get_db()
    if db.users.find_one({"email": email}):
        return jsonify({"error": "Email already registered."}), 409

    user = {
        "email": email,
        "passwordHash": generate_password_hash(password),
        "displayName": display_name,
        "friendIds": []  # keep empty for MVP (can add later)
    }
    res = db.users.insert_one(user)
    user_id = str(res.inserted_id)
    token = _make_token(user_id)

    return jsonify({"token": token, "user": {"id": user_id, "email": email, "displayName": display_name}}), 201

@auth_bp.post("/login")
def login():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    db = get_db()
    user = db.users.find_one({"email": email})
    if not user or not check_password_hash(user["passwordHash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    user_id = str(user["_id"])
    token = _make_token(user_id)
    return jsonify({"token": token, "user": {"id": user_id, "email": user["email"], "displayName": user.get("displayName", "")}})

def require_auth(fn):
    """Decorator: requires Authorization: Bearer <token>."""
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing Bearer token."}), 401
        token = auth_header.split(" ", 1)[1].strip()

        try:
            payload = jwt.decode(token, Config.JWT_SECRET, algorithms=["HS256"])
            request.user_id = payload["sub"]
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired."}), 401
        except Exception:
            return jsonify({"error": "Invalid token."}), 401

        return fn(*args, **kwargs)

    return wrapper

@auth_bp.get("/me")
@require_auth
def me():
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(request.user_id)}, {"passwordHash": 0})
    if not user:
        return jsonify({"error": "User not found."}), 404
    user["id"] = str(user.pop("_id"))
    return jsonify({"user": user})