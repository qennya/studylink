const StudyLink = (() => {
    const API = (path) => path.startsWith("/api") ? path : `/api${path}`;
    const tokenKey = "studylink_token";

    function getToken() { return localStorage.getItem(tokenKey); }
    function setToken(t) { localStorage.setItem(tokenKey, t); }
    function clearToken(){ localStorage.removeItem(tokenKey); }

    async function apiFetch(path, opts = {}) {
        const headers = opts.headers || {};
        headers["Content-Type"] = "application/json";
        const t = getToken();
        if (t) headers["Authorization"] = `Bearer ${t}`;
        const res = await fetch(path, { ...opts, headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Request failed");
        return data;
    }

    function requireLogin() {
        if (!getToken()) window.location.href = "/login";
    }

    async function initLogin(){
        const form = document.getElementById("loginForm");
        const msg = document.getElementById("msg");
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            msg.textContent = "";
            const body = {
                email: form.email.value,
                password: form.password.value,
            };
            try {
                const data = await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
                setToken(data.token);
                window.location.href = "/dashboard";
            } catch (err) {
                msg.textContent = err.message;
            }
        });
    }

    async function initRegister(){
        const form = document.getElementById("registerForm");
        const msg = document.getElementById("msg");
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            msg.textContent = "";
            const body = {
                displayName: form.displayName.value,
                email: form.email.value,
                password: form.password.value,
            };
            try {
                const data = await apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
                setToken(data.token);
                window.location.href = "/dashboard";
            } catch (err) {
                msg.textContent = err.message;
            }
        });
    }

    async function initDashboard(){
        requireLogin();
        const meEl = document.getElementById("me");
        const listEl = document.getElementById("activeSessions");

        async function refreshMe(){
            try {
                const data = await apiFetch("/api/auth/me");
                meEl.textContent = `Logged in as ${data.user.displayName} (${data.user.email})`;
            } catch {
                clearToken();
                window.location.href = "/login";
            }
        }

        async function refreshSessions(){
            const data = await apiFetch("/api/sessions/active");
            listEl.innerHTML = "";
            if (!data.sessions.length) {
                listEl.innerHTML = `<div class="item muted">No active sessions right now.</div>`;
                return;
            }
            data.sessions.forEach(s => {
                const el = document.createElement("div");
                el.className = "item";
                el.innerHTML = `
          <div class="row space">
            <div>
              <div><strong>${s.title}</strong></div>
              <div class="muted">${s.participants} participant(s)</div>
            </div>
            <a class="btn" href="/session/${s.id}">Open</a>
          </div>
        `;
                listEl.appendChild(el);
            });
        }

        await refreshMe();
        await loadFriends();
        await refreshSessions();
        setInterval(refreshSessions, 10000);
    }

    async function startSession(){
        requireLogin();
        const title = document.getElementById("sessionTitle").value || "Study Session";
        const data = await apiFetch("/api/sessions", { method:"POST", body: JSON.stringify({ title }) });
        window.location.href = `/session/${data.sessionId}`;
    }

    async function initSession(sessionId){
        requireLogin();
        document.getElementById("sid").textContent = sessionId;

        async function refresh(){
            const data = await apiFetch(`/api/sessions/${sessionId}`);
            document.getElementById("title").textContent = data.session.title || "Session";
            const s = data.session;
            document.getElementById("sessionMeta").textContent =
                `Active: ${s.active} • Participants: ${s.participantIds.length}`;

            const eventsEl = document.getElementById("events");
            eventsEl.innerHTML = "";
            data.events.reverse().forEach(ev => {
                const el = document.createElement("div");
                el.className = "item";
                el.innerHTML = `<div><strong>${ev.type}</strong> — ${ev.value || ""}</div>
                        <div class="muted">${ev.timestamp}</div>`;
                eventsEl.appendChild(el);
            });
        }

        window.StudyLinkSession = { sessionId, refresh };
        await refresh();
        setInterval(refresh, 7000);
    }

    async function joinSession(){
        const { sessionId } = window.StudyLinkSession;
        await apiFetch(`/api/sessions/${sessionId}/join`, { method:"POST" });
        await window.StudyLinkSession.refresh();
    }

    async function setStatus(){
        const { sessionId } = window.StudyLinkSession;
        const status = document.getElementById("statusSelect").value;
        await apiFetch(`/api/sessions/${sessionId}/status`, { method:"POST", body: JSON.stringify({ status }) });
        await window.StudyLinkSession.refresh();
    }

    async function endSession(){
        const { sessionId } = window.StudyLinkSession;
        await apiFetch(`/api/sessions/${sessionId}/end`, { method:"POST" });
        window.location.href = `/summary/${sessionId}`;
    }
    async function addFriend(){
        requireLogin();
        const email = document.getElementById("friendEmail").value.trim();
        const msg = document.getElementById("friendMsg");
        msg.textContent = "";

        if (!email) {
            msg.textContent = "Enter an email.";
            return;
        }

        try {
            const data = await apiFetch("/api/friends/add", {
                method: "POST",
                body: JSON.stringify({ email })
            });
            msg.textContent = `Added: ${data.friend.displayName || data.friend.email}`;
            document.getElementById("friendEmail").value = "";
            await loadFriends();
        } catch (err) {
            msg.textContent = err.message;
        }
    }

    async function loadFriends(){
        const list = document.getElementById("friendsList");
        if (!list) return;

        try {
            const data = await apiFetch("/api/friends");
            list.innerHTML = "";
            if (!data.friends.length) {
                list.innerHTML = `<div class="item muted">No friends added yet.</div>`;
                return;
            }
            data.friends.forEach(f => {
                const el = document.createElement("div");
                el.className = "item";
                el.innerHTML = `<div><strong>${f.displayName || "Friend"}</strong></div>
                      <div class="muted">${f.email}</div>`;
                list.appendChild(el);
            });
        } catch (e) {
            // If anything goes wrong, keep UI quiet
        }
    }

    async function initSummary(sessionId){
        requireLogin();
        const box = document.getElementById("summary");
        const data = await apiFetch(`/api/sessions/${sessionId}/summary`);
        box.innerHTML = `
      <h2>${data.title}</h2>
      <p class="muted">Session: ${data.sessionId}</p>
      <div class="row">
        <div class="item" style="flex:1">Duration (sec)<br><strong>${data.durationSeconds}</strong></div>
        <div class="item" style="flex:1">Participants<br><strong>${data.participants}</strong></div>
        <div class="item" style="flex:1">Status updates<br><strong>${data.statusUpdates}</strong></div>
      </div>
      <p class="muted">Active: ${data.active}</p>
    `;
    }

    function logout(){
        clearToken();
        window.location.href = "/";
    }

    return {
        initLogin, initRegister, initDashboard, initSession, initSummary,
        startSession, joinSession, setStatus, endSession, logout, addFriend
    };
})();