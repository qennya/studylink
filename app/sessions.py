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
    data      = request.get_json(force=True) or {}
    title     = (data.get("title") or "Study Session").strip()
    cover_url   = (data.get("coverImage")   or "").strip()
    description = (data.get("description")  or "").strip()

    db = get_db()
    session = {
        "ownerId":        request.user_id,
        "title":          title,
        "coverImage":     cover_url,
        "description":    description,
        "startedAt":      _now(),
        "endedAt":        None,
        "active":         True,
        "participantIds": [request.user_id],
    }
    res        = db.sessions.insert_one(session)
    session_id = str(res.inserted_id)

    db.events.insert_one({
        "sessionId": session_id,
        "userId":    request.user_id,
        "type":      "JOIN",
        "value":     "Owner started session",
        "timestamp": _now(),
    })

    return jsonify({"sessionId": session_id}), 201


@sessions_bp.get("/sessions/active")
@require_auth
def active_sessions():
    """
    Returns ALL currently active sessions (not just friends').
    The design shows a public lobby of study rooms anyone can join.
    """
    db = get_db()

    cursor = db.sessions.find(
        {"active": True},
        {"title": 1, "ownerId": 1, "startedAt": 1,
         "participantIds": 1, "coverImage": 1}
    ).sort("startedAt", -1)

    sessions = []
    for s in cursor:
        sessions.append({
            "id":           str(s["_id"]),
            "title":        s.get("title", ""),
            "ownerId":      s.get("ownerId"),
            "startedAt":    s.get("startedAt"),
            "participants": len(s.get("participantIds", [])),
            "coverImage":   s.get("coverImage", ""),
        })

    return jsonify({"sessions": sessions})


@sessions_bp.get("/sessions/<session_id>")
@require_auth
def get_session(session_id: str):
    db = get_db()
    s  = db.sessions.find_one({"_id": _oid(session_id)})
    if not s:
        return jsonify({"error": "Session not found."}), 404

    ev     = list(db.events.find({"sessionId": session_id}).sort("timestamp", -1).limit(50))
    events = []
    for e in ev:
        # Resolve display name for each event user
        user_name = e.get("userId", "")
        try:
            u = db.users.find_one({"_id": ObjectId(e["userId"])}, {"displayName": 1, "pfp_url": 1})
            if u:
                user_name = u.get("displayName", user_name)
        except Exception:
            pass

        events.append({
            "type":      e["type"],
            "userId":    e.get("userId"),
            "userName":  user_name,
            "value":     e.get("value"),
            "timestamp": e.get("timestamp"),
        })

    # Resolve participant details
    participants = []
    for pid in s.get("participantIds", []):
        try:
            u = db.users.find_one({"_id": ObjectId(pid)},
                                  {"displayName": 1, "pfp_url": 1})
            if u:
                # Get that user's latest STATUS event in this session
                latest_status_ev = db.events.find_one(
                    {"sessionId": session_id, "userId": pid, "type": "STATUS"},
                    sort=[("timestamp", -1)]
                )
                participants.append({
                    "id":          pid,
                    "displayName": u.get("displayName", ""),
                    "pfp_url":     u.get("pfp_url", ""),
                    "isOwner":     pid == s.get("ownerId"),
                    "status":      latest_status_ev["value"] if latest_status_ev else "",
                })
        except Exception:
            pass

    return jsonify({
        "session": {
            "id":             str(s["_id"]),
            "title":          s.get("title", ""),
            "ownerId":        s.get("ownerId"),
            "coverImage":     s.get("coverImage", ""),
            "description":    s.get("description", ""),
            "startedAt":      s.get("startedAt"),
            "endedAt":        s.get("endedAt"),
            "active":         s.get("active", False),
            "participantIds": s.get("participantIds", []),
        },
        "participants": participants,
        "events":       events,
    })


