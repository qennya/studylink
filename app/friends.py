from flask import Blueprint, request, jsonify
from bson import ObjectId

from .db import get_db
from .auth import require_auth

friends_bp = Blueprint("friends", __name__)

@friends_bp.post("/friends/add")
@require_auth
def add_friend():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"error": "Friend email is required."}), 400

    db = get_db()

    me = db.users.find_one({"_id": ObjectId(request.user_id)})
    if not me:
        return jsonify({"error": "User not found."}), 404

    friend = db.users.find_one({"email": email})
    if not friend:
        return jsonify({"error": "No user found with that email."}), 404

    friend_id = str(friend["_id"])
    if friend_id == request.user_id:
        return jsonify({"error": "You can’t add yourself as a friend."}), 400

    # One-way: store friendId in my document
    db.users.update_one(
        {"_id": ObjectId(request.user_id)},
        {"$addToSet": {"friendIds": friend_id}}
    )

    return jsonify({
        "ok": True,
        "friend": {
            "id": friend_id,
            "email": friend.get("email", ""),
            "displayName": friend.get("displayName", ""),
        }
    }), 201

@friends_bp.get("/friends")
@require_auth
def list_friends():
    db = get_db()
    me = db.users.find_one({"_id": ObjectId(request.user_id)}, {"friendIds": 1})
    if not me:
        return jsonify({"error": "User not found."}), 404

    friend_ids = me.get("friendIds", [])
    if not friend_ids:
        return jsonify({"friends": []})

    friends = []
    for u in db.users.find({"_id": {"$in": [ObjectId(fid) for fid in friend_ids]}}, {"passwordHash": 0}):
        friends.append({
            "id": str(u["_id"]),
            "email": u.get("email", ""),
            "displayName": u.get("displayName", ""),
        })

    return jsonify({"friends": friends})