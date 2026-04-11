const StudyLink = (() => {
    const tokenKey = "studylink_token";

    // ── Timer state ───────────────────────────────────────────
    let timerInterval = null;
    let timerMode     = "focus";
    let timerSeconds  = 25 * 60;
    let timerRunning  = false;

    // ── Tasks state (localStorage, keyed per user) ────────────
    // Format: [{ id, text, done }]
    let _tasksKey = "studylink_tasks_default";

    function tasksKey() { return _tasksKey; }

    function loadTasksFromStorage() {
        try {
            return JSON.parse(localStorage.getItem(tasksKey()) || "[]");
        } catch (_) {
            return [];
        }
    }

    function saveTasksToStorage(tasks) {
        localStorage.setItem(tasksKey(), JSON.stringify(tasks));
    }

    // ── Auth helpers ──────────────────────────────────────────
    function getToken()   { return localStorage.getItem(tokenKey); }
    function setToken(t)  { localStorage.setItem(tokenKey, t); }
    function clearToken() { localStorage.removeItem(tokenKey); }

    function requireLogin() {
        if (!getToken()) window.location.href = "/login";
    }

    async function apiFetch(path, opts = {}) {
        const headers = opts.headers || {};
        headers["Content-Type"] = "application/json";
        const token = getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res  = await fetch(path, { ...opts, headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Request failed");
        return data;
    }

    async function fetchMe() {
        return apiFetch("/api/auth/me");
    }

    // Safe version — never throws, never redirects. Used by base sidebar.
    async function fetchMePublic() {
        try { return await apiFetch("/api/auth/me"); }
        catch (_) { return null; }
    }

    // ── Timer ─────────────────────────────────────────────────
    function formatTime(totalSeconds) {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    function updateTimerDisplay() {
        const display = document.getElementById("timerDisplay");
        if (display) display.textContent = formatTime(timerSeconds);
    }

    function setTimerMode(mode) {
        timerMode    = mode;
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
        if (startBtn) startBtn.textContent = "▷ Start";
    }

    function toggleTimer() {
        const startBtn = document.getElementById("startTimerBtn");
        if (!startBtn) return;

        if (timerRunning) {
            timerRunning = false;
            clearInterval(timerInterval);
            timerInterval = null;
            startBtn.textContent = "▷ Start";
            return;
        }

        timerRunning = true;
        startBtn.textContent = "⏸ Pause";

        timerInterval = setInterval(() => {
            if (timerSeconds > 0) {
                timerSeconds -= 1;
                updateTimerDisplay();
            } else {
                clearInterval(timerInterval);
                timerInterval  = null;
                timerRunning   = false;
                startBtn.textContent = "▷ Start";
                alert(timerMode === "focus" ? "Focus session complete! Take a break." : "Break's over — back to work!");
            }
        }, 1000);
    }

    function resetTimer() { setTimerMode(timerMode); }

    function setupTimer() {
        const focusBtn = document.getElementById("focusModeBtn");
        const breakBtn = document.getElementById("breakModeBtn");
        const startBtn = document.getElementById("startTimerBtn");
        const resetBtn = document.getElementById("resetTimerBtn");
        if (!focusBtn || !breakBtn || !startBtn || !resetBtn) return;

        focusBtn.addEventListener("click", () => setTimerMode("focus"));
        breakBtn.addEventListener("click", () => setTimerMode("break"));
        startBtn.addEventListener("click", toggleTimer);
        resetBtn.addEventListener("click", resetTimer);

        setTimerMode("focus");
    }

    // ── Tasks ─────────────────────────────────────────────────
    function renderTasks() {
        const list = document.getElementById("taskList");
        if (!list) return;

        const tasks = loadTasksFromStorage();
        list.innerHTML = "";

        if (!tasks.length) {
            list.innerHTML = `
                <p class="muted small" style="text-align:center; padding: 14px 0;">
                    No tasks yet — add one below!
                </p>`;
            return;
        }

        tasks.forEach((task) => {
            const el = document.createElement("div");
            el.className = "task-item";
            el.dataset.id = task.id;

            el.innerHTML = `
                <div class="task-checkbox ${task.done ? "checked" : ""}"
                     onclick="StudyLink.toggleTask('${task.id}')"></div>
                <span class="task-label ${task.done ? "done" : ""}">${escapeHtml(task.text)}</span>
                <button
                    onclick="StudyLink.deleteTask('${task.id}')"
                    style="background:none; border:none; cursor:pointer; color:var(--muted-light);
                           font-size:1rem; padding:0 4px; line-height:1; margin-left:auto;"
                    title="Remove task">✕</button>
            `;
            list.appendChild(el);
        });
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function selectCustomStatus(value) {
        // Deselect preset buttons when user types in custom field
        document.querySelectorAll(".status-option[data-status]").forEach(b =>
            b.classList.remove("selected"));
        if (window.StudyLinkSession) {
            window.StudyLinkSession.setSelectedStatus(value.trim());
        }
    }

    function getStatusIcon(status) {
        if (!status) return "";
        const s = status.toLowerCase();
        if (s.includes("break"))    return "☕ ";
        if (s.includes("focus"))    return "🎯 ";
        if (s.includes("music"))    return "🎵 ";
        if (s.includes("energy"))   return "⚡ ";
        if (s.includes("complet"))  return "✅ ";
        if (s.includes("finish"))   return "🏁 ";
        if (s.includes("reading") || s.includes("notes")) return "📖 ";
        if (s.includes("crash") || s.includes("sleep"))   return "⭐ ";
        return "";
    }

    function addTask() {
        const input = document.getElementById("newTaskInput");
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;

        const tasks = loadTasksFromStorage();
        tasks.push({ id: Date.now().toString(), text, done: false });
        saveTasksToStorage(tasks);

        input.value = "";
        cancelAddTask();
        renderTasks();
    }

    function toggleTask(id) {
        const tasks = loadTasksFromStorage().map(t =>
            t.id === id ? { ...t, done: !t.done } : t
        );
        saveTasksToStorage(tasks);
        renderTasks();
    }

    function deleteTask(id) {
        const tasks = loadTasksFromStorage().filter(t => t.id !== id);
        saveTasksToStorage(tasks);
        renderTasks();
    }

    function showAddTaskRow() {
        const row = document.getElementById("addTaskRow");
        if (row) {
            row.style.display = "block";
            const input = document.getElementById("newTaskInput");
            if (input) input.focus();
        }
        const btn = document.getElementById("addTaskBtn");
        if (btn) btn.style.display = "none";
    }

    function cancelAddTask() {
        const row = document.getElementById("addTaskRow");
        if (row) row.style.display = "none";
        const btn = document.getElementById("addTaskBtn");
        if (btn) btn.style.display = "inline-flex";
    }

    function setupTasks(userId) {
        // Namespace tasks per user so different accounts don't share
        if (userId) _tasksKey = `studylink_tasks_${userId}`;

        const addBtn = document.getElementById("addTaskBtn");
        if (addBtn) addBtn.addEventListener("click", showAddTaskRow);

        renderTasks();
    }

    // ── Active sessions (dashboard + study rooms) ─────────────
    function renderSessionCards(items, containerId, emptyText = "No active rooms right now.") {
        const listEl = document.getElementById(containerId);
        if (!listEl) return;
        listEl.innerHTML = "";

        if (!items.length) {
            listEl.innerHTML = `
                <p class="muted small" style="padding:20px 0;">${emptyText}</p>`;
            return;
        }

        // Cycle join button colors across cards — matches design
        const joinColors = [
            { cls: "btn-blue",  label: "Join" },
            { cls: "btn-green", label: "Join" },
            { cls: "btn",       label: "Join" },   // yellow accent
            { cls: "btn-pink",  label: "Join" },
        ];

        items.forEach((session, i) => {
            const color = joinColors[i % joinColors.length];

            const imageHtml = session.coverImage
                ? `<img class="room-card-image"
                        src="${session.coverImage}"
                        alt="${escapeHtml(session.title)}"
                        onerror="this.style.display='none';
                                 this.nextElementSibling.style.display='flex';" />
                   <div class="room-card-image-placeholder" style="display:none;">📚</div>`
                : `<div class="room-card-image-placeholder">📚</div>`;

            const el = document.createElement("div");
            el.className = "room-card";
            el.innerHTML = `
                ${imageHtml}
                <div class="room-card-body">
                    <div class="room-card-title">${escapeHtml(session.title)}</div>
                    <div class="room-card-footer">
                        <span class="room-card-meta">
                            ${session.participants} participant${session.participants !== 1 ? "s" : ""}
                        </span>
                        <a class="btn ${color.cls}" href="/session/${session.id}">${color.label}</a>
                    </div>
                </div>
            `;
            listEl.appendChild(el);
        });
    }

    async function loadActiveSessions(containerId = "activeSessions") {
        try {
            const data = await apiFetch("/api/sessions/active");
            renderSessionCards(data.sessions, containerId);
        } catch (_) {
            // silently fail — will retry on next interval
        }
    }

    // ── Page inits ────────────────────────────────────────────
    async function initDashboard() {
        requireLogin();
        setupTimer();

        // Date display
        const dateEl = document.getElementById("dashboardDate");
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric"
            });
        }

        // Load user info
        try {
            const data = await fetchMe();
            const u = data.user;

            const greetingEl = document.getElementById("dashboardGreeting");
            if (greetingEl) {
                greetingEl.textContent = `Hello, ${u.displayName || "there"}`;
            }

            // Namespace tasks by user id
            setupTasks(u._id || u.id || u.email);

        } catch (err) {
            clearToken();
            window.location.href = "/login";
            return;
        }
    }

    async function initLogin() {
        const form = document.getElementById("loginForm");
        const msg  = document.getElementById("msg");

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            msg.textContent = "";
            try {
                const data = await apiFetch("/api/auth/login", {
                    method: "POST",
                    body: JSON.stringify({
                        email:    form.email.value,
                        password: form.password.value
                    })
                });
                setToken(data.token);
                window.location.href = "/private-room";
            } catch (err) {
                msg.textContent = err.message;
            }
        });
    }

    async function initRegister() {
        const form = document.getElementById("registerForm");
        const msg  = document.getElementById("msg");

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            msg.textContent = "";
            try {
                const data = await apiFetch("/api/auth/register", {
                    method: "POST",
                    body: JSON.stringify({
                        displayName: form.displayName.value,
                        email:       form.email.value,
                        password:    form.password.value
                    })
                });
                setToken(data.token);
                window.location.href = "/private-room";
            } catch (err) {
                msg.textContent = err.message;
            }
        });
    }

    async function initPrivateRoom() {
        requireLogin();

        // Date
        const dateEl = document.getElementById("privateRoomDate");
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric"
            });
        }

        // Load user profile
        let userData = null;
        try {
            const data = await fetchMe();
            userData   = data.user;
        } catch (err) {
            clearToken();
            window.location.href = "/login";
            return;
        }

        renderProfile(userData);
        renderInspoImages(userData.inspo_urls || []);
        await loadActiveFriends();
        await loadUserStats();
    }

    async function loadUserStats() {
        const el = document.getElementById("userStatsPanel");
        if (!el) return;
        try {
            const data  = await apiFetch("/api/user-stats");
            const s     = data.stats;
            const hours = Math.floor(s.totalSeconds / 3600);
            const mins  = Math.floor((s.totalSeconds % 3600) / 60);
            const timeStr = hours > 0 ? `${hours}hr ${mins}min` : `${mins}min`;

            el.innerHTML = `
                <div class="stat-item">
                    <div class="stat-value">${s.totalSessions}</div>
                    <div class="stat-label">Sessions</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${timeStr}</div>
                    <div class="stat-label">Total Time</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${s.totalStatusUpdates}</div>
                    <div class="stat-label">Status Updates</div>
                </div>
            `;
        } catch (_) {
            // stats not available yet — leave placeholder
        }
    }

    function renderProfile(user) {
        // Name
        const nameEl = document.getElementById("profileName");
        if (nameEl) nameEl.textContent = user.displayName || user.email || "—";

        // Bio
        const bioEl = document.getElementById("profileBio");
        if (bioEl) bioEl.textContent = user.bio ? `"${user.bio}"` : '"..."';

        // School
        const schoolLine = document.getElementById("profileSchoolLine");
        const schoolEl   = document.getElementById("profileSchool");
        if (user.school && schoolLine && schoolEl) {
            schoolEl.textContent  = user.school;
            schoolLine.style.display = "inline";
        }

        // Major
        const majorLine = document.getElementById("profileMajorLine");
        const majorEl   = document.getElementById("profileMajor");
        if (user.major && majorLine && majorEl) {
            majorEl.textContent  = user.major;
            majorLine.style.display = "inline";
        }

        // Avatar
        if (user.pfp_url) {
            const img = document.getElementById("profileAvatar");
            const ph  = document.getElementById("profileAvatarPlaceholder");
            if (img) { img.src = user.pfp_url; img.style.display = "block"; }
            if (ph)  { ph.style.display = "none"; }
        }
    }

    function renderInspoImages(urls) {
        const container = document.getElementById("inspoImages");
        if (!container) return;

        if (!urls || !urls.length) {
            container.innerHTML = `
                <div class="inspo-img"
                     style="background:var(--border-light); display:flex;
                            align-items:center; justify-content:center;
                            color:var(--muted-light); font-size:0.85rem;">
                    No images yet
                </div>`;
            return;
        }

        container.innerHTML = "";
        urls.slice(0, 4).forEach((url) => {
            const img = document.createElement("img");
            img.className = "inspo-img";
            img.src       = url;
            img.alt       = "Study inspo";
            img.onerror   = () => { img.style.display = "none"; };
            container.appendChild(img);
        });
    }

    async function loadActiveFriends() {
        const list = document.getElementById("activeFriendsList");
        if (!list) return;

        try {
            const data = await apiFetch("/api/auth/friends/active");

            if (!data.friends.length) {
                list.innerHTML = `<p class="muted small">No friends added yet.</p>`;
                return;
            }

            list.innerHTML = "";
            data.friends.forEach((friend) => {
                const el = document.createElement("div");
                el.className = "friend-card";

                const avatarHtml = friend.pfp_url
                    ? `<img class="friend-avatar" src="${friend.pfp_url}"
                            alt="${escapeHtml(friend.displayName)}"
                            onerror="this.style.background='var(--border-light)'; this.src=''" />`
                    : `<div class="friend-avatar"
                            style="background:var(--border-light);
                                   display:grid; place-items:center; font-size:1.1rem;">👤</div>`;

                const statusBadge = friend.activeSession
                    ? `<span style="font-size:0.75rem; background:var(--card-green-bg);
                                    color:#1a4a18; border-radius:99px;
                                    padding:2px 8px; margin-left:6px;">● Studying</span>`
                    : "";

                el.innerHTML = `
                    ${avatarHtml}
                    <div class="friend-info">
                        <div class="friend-name">
                            ${escapeHtml(friend.displayName || "Friend")}
                            ${statusBadge}
                        </div>
                        <div class="friend-email">${escapeHtml(friend.email)}</div>
                        ${friend.activeSession
                    ? `<div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">
                                   In: ${escapeHtml(friend.activeSession.title)}
                               </div>`
                    : ""}
                    </div>
                `;
                list.appendChild(el);
            });

        } catch (err) {
            const list2 = document.getElementById("activeFriendsList");
            if (list2) list2.innerHTML = `<p class="muted small">Could not load friends.</p>`;
        }
    }


    function toggleEditProfile() {
        const form = document.getElementById("editProfileForm");
        if (!form) return;

        const isHidden = form.style.display === "none" || form.style.display === "";
        if (isHidden) {
            // Pre-fill fields with current values
            fetchMe().then((data) => {
                const u = data.user;
                const bioInput    = document.getElementById("editBio");
                const schoolInput = document.getElementById("editSchool");
                const majorInput  = document.getElementById("editMajor");
                const pfpInput    = document.getElementById("editPfpUrl");
                if (bioInput)    bioInput.value    = u.bio    || "";
                if (schoolInput) schoolInput.value = u.school || "";
                if (majorInput)  majorInput.value  = u.major  || "";
                if (pfpInput)    pfpInput.value    = u.pfp_url || "";
            }).catch(() => {});

            form.style.display = "block";
        } else {
            cancelEditProfile();
        }
    }

    function cancelEditProfile() {
        const form = document.getElementById("editProfileForm");
        if (form) form.style.display = "none";
        const msg = document.getElementById("editProfileMsg");
        if (msg) msg.textContent = "";
    }

    async function saveProfile() {
        const bioInput    = document.getElementById("editBio");
        const schoolInput = document.getElementById("editSchool");
        const majorInput  = document.getElementById("editMajor");
        const pfpInput    = document.getElementById("editPfpUrl");
        const msg         = document.getElementById("editProfileMsg");

        const payload = {
            bio:     bioInput?.value.trim()    || "",
            school:  schoolInput?.value.trim() || "",
            major:   majorInput?.value.trim()  || "",
            pfp_url: pfpInput?.value.trim()    || "",
        };

        try {
            const data = await apiFetch("/api/auth/profile", {
                method: "PATCH",
                body: JSON.stringify(payload),
            });

            if (msg) { msg.textContent = "Saved!"; setTimeout(() => msg.textContent = "", 2000); }
            cancelEditProfile();
            renderProfile(data.user);

            // Also update sidebar avatar/name live
            const sidebarName   = document.getElementById("sidebarName");
            const sidebarAvatar = document.getElementById("sidebarAvatar");
            const sidebarPh     = document.getElementById("sidebarAvatarPlaceholder");
            if (sidebarName)   sidebarName.textContent = data.user.displayName || data.user.email;
            if (data.user.pfp_url && sidebarAvatar) {
                sidebarAvatar.src          = data.user.pfp_url;
                sidebarAvatar.style.display = "block";
                if (sidebarPh) sidebarPh.style.display = "none";
            }

        } catch (err) {
            if (msg) msg.textContent = err.message || "Could not save.";
        }
    }

    function showInspoEditor() {
        const editor = document.getElementById("inspoEditor");
        if (!editor) return;

        // Pre-fill textarea with current URLs
        fetchMe().then((data) => {
            const textarea = document.getElementById("inspoUrlsInput");
            if (textarea) textarea.value = (data.user.inspo_urls || []).join("\n");
        }).catch(() => {});

        editor.style.display = "block";
    }

    function hideInspoEditor() {
        const editor = document.getElementById("inspoEditor");
        if (editor) editor.style.display = "none";
        const msg = document.getElementById("inspoMsg");
        if (msg) msg.textContent = "";
    }

    async function saveInspoUrls() {
        const textarea = document.getElementById("inspoUrlsInput");
        const msg      = document.getElementById("inspoMsg");

        const urls = (textarea?.value || "")
            .split("\n")
            .map(u => u.trim())
            .filter(u => u.startsWith("http"));

        if (urls.length > 4) {
            if (msg) msg.textContent = "Max 4 images allowed.";
            return;
        }

        try {
            const data = await apiFetch("/api/auth/profile", {
                method: "PATCH",
                body: JSON.stringify({ inspo_urls: urls }),
            });

            if (msg) { msg.textContent = "Saved!"; setTimeout(() => msg.textContent = "", 2000); }
            hideInspoEditor();
            renderInspoImages(data.user.inspo_urls || []);

        } catch (err) {
            if (msg) msg.textContent = err.message || "Could not save.";
        }
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
                    <div class="friend-avatar-placeholder" style="width:42px;height:42px;border-radius:50%;
                        background:var(--border-light);display:grid;place-items:center;font-size:1.1rem;">👤</div>
                    <div class="friend-info">
                        <div class="friend-name">${escapeHtml(friend.displayName || "Friend")}</div>
                        <div class="friend-email">${escapeHtml(friend.email)}</div>
                    </div>
                `;
                list.appendChild(el);
            });
        } catch (err) {
            list.innerHTML = `<p class="muted small">Could not load friends.</p>`;
        }
    }

    async function addFriend() {
        requireLogin();
        const emailEl = document.getElementById("friendEmail");
        const msg     = document.getElementById("friendMsg");
        const email   = emailEl.value.trim();
        msg.textContent = "";

        if (!email) { msg.textContent = "Enter an email."; return; }

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
    function showAddFriendRow() {
        const row = document.getElementById("addFriendRow");
        if (row) {
            row.style.display = "block";
            const input = document.getElementById("friendEmail");
            if (input) input.focus();
        }
    }

    function hideAddFriendRow() {
        const row = document.getElementById("addFriendRow");
        if (row) row.style.display = "none";
        const msg = document.getElementById("friendMsg");
        if (msg) msg.textContent = "";
    }



    async function initFriendsPage() {
        requireLogin();
        try { await fetchMe(); }
        catch (err) { clearToken(); window.location.href = "/login"; return; }
        await loadFriends();
    }

    async function initStudyRooms() {
        requireLogin();

        try { await fetchMe(); }
        catch (err) { clearToken(); window.location.href = "/login"; return; }

        // Date
        const dateEl = document.getElementById("studyRoomsDate");
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric"
            });
        }

        // Wire up the Create Room button toggle
        const openBtn = document.getElementById("openCreateRoomBtn");
        if (openBtn) {
            openBtn.addEventListener("click", () => {
                const panel = document.getElementById("createRoomPanel");
                if (panel) {
                    panel.style.display = "block";
                    openBtn.style.display = "none";
                    const input = document.getElementById("sessionTitle");
                    if (input) input.focus();
                }
            });
        }

        await loadActiveSessions("studyRoomsList");
        setInterval(() => loadActiveSessions("studyRoomsList"), 10000);
    }

    async function startSession() {
        requireLogin();
        const titleEl    = document.getElementById("sessionTitle");
        const coverEl    = document.getElementById("sessionCoverUrl");
        const title      = titleEl && titleEl.value.trim() ? titleEl.value.trim() : "Study Session";
        const coverImage = coverEl ? coverEl.value.trim() : "";
        const data       = await apiFetch("/api/sessions", {
            method: "POST",
            body: JSON.stringify({ title, coverImage })
        });
        window.location.href = `/session/${data.sessionId}`;
    }

    async function initSession(sessionId) {
        requireLogin();

        // Track selected status across renders
        let selectedStatus = "";
        let currentUserId  = "";

        // Get the logged-in user so we know which card is "me"
        try {
            const meData    = await fetchMe();
            currentUserId   = meData.user._id || meData.user.id || "";
        } catch (_) {
            clearToken();
            window.location.href = "/login";
            return;
        }

        // Auto-join on arrival (silently adds user to participantIds if not there)
        try {
            await apiFetch(`/api/sessions/${sessionId}/join`, { method: "POST" });
        } catch (_) {
            // Already a participant — that's fine
        }

        // Wire status option buttons
        document.querySelectorAll(".status-option[data-status]").forEach((btn) => {
            btn.addEventListener("click", () => {
                selectedStatus = btn.dataset.status;
                document.querySelectorAll(".status-option[data-status]").forEach(b =>
                    b.classList.remove("selected"));
                btn.classList.add("selected");
                // Clear custom input when a preset is chosen
                const customInput = document.getElementById("customStatusInput");
                if (customInput) customInput.value = "";
            });
        });

        // Participant card color palette — cycles per participant index
        const cardColors = ["", "green", "pink"];  // blue (default), green, pink

        function renderParticipants(participants) {
            const grid = document.getElementById("participantsGrid");
            if (!grid) return;
            grid.innerHTML = "";

            participants.forEach((p, i) => {
                const colorClass = cardColors[i % cardColors.length];
                const isMe       = p.id === currentUserId;
                const isOwner    = p.isOwner;

                const avatarHtml = p.pfp_url
                    ? `<img class="participant-avatar"
                            src="${p.pfp_url}"
                            alt="${escapeHtml(p.displayName)}"
                            onerror="this.style.display='none'" />`
                    : `<div class="participant-avatar"
                            style="background:var(--border-light);
                                   display:grid; place-items:center; font-size:1.3rem;">👤</div>`;

                const statusIcon = getStatusIcon(p.status);

                const card = document.createElement("div");
                card.className = `participant-card ${colorClass}`;
                card.innerHTML = `
                    <div class="participant-card-header">
                        <div class="participant-info">
                            ${avatarHtml}
                            <div>
                                <div class="participant-name">${escapeHtml(p.displayName || "Participant")}</div>
                                <div class="participant-role">${isOwner ? "Owner" : "Participant"}</div>
                            </div>
                        </div>
                        ${isMe ? `<button class="btn-update-status"
                                          onclick="document.getElementById('statusPicker').scrollIntoView({behavior:'smooth'})">
                                      Update Status
                                  </button>` : ""}
                    </div>
                    <div class="participant-status">
                        ${statusIcon}
                        ${escapeHtml(p.status || "No status yet")}
                    </div>
                `;
                grid.appendChild(card);
            });

            // Show End Session button only for the owner
            const endBtn = document.getElementById("endSessionBtn");
            if (endBtn) {
                const iAmOwner = participants.some(p => p.id === currentUserId && p.isOwner);
                endBtn.style.display = iAmOwner ? "inline-flex" : "none";
            }
        }

        function renderStatusFeed(events, participants) {
            const feed = document.getElementById("statusFeed");
            if (!feed) return;
            feed.innerHTML = "";

            // Show STATUS + JOIN + END events in the feed
            const feedEvents = events.filter(e =>
                ["STATUS", "JOIN", "END"].includes(e.type)
            );

            if (!feedEvents.length) {
                feed.innerHTML = `<p class="muted small">No updates yet.</p>`;
                return;
            }

            // Build userId → pfp_url map from current participants
            const pfpMap = {};
            (participants || []).forEach(p => {
                if (p.id && p.pfp_url) pfpMap[p.id] = p.pfp_url;
            });

            feedEvents.forEach((ev) => {
                const time = ev.timestamp
                    ? new Date(ev.timestamp).toLocaleTimeString("en-US", {
                        hour: "numeric", minute: "2-digit"
                    })
                    : "";

                const displayText = ev.type === "STATUS"  ? ev.value
                    : ev.type === "JOIN"    ? ev.value || "Joined"
                        : ev.type === "END"     ? "Left Study Room"
                            : ev.value || "";

                // Use real pfp if available, else placeholder
                const pfp = pfpMap[ev.userId] || "";
                const avatarHtml = pfp
                    ? `<img class="feed-avatar" src="${pfp}"
                            alt="${escapeHtml(ev.userName || "")}"
                            onerror="this.style.display='none';
                                     this.nextElementSibling.style.display='grid';" />
                       <div class="feed-avatar"
                            style="display:none; background:#f0f0f0;
                                   place-items:center; font-size:1.1rem;">👤</div>`
                    : `<div class="feed-avatar"
                            style="background:#f0f0f0;
                                   display:grid; place-items:center; font-size:1.1rem;">👤</div>`;

                const item = document.createElement("div");
                item.className = "feed-item";
                item.innerHTML = `
                    ${avatarHtml}
                    <div>
                        <div>
                            <span class="feed-name">${escapeHtml(ev.userName || "")}</span>
                            <span class="feed-time">${time}</span>
                        </div>
                        <div class="feed-status">${escapeHtml(displayText)}</div>
                    </div>
                `;
                feed.appendChild(item);
            });
        }

        async function refresh() {
            try {
                const data = await apiFetch(`/api/sessions/${sessionId}`);

                // Page title
                const titleEl = document.getElementById("sessionTitle");
                if (titleEl) titleEl.textContent = data.session.title || "Study Room";

                // Redirect if session ended and we're not the owner
                if (!data.session.active) {
                    // Room ended — show modal if we have summary data, else go to study rooms
                    window.location.href = "/study-rooms";
                    return;
                }

                renderParticipants(data.participants || []);
                renderStatusFeed(data.events || [], data.participants || []);

            } catch (err) {
                console.error("Session refresh failed:", err);
            }
        }

        window.StudyLinkSession = { sessionId, refresh, getSelectedStatus: () => selectedStatus,
            setSelectedStatus: (s) => { selectedStatus = s; } };

        // Leave the session cleanly whenever the user navigates away or closes tab
        window.addEventListener("beforeunload", leaveSession);

        await refresh();
        setInterval(refresh, 7000);
    }

    async function joinSession() {
        if (!window.StudyLinkSession) return;
        const { sessionId, refresh } = window.StudyLinkSession;
        try {
            await apiFetch(`/api/sessions/${sessionId}/join`, { method: "POST" });
            await refresh();
        } catch (_) {}
    }

    function cancelCreateRoom() {
        const panel = document.getElementById("createRoomPanel");
        if (panel) panel.style.display = "none";
        const openBtn = document.getElementById("openCreateRoomBtn");
        if (openBtn) openBtn.style.display = "inline-flex";
        const input = document.getElementById("sessionTitle");
        if (input) input.value = "";
    }

    async function submitStatus() {
        if (!window.StudyLinkSession) return;

        const { sessionId, refresh, getSelectedStatus } = window.StudyLinkSession;
        const status = getSelectedStatus();

        if (!status) {
            // Nudge the picker visually if nothing is selected
            const picker = document.getElementById("statusOptionsGrid");
            if (picker) {
                picker.style.outline = "2px solid var(--join-pink)";
                setTimeout(() => picker.style.outline = "", 1200);
            }
            return;
        }

        try {
            await apiFetch(`/api/sessions/${sessionId}/status`, {
                method: "POST",
                body: JSON.stringify({ status })
            });
            await refresh();
        } catch (err) {
            console.error("Status update failed:", err);
        }
    }

    async function setStatus() {
        await submitStatus();
    }

    async function endSession() {
        if (!window.StudyLinkSession) return;
        const { sessionId } = window.StudyLinkSession;

        // Remove the beforeunload listener so it doesn't double-fire
        window.removeEventListener("beforeunload", leaveSession);

        const token = getToken();
        try {
            const res  = await fetch(`/api/sessions/${sessionId}/leave`, {
                method:  "POST",
                headers: {
                    "Content-Type":  "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });
            const data = await res.json().catch(() => ({}));
            if (data.sessionSummary) {
                showLeaveSummaryModal(data.sessionSummary, data.user);
            } else {
                window.location.href = "/study-rooms";
            }
        } catch (_) {
            window.location.href = "/study-rooms";
        }
    }

    // initSummary removed — summary modal handled by showLeaveSummaryModal

    function logout() {
        clearToken();
        window.location.href = "/";
    }


    async function leaveSession() {
        if (!window.StudyLinkSession) return;
        const { sessionId } = window.StudyLinkSession;
        const token = getToken();

        try {
            const res = await fetch(`/api/sessions/${sessionId}/leave`, {
                method:    "POST",
                keepalive: true,
                headers: {
                    "Content-Type":  "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });
            const data = await res.json().catch(() => ({}));
            if (data.sessionSummary) {
                showLeaveSummaryModal(data.sessionSummary, data.user);
            } else {
                window.location.href = "/study-rooms";
            }
        } catch (_) {
            window.location.href = "/study-rooms";
        }
    }

    function showLeaveSummaryModal(summary, user) {
        // Remove any existing modal
        const existing = document.getElementById("leaveSummaryModal");
        if (existing) existing.remove();

        const mins = Math.floor(summary.durationSeconds / 60);
        const secs = summary.durationSeconds % 60;
        const timeStr = mins > 0
            ? `${mins}hr ${secs}min`
            : `${secs}sec`;

        const avatarHtml = user && user.pfp_url
            ? `<img src="${user.pfp_url}" alt="${escapeHtml(user.displayName)}"
                    style="width:110px;height:130px;object-fit:cover;
                           border-radius:var(--radius-md);border:2px solid #1a1a1a;
                           flex-shrink:0;" />`
            : `<div style="width:110px;height:130px;border-radius:var(--radius-md);
                           border:2px solid #1a1a1a;background:#f0f0f0;
                           display:flex;align-items:center;justify-content:center;
                           font-size:2.5rem;flex-shrink:0;">🎨</div>`;

        const schoolLine = user && user.school
            ? `<div style="font-size:0.9rem;margin-top:4px;">School: ${escapeHtml(user.school)}</div>` : "";
        const majorLine = user && user.major
            ? `<div style="font-size:0.9rem;">Major: ${escapeHtml(user.major)}</div>` : "";

        const overlay = document.createElement("div");
        overlay.id = "leaveSummaryModal";
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:1000;
            background:rgba(0,0,0,0.35);
            display:flex;align-items:center;justify-content:center;
            padding:24px;
        `;

        overlay.innerHTML = `
            <div style="
                background:#fff;border:2px solid #1a1a1a;
                border-radius:var(--radius-xl);
                padding:40px 44px;width:100%;max-width:520px;
                box-shadow:0 20px 60px rgba(0,0,0,0.15);
            ">
                <!-- Profile card section -->
                <div style="display:flex;gap:22px;align-items:flex-start;margin-bottom:32px;">
                    ${avatarHtml}
                    <div style="flex:1;">
                        <div style="font-family:var(--font-display);font-size:1.7rem;
                                    font-style:italic;font-weight:400;margin-bottom:6px;">
                            ${escapeHtml(user ? user.displayName : "")}
                        </div>
                        ${user && user.bio
            ? `<div style="font-family:var(--font-display);font-style:italic;
                                          color:#888;font-size:0.9rem;margin-bottom:8px;">
                                   "${escapeHtml(user.bio)}"
                               </div>
                               <div style="letter-spacing:4px;color:#ccc;font-size:0.65rem;margin-bottom:10px;">
                                   ✦ ° ✦ ° ✦ ° ✦ ° ✦
                               </div>`
            : ""}
                        <div style="font-size:0.88rem;line-height:1.8;color:#1a1a1a;">
                            ${schoolLine}${majorLine}
                        </div>
                    </div>
                </div>

                <!-- Summary section -->
                <div style="border-top:1.5px solid #e8e8e8;padding-top:24px;margin-bottom:28px;">
                    <div style="font-family:var(--font-display);font-style:italic;
                                font-size:1.5rem;font-weight:400;margin-bottom:18px;">
                        Session Summary:
                    </div>
                    <div style="font-size:1rem;margin-bottom:10px;">
                        Total Time Spent: <strong>${timeStr}</strong>
                    </div>
                    <div style="font-size:1rem;">
                        Status Updates: <strong>${summary.statusUpdates}</strong>
                    </div>
                </div>

                <!-- Close button -->
                <div style="text-align:center;">
                    <button id="leaveSummaryClose"
                            style="background:var(--card-blue-bg);border:2px solid #1a1a1a;
                                   border-radius:var(--radius-pill);padding:12px 56px;
                                   font-family:var(--font-body);font-size:1rem;
                                   font-weight:500;cursor:pointer;color:#1a1a1a;">
                        Close
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById("leaveSummaryClose").addEventListener("click", () => {
            overlay.remove();
            window.location.href = "/study-rooms";
        });

        // Click outside to close
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                overlay.remove();
                window.location.href = "/study-rooms";
            }
        });
    }

    // ── Public API ────────────────────────────────────────────
    return {
        // Auth
        initLogin,
        initRegister,
        fetchMePublic,

        // Pages
        initDashboard,
        initStudyRooms,
        initFriendsPage,
        initSession,

        // Sessions
        startSession,
        joinSession,
        submitStatus,
        selectCustomStatus,
        cancelCreateRoom,
        setStatus,
        endSession,

        // Friends
        addFriend,

        // Tasks
        addTask,
        toggleTask,
        deleteTask,
        cancelAddTask,


        initPrivateRoom,
        saveProfile,
        cancelEditProfile,
        toggleEditProfile,
        showInspoEditor,
        hideInspoEditor,
        saveInspoUrls,
        showAddFriendRow,
        hideAddFriendRow,

        // Auth
        logout,

        // Leave
        leaveSession,

        // Stats
        loadUserStats,
    };
})();