@sessions_bp.post("/sessions/<session_id>/join")
@require_auth
def join_session(session_id: str):
    db = get_db()
    s  = db.sessions.find_one({"_id": _oid(session_id)})
    if not s or not s.get("active"):
        return jsonify({"error": "Session not found or not active."}), 404

    db.sessions.update_one(
        {"_id": _oid(session_id)},
        {"$addToSet": {"participantIds": request.user_id}}
    )

    # Resolve display name for the join event
    u = db.users.find_one({"_id": ObjectId(request.user_id)}, {"displayName": 1})
    name = u.get("displayName", "Someone") if u else "Someone"

    db.events.insert_one({
        "sessionId": session_id,
        "userId":    request.user_id,
        "type":      "JOIN",
        "value":     f"{name} joined",
        "timestamp": _now(),
    })

    return jsonify({"ok": True})


@sessions_bp.post("/sessions/<session_id>/status")
@require_auth
def set_status(session_id: str):
    data   = request.get_json(force=True) or {}
    status = (data.get("status") or "").strip()
    if not status:
        return jsonify({"error": "Status is required."}), 400

    db = get_db()
    s  = db.sessions.find_one({"_id": _oid(session_id)})
    if not s or not s.get("active"):
        return jsonify({"error": "Session not found or not active."}), 404

    if request.user_id not in s.get("participantIds", []):
        return jsonify({"error": "Join the session first."}), 403

    db.events.insert_one({
        "sessionId": session_id,
        "userId":    request.user_id,
        "type":      "STATUS",
        "value":     status,
        "timestamp": _now(),
    })
    return jsonify({"ok": True}), 201




@sessions_bp.patch("/sessions/<session_id>")
@require_auth
def edit_session(session_id: str):
    """
    Owner-only: edit title, coverImage, and/or description of an active session.
    """
    db = get_db()
    s  = db.sessions.find_one({"_id": _oid(session_id)})
    if not s:
        return jsonify({"error": "Session not found."}), 404
    if s.get("ownerId") != request.user_id:
        return jsonify({"error": "Only the owner can edit this session."}), 403

    data    = request.get_json(force=True) or {}
    updates = {}

    if "title" in data:
        title = (data["title"] or "").strip()
        if title:
            updates["title"] = title

    if "coverImage" in data:
        updates["coverImage"] = (data["coverImage"] or "").strip()

    if "description" in data:
        updates["description"] = (data["description"] or "").strip()

    if not updates:
        return jsonify({"error": "No valid fields provided."}), 400

    db.sessions.update_one({"_id": _oid(session_id)}, {"$set": updates})

    # Log the edit as an event
    u    = db.users.find_one({"_id": ObjectId(request.user_id)}, {"displayName": 1})
    name = u.get("displayName", "Owner") if u else "Owner"
    db.events.insert_one({
        "sessionId": session_id,
        "userId":    request.user_id,
        "type":      "STATUS",
        "value":     f"{name} updated the room",
        "timestamp": _now(),
    })

    return jsonify({"ok": True, "updates": updates})

