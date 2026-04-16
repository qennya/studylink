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
    data         = request.get_json(force=True) or {}
    email        = (data.get("email") or "").strip().lower()
    password     = data.get("password") or ""
    display_name = (data.get("displayName") or "").strip() or email.split("@")[0]

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400

    db = get_db()
    if db.users.find_one({"email": email}):
        return jsonify({"error": "Email already registered."}), 409

    user = {
        "email":        email,
        "passwordHash": generate_password_hash(password),
        "displayName":  display_name,
        "friendIds":    [],
        # Profile fields — empty on registration, filled via /api/auth/profile
        "bio":          "",
        "school":       "",
        "major":        "",
        "pfp_url":      "",
        "inspo_urls":   [],   # list of image URLs for Study Inspo
    }
    res     = db.users.insert_one(user)
    user_id = str(res.inserted_id)
    token   = _make_token(user_id)

    return jsonify({
        "token": token,
        "user": {"id": user_id, "email": email, "displayName": display_name}
    }), 201


@auth_bp.post("/login")
def login():
    data     = request.get_json(force=True) or {}
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    db   = get_db()
    user = db.users.find_one({"email": email})
    if not user or not check_password_hash(user["passwordHash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    user_id = str(user["_id"])
    token   = _make_token(user_id)
    return jsonify({
        "token": token,
        "user": {
            "id":          user_id,
            "email":       user["email"],
            "displayName": user.get("displayName", ""),
        }
    })


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
            payload          = jwt.decode(token, Config.JWT_SECRET, algorithms=["HS256"])
            request.user_id  = payload["sub"]
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired."}), 401
        except Exception:
            return jsonify({"error": "Invalid token."}), 401

        return fn(*args, **kwargs)

    return wrapper


@auth_bp.get("/me")
@require_auth
def me():
    db   = get_db()
    user = db.users.find_one({"_id": ObjectId(request.user_id)}, {"passwordHash": 0})
    if not user:
        return jsonify({"error": "User not found."}), 404

    user["_id"] = str(user["_id"])   # keep as _id so frontend can use it as a key
    user["id"]  = user["_id"]
    return jsonify({"user": user})


@auth_bp.patch("/profile")
@require_auth
def update_profile():
    """
    Update the logged-in user's profile fields.
    Accepts any subset of: displayName, bio, school, major, pfp_url, inspo_urls.
    Only fields present in the request body are updated (PATCH semantics).
    """
    data = request.get_json(force=True) or {}

    allowed = {"displayName", "bio", "school", "major", "pfp_url", "inspo_urls"}
    updates = {}

    for field in allowed:
        if field in data:
            val = data[field]
            # inspo_urls must be a list of strings
            if field == "inspo_urls":
                if isinstance(val, list):
                    updates[field] = [str(u).strip() for u in val if str(u).strip()]
            else:
                updates[field] = str(val).strip()

    if not updates:
        return jsonify({"error": "No valid fields provided."}), 400

    db = get_db()
    db.users.update_one(
        {"_id": ObjectId(request.user_id)},
        {"$set": updates}
    )

    # Return the full updated user doc
    user = db.users.find_one({"_id": ObjectId(request.user_id)}, {"passwordHash": 0})
    user["_id"] = str(user["_id"])
    user["id"]  = user["_id"]
    return jsonify({"ok": True, "user": user})


@auth_bp.get("/friends/active")
@require_auth
def friends_active():
    """
    Returns the user's friends list with their current active-session status.
    Used by the Private Room page to show who's studying right now.
    """
    db         = get_db()
    me_doc     = db.users.find_one({"_id": ObjectId(request.user_id)}, {"friendIds": 1})
    if not me_doc:
        return jsonify({"error": "User not found."}), 404

    friend_ids = me_doc.get("friendIds", [])
    if not friend_ids:
        return jsonify({"friends": []})

    friends = []
    for u in db.users.find(
            {"_id": {"$in": [ObjectId(fid) for fid in friend_ids]}},
            {"passwordHash": 0}
    ):
        uid = str(u["_id"])
        # Check if this friend is currently in an active session
        active_session = db.sessions.find_one(
            {"active": True, "participantIds": uid},
            {"title": 1}
        )
        friends.append({
            "id":            uid,
            "email":         u.get("email", ""),
            "displayName":   u.get("displayName", ""),
            "pfp_url":       u.get("pfp_url", ""),
            "activeSession": {
                "id":    str(active_session["_id"]),
                "title": active_session.get("title", ""),
            } if active_session else None,
        })

    return jsonify({"friends": friends})

@auth_bp.get("/friends/<friend_id>/profile")
@require_auth
def friend_profile(friend_id: str):
    """
    Returns a friend's public profile data for the profile modal.
    Only accessible if the requester has this user in their friendIds.
    """
    db = get_db()

    # Verify they are actually friends
    me = db.users.find_one({"_id": ObjectId(request.user_id)}, {"friendIds": 1})
    if not me:
        return jsonify({"error": "User not found."}), 404
    if friend_id not in me.get("friendIds", []):
        return jsonify({"error": "Not your friend."}), 403

    u = db.users.find_one(
        {"_id": ObjectId(friend_id)},
        {"passwordHash": 0, "email": 0}   # exclude sensitive fields
    )
    if not u:
        return jsonify({"error": "Friend not found."}), 404

    # Cumulative stats
    s = u.get("stats", {})
    total_sec = s.get("totalSeconds", 0)
    hours = total_sec // 3600
    mins  = (total_sec % 3600) // 60
    time_str = f"{hours}hr {mins}min" if hours > 0 else f"{mins}min"

    return jsonify({
        "profile": {
            "id":          str(u["_id"]),
            "displayName": u.get("displayName", ""),
            "pfp_url":     u.get("pfp_url", ""),
            "bio":         u.get("bio", ""),
            "school":      u.get("school", ""),
            "major":       u.get("major", ""),
            "inspo_urls":  u.get("inspo_urls", []),
            "stats": {
                "totalSessions":      s.get("totalSessions", 0),
                "totalTime":          time_str,
                "totalStatusUpdates": s.get("totalStatusUpdates", 0),
            }
        }
    })