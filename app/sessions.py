from flask import Blueprint, request, jsonify
from bson import ObjectId
import datetime

from .db import get_db
from .auth import require_auth

sessions_bp = Blueprint("sessions", __name__)

def _now():
    return datetime.datetime.utcnow()

def _oid(x: str) -> ObjectId:
    return ObjectId(x)

@sessions_bp.post("/sessions")
@require_auth
def create_session():
    data = request.get_json(force=True) or {}
    title = (data.get("title") or "Study Session").strip()

    db = get_db()
    session = {
        "ownerId": request.user_id,
        "title": title,
        "startedAt": _now(),
        "endedAt": None,
        "active": True,
        "participantIds": [request.user_id],
    }
    res = db.sessions.insert_one(session)
    session_id = str(res.inserted_id)

    db.events.insert_one({
        "sessionId": session_id,
        "userId": request.user_id,
        "type": "JOIN",
        "value": "Owner started session",
        "timestamp": _now(),
    })

    return jsonify({"sessionId": session_id}), 201

@sessions_bp.get("/sessions/active")
@require_auth
def active_sessions():
    db = get_db()

    me = db.users.find_one({"_id": ObjectId(request.user_id)}, {"friendIds": 1})
    if not me:
        return jsonify({"error": "User not found."}), 404

    friend_ids = me.get("friendIds", [])
    if not friend_ids:
        return jsonify({"sessions": []})

    cursor = db.sessions.find(
        {"active": True, "ownerId": {"$in": friend_ids}},
        {"title": 1, "ownerId": 1, "startedAt": 1, "participantIds": 1}
    ).sort("startedAt", -1)

    sessions = []
    for s in cursor:
        sessions.append({
            "id": str(s["_id"]),
            "title": s.get("title", ""),
            "ownerId": s.get("ownerId"),
            "startedAt": s.get("startedAt"),
            "participants": len(s.get("participantIds", [])),
        })

    return jsonify({"sessions": sessions})

@sessions_bp.get("/sessions/<session_id>")
@require_auth
def get_session(session_id: str):
    db = get_db()
    s = db.sessions.find_one({"_id": _oid(session_id)})
    if not s:
        return jsonify({"error": "Session not found."}), 404

    # Recent events for display
    ev = list(db.events.find({"sessionId": session_id}).sort("timestamp", -1).limit(25))
    events = []
    for e in ev:
        events.append({
            "type": e["type"],
            "userId": e.get("userId"),
            "value": e.get("value"),
            "timestamp": e.get("timestamp"),
        })

    return jsonify({
        "session": {
            "id": str(s["_id"]),
            "title": s.get("title", ""),
            "ownerId": s.get("ownerId"),
            "startedAt": s.get("startedAt"),
            "endedAt": s.get("endedAt"),
            "active": s.get("active", False),
            "participantIds": s.get("participantIds", []),
        },
        "events": events
    })

@sessions_bp.post("/sessions/<session_id>/join")
@require_auth
def join_session(session_id: str):
    db = get_db()
    s = db.sessions.find_one({"_id": _oid(session_id)})
    if not s or not s.get("active"):
        return jsonify({"error": "Session not found or not active."}), 404

    db.sessions.update_one(
        {"_id": _oid(session_id)},
        {"$addToSet": {"participantIds": request.user_id}}
    )

    db.events.insert_one({
        "sessionId": session_id,
        "userId": request.user_id,
        "type": "JOIN",
        "value": "Joined silently",
        "timestamp": _now(),
    })

    return jsonify({"ok": True})

@sessions_bp.post("/sessions/<session_id>/status")
@require_auth
def set_status(session_id: str):
    data = request.get_json(force=True) or {}
    status = (data.get("status") or "").strip()
    if not status:
        return jsonify({"error": "Status is required."}), 400

    db = get_db()
    s = db.sessions.find_one({"_id": _oid(session_id)})
    if not s or not s.get("active"):
        return jsonify({"error": "Session not found or not active."}), 404

    if request.user_id not in s.get("participantIds", []):
        return jsonify({"error": "Join the session first."}), 403

    db.events.insert_one({
        "sessionId": session_id,
        "userId": request.user_id,
        "type": "STATUS",
        "value": status,
        "timestamp": _now(),
    })
    return jsonify({"ok": True}), 201

@sessions_bp.post("/sessions/<session_id>/end")
@require_auth
def end_session(session_id: str):
    db = get_db()
    s = db.sessions.find_one({"_id": _oid(session_id)})
    if not s:
        return jsonify({"error": "Session not found."}), 404
    if s.get("ownerId") != request.user_id:
        return jsonify({"error": "Only the owner can end this session."}), 403
    if not s.get("active"):
        return jsonify({"error": "Session already ended."}), 400

    ended_at = _now()
    db.sessions.update_one(
        {"_id": _oid(session_id)},
        {"$set": {"active": False, "endedAt": ended_at}}
    )

    db.events.insert_one({
        "sessionId": session_id,
        "userId": request.user_id,
        "type": "END",
        "value": "Session ended",
        "timestamp": ended_at,
    })

    return jsonify({"ok": True})

@sessions_bp.get("/sessions/<session_id>/summary")
@require_auth
def summary(session_id: str):
    db = get_db()
    s = db.sessions.find_one({"_id": _oid(session_id)})
    if not s:
        return jsonify({"error": "Session not found."}), 404

    started = s.get("startedAt")
    ended = s.get("endedAt") or _now()
    duration_sec = int((ended - started).total_seconds()) if started else 0

    participant_count = len(s.get("participantIds", []))
    status_count = db.events.count_documents({"sessionId": session_id, "type": "STATUS"})

    return jsonify({
        "sessionId": session_id,
        "title": s.get("title", ""),
        "active": s.get("active", False),
        "startedAt": started,
        "endedAt": s.get("endedAt"),
        "durationSeconds": duration_sec,
        "participants": participant_count,
        "statusUpdates": status_count
    })