@sessions_bp.post("/sessions/<session_id>/leave")
@require_auth
def leave_session(session_id: str):
    """
    Called when a participant navigates away from a session.
    - Removes user from participantIds
    - Transfers ownership if owner left and others remain
    - Closes room if last person left
    - Returns per-session stats for the leaving user (for summary modal)
    - Persists stats to user doc for cumulative Private Room display
    """
    db = get_db()
    s  = db.sessions.find_one({"_id": _oid(session_id)})
    if not s or not s.get("active"):
        return jsonify({"ok": True})   # already gone, no-op

    now          = _now()
    user_id      = request.user_id
    participants = s.get("participantIds", [])
    is_owner     = s.get("ownerId") == user_id

    # Resolve display name + profile for summary modal
    u    = db.users.find_one({"_id": ObjectId(user_id)},
                             {"displayName": 1, "pfp_url": 1, "bio": 1,
                              "school": 1, "major": 1})
    name = u.get("displayName", "Someone") if u else "Someone"

    # ── Per-session stats for this user ────────────────────────
    # Time in room: from their earliest JOIN event to now
    join_ev = db.events.find_one(
        {"sessionId": session_id, "userId": user_id, "type": "JOIN"},
        sort=[("timestamp", 1)]
    )
    joined_at    = join_ev["timestamp"] if join_ev else s.get("startedAt") or now
    duration_sec = max(0, int((now - joined_at).total_seconds()))

    # Status updates sent by this user in this session
    user_status_count = db.events.count_documents(
        {"sessionId": session_id, "userId": user_id, "type": "STATUS"}
    )

    # ── Persist cumulative stats to user doc ────────────────────
    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$inc": {
            "stats.totalSessions":    1,
            "stats.totalSeconds":     duration_sec,
            "stats.totalStatusUpdates": user_status_count,
        }}
    )

    # ── Room cleanup logic ──────────────────────────────────────
    remaining = [p for p in participants if p != user_id]

    if not remaining:
        db.sessions.update_one(
            {"_id": _oid(session_id)},
            {"$set": {"active": False, "endedAt": now, "participantIds": []}}
        )
        db.events.insert_one({
            "sessionId": session_id, "userId": user_id,
            "type": "END", "value": f"{name} left — room closed",
            "timestamp": now,
        })
        action = "closed"

    elif is_owner:
        new_owner     = remaining[0]
        new_owner_doc = db.users.find_one({"_id": ObjectId(new_owner)}, {"displayName": 1})
        new_owner_name = new_owner_doc.get("displayName", "someone") if new_owner_doc else "someone"

        db.sessions.update_one(
            {"_id": _oid(session_id)},
            {"$set": {"participantIds": remaining, "ownerId": new_owner}}
        )
        db.events.insert_one({
            "sessionId": session_id, "userId": user_id,
            "type": "END", "value": f"{name} left — {new_owner_name} is now owner",
            "timestamp": now,
        })
        action = "ownership_transferred"

    else:
        db.sessions.update_one(
            {"_id": _oid(session_id)},
            {"$set": {"participantIds": remaining}}
        )
        db.events.insert_one({
            "sessionId": session_id, "userId": user_id,
            "type": "END", "value": f"{name} left",
            "timestamp": now,
        })
        action = "left"

    # ── Return session summary for the modal ────────────────────
    return jsonify({
        "ok":     True,
        "action": action,
        "sessionSummary": {
            "title":          s.get("title", "Study Session"),
            "durationSeconds": duration_sec,
            "statusUpdates":  user_status_count,
        },
        "user": {
            "displayName": u.get("displayName", "") if u else "",
            "pfp_url":     u.get("pfp_url", "")     if u else "",
            "bio":         u.get("bio", "")          if u else "",
            "school":      u.get("school", "")       if u else "",
            "major":       u.get("major", "")        if u else "",
        }
    })


@sessions_bp.post("/sessions/<session_id>/end")
@require_auth
def end_session(session_id: str):
    db = get_db()
    s  = db.sessions.find_one({"_id": _oid(session_id)})
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
        "userId":    request.user_id,
        "type":      "END",
        "value":     "Session ended",
        "timestamp": ended_at,
    })

    return jsonify({"ok": True})


@sessions_bp.get("/sessions/<session_id>/summary")
@require_auth
def summary(session_id: str):
    db = get_db()
    s  = db.sessions.find_one({"_id": _oid(session_id)})
    if not s:
        return jsonify({"error": "Session not found."}), 404

    started      = s.get("startedAt")
    ended        = s.get("endedAt") or _now()
    duration_sec = int((ended - started).total_seconds()) if started else 0

    return jsonify({
        "sessionId":     session_id,
        "title":         s.get("title", ""),
        "active":        s.get("active", False),
        "startedAt":     started,
        "endedAt":       s.get("endedAt"),
        "durationSeconds": duration_sec,
        "participants":  len(s.get("participantIds", [])),
        "statusUpdates": db.events.count_documents(
            {"sessionId": session_id, "type": "STATUS"}
        ),
    })


@sessions_bp.get("/user-stats")
@require_auth
def user_stats():
    """
    Returns cumulative study stats for the logged-in user.
    Used by the Private Room page.
    """
    db   = get_db()
    user = db.users.find_one({"_id": ObjectId(request.user_id)}, {"stats": 1})
    if not user:
        return jsonify({"error": "User not found."}), 404

    s = user.get("stats", {})
    return jsonify({
        "stats": {
            "totalSessions":      s.get("totalSessions", 0),
            "totalSeconds":       s.get("totalSeconds", 0),
            "totalStatusUpdates": s.get("totalStatusUpdates", 0),
        }
    })