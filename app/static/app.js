const StudyLink = (() => {
    const tokenKey = "studylink_token";

    let timerInterval = null;
    let timerMode = "focus";
    let timerSeconds = 25 * 60;
    let timerRunning = false;

    function getToken() {
        return localStorage.getItem(tokenKey);
    }

    function setToken(t) {
        localStorage.setItem(tokenKey, t);
    }

    function clearToken() {
        localStorage.removeItem(tokenKey);
    }

    async function apiFetch(path, opts = {}) {
        const headers = opts.headers || {};
        headers["Content-Type"] = "application/json";

        const token = getToken();
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(path, { ...opts, headers });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.error || "Request failed");
        }

        return data;
    }

    function requireLogin() {
        if (!getToken()) {
            window.location.href = "/login";
        }
    }

    function formatTime(totalSeconds) {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    function updateTimerDisplay() {
        const display = document.getElementById("timerDisplay");
        if (display) {
            display.textContent = formatTime(timerSeconds);
        }
    }

    function setTimerMode(mode) {
        timerMode = mode;
        timerSeconds = mode === "focus" ? 25 * 60 : 5 * 60;
        timerRunning = false;
        clearInterval(timerInterval);
        timerInterval = null;
        updateTimerDisplay();

        const focusBtn = document.getElementById("focusModeBtn");
        const breakBtn = document.getElementById("breakModeBtn");

        if (focusBtn && breakBtn) {
            focusBtn.classList.toggle("active", mode === "focus");
            breakBtn.classList.toggle("active", mode === "break");
        }

        const startBtn = document.getElementById("startTimerBtn");
        if (startBtn) {
            startBtn.textContent = "Start";
        }
    }

    function toggleTimer() {
        const startBtn = document.getElementById("startTimerBtn");
        if (!startBtn) return;

        if (timerRunning) {
            timerRunning = false;
            clearInterval(timerInterval);
            timerInterval = null;
            startBtn.textContent = "Start";
            return;
        }

        timerRunning = true;
        startBtn.textContent = "Pause";

        timerInterval = setInterval(() => {
            if (timerSeconds > 0) {
                timerSeconds -= 1;
                updateTimerDisplay();
            } else {
                clearInterval(timerInterval);
                timerInterval = null;
                timerRunning = false;
                startBtn.textContent = "Start";
                alert(timerMode === "focus" ? "Focus session complete." : "Break complete.");
            }
        }, 1000);
    }

    function resetTimer() {
        setTimerMode(timerMode);
    }

    function setupTimer() {
        const focusBtn = document.getElementById("focusModeBtn");
        const breakBtn = document.getElementById("breakModeBtn");
        const startBtn = document.getElementById("startTimerBtn");
        const resetBtn = document.getElementById("resetTimerBtn");

        if (!focusBtn || !breakBtn || !startBtn || !resetBtn) {
            return;
        }

        focusBtn.addEventListener("click", () => setTimerMode("focus"));
        breakBtn.addEventListener("click", () => setTimerMode("break"));
        startBtn.addEventListener("click", toggleTimer);
        resetBtn.addEventListener("click", resetTimer);

        setTimerMode("focus");
    }

    async function initLogin() {
        const form = document.getElementById("loginForm");
        const msg = document.getElementById("msg");

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            msg.textContent = "";

            try {
                const data = await apiFetch("/api/auth/login", {
                    method: "POST",
                    body: JSON.stringify({
                        email: form.email.value,
                        password: form.password.value
                    })
                });

                setToken(data.token);
                window.location.href = "/dashboard";
            } catch (err) {
                msg.textContent = err.message;
            }
        });
    }

    async function initRegister() {
        const form = document.getElementById("registerForm");
        const msg = document.getElementById("msg");

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            msg.textContent = "";

            try {
                const data = await apiFetch("/api/auth/register", {
                    method: "POST",
                    body: JSON.stringify({
                        displayName: form.displayName.value,
                        email: form.email.value,
                        password: form.password.value
                    })
                });

                setToken(data.token);
                window.location.href = "/dashboard";
            } catch (err) {
                msg.textContent = err.message;
            }
        });
    }

    async function fetchMe() {
        return apiFetch("/api/auth/me");
    }

    async function loadFriends() {
        const list = document.getElementById("friendsList");
        if (!list) return;

        try {
            const data = await apiFetch("/api/friends");
            list.innerHTML = "";

            if (!data.friends.length) {
                list.innerHTML = `<div class="friend-card muted">No friends added yet.</div>`;
                return;
            }

            data.friends.forEach((friend) => {
                const el = document.createElement("div");
                el.className = "friend-card";
                el.innerHTML = `
                    <h3>${friend.displayName || "Friend"}</h3>
                    <div class="card-meta">${friend.email}</div>
                `;
                list.appendChild(el);
            });
        } catch (err) {
            list.innerHTML = `<div class="friend-card muted">Could not load friends.</div>`;
        }
    }

    async function addFriend() {
        requireLogin();

        const emailEl = document.getElementById("friendEmail");
        const msg = document.getElementById("friendMsg");
        const email = emailEl.value.trim();

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
            emailEl.value = "";
            await loadFriends();
        } catch (err) {
            msg.textContent = err.message;
        }
    }

    function renderSessionCards(items, containerId, emptyText = "No active sessions right now.") {
        const listEl = document.getElementById(containerId);
        if (!listEl) return;

        listEl.innerHTML = "";

        if (!items.length) {
            listEl.innerHTML = `<div class="session-card muted">${emptyText}</div>`;
            return;
        }

        items.forEach((session) => {
            const el = document.createElement("div");
            el.className = "session-card";
            el.innerHTML = `
                <h3>${session.title}</h3>
                <div class="card-meta">${session.participants} participant(s)</div>
                <div class="card-actions">
                    <a class="btn" href="/session/${session.id}">Open</a>
                </div>
            `;
            listEl.appendChild(el);
        });
    }

    async function loadActiveSessions(containerId = "activeSessions") {
        const data = await apiFetch("/api/sessions/active");
        renderSessionCards(data.sessions, containerId);
    }

    async function initDashboard() {
        requireLogin();
        setupTimer();

        try {
            const data = await fetchMe();
            const meEl = document.getElementById("me");
            const greetingEl = document.getElementById("dashboardGreeting");

            if (meEl) {
                meEl.textContent = `Logged in as ${data.user.displayName} (${data.user.email})`;
            }

            if (greetingEl) {
                greetingEl.textContent = `Welcome back, ${data.user.displayName}`;
            }
        } catch (err) {
            clearToken();
            window.location.href = "/login";
            return;
        }

        await loadActiveSessions("activeSessions");
        setInterval(() => loadActiveSessions("activeSessions"), 10000);
    }

    async function initStudyRooms() {
        requireLogin();

        try {
            await fetchMe();
        } catch (err) {
            clearToken();
            window.location.href = "/login";
            return;
        }

        await loadActiveSessions("studyRoomsList");
        setInterval(() => loadActiveSessions("studyRoomsList"), 10000);
    }

    async function initFriendsPage() {
        requireLogin();

        try {
            await fetchMe();
        } catch (err) {
            clearToken();
            window.location.href = "/login";
            return;
        }

        await loadFriends();
    }

    async function startSession() {
        requireLogin();

        const titleEl = document.getElementById("sessionTitle");
        const title = titleEl && titleEl.value.trim() ? titleEl.value.trim() : "Study Session";

        const data = await apiFetch("/api/sessions", {
            method: "POST",
            body: JSON.stringify({ title })
        });

        window.location.href = `/session/${data.sessionId}`;
    }

    async function initSession(sessionId) {
        requireLogin();
        document.getElementById("sid").textContent = sessionId;

        async function refresh() {
            const data = await apiFetch(`/api/sessions/${sessionId}`);
            document.getElementById("title").textContent = data.session.title || "Session";

            const s = data.session;
            document.getElementById("sessionMeta").textContent =
                `Active: ${s.active} • Participants: ${s.participantIds.length}`;

            const eventsEl = document.getElementById("events");
            eventsEl.innerHTML = "";

            data.events.reverse().forEach((ev) => {
                const el = document.createElement("div");
                el.className = "item";
                el.innerHTML = `
                    <div><strong>${ev.type}</strong> — ${ev.value || ""}</div>
                    <div class="muted">${ev.timestamp}</div>
                `;
                eventsEl.appendChild(el);
            });
        }

        window.StudyLinkSession = { sessionId, refresh };
        await refresh();
        setInterval(refresh, 7000);
    }

    async function joinSession() {
        const { sessionId } = window.StudyLinkSession;
        await apiFetch(`/api/sessions/${sessionId}/join`, { method: "POST" });
        await window.StudyLinkSession.refresh();
    }

    async function setStatus() {
        const { sessionId } = window.StudyLinkSession;
        const status = document.getElementById("statusSelect").value;

        await apiFetch(`/api/sessions/${sessionId}/status`, {
            method: "POST",
            body: JSON.stringify({ status })
        });

        await window.StudyLinkSession.refresh();
    }

    async function endSession() {
        const { sessionId } = window.StudyLinkSession;
        await apiFetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
        window.location.href = `/summary/${sessionId}`;
    }

    async function initSummary(sessionId) {
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

    function logout() {
        clearToken();
        window.location.href = "/";
    }

    return {
        initLogin,
        initRegister,
        initDashboard,
        initStudyRooms,
        initFriendsPage,
        initSession,
        initSummary,
        startSession,
        joinSession,
        setStatus,
        endSession,
        logout,
        addFriend
    };
})();