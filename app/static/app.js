const StudyLink = (() => {
    const tokenKey = "studylink_token";

    // ── Timer state (persisted across pages via localStorage) ──
    const TIMER_KEY = "studylink_timer";

    // Default focus duration in minutes — editable by user
    function getDefaultFocusMinutes() {
        return parseInt(localStorage.getItem("studylink_focus_default") || "25", 10);
    }
    function setDefaultFocusMinutes(mins) {
        localStorage.setItem("studylink_focus_default", String(mins));
    }

    function saveTimerState() {
        localStorage.setItem(TIMER_KEY, JSON.stringify({
            mode:      timerState.mode,
            seconds:   timerState.seconds,
            running:   timerState.running,
            savedAt:   timerState.running ? Date.now() : null,
        }));
    }

    function loadTimerState() {
        try {
            const raw = localStorage.getItem(TIMER_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            // If timer was running, calculate elapsed since page left
            if (s.running && s.savedAt) {
                const elapsed = Math.floor((Date.now() - s.savedAt) / 1000);
                s.seconds = Math.max(0, s.seconds - elapsed);
                if (s.seconds === 0) s.running = false;
            }
            return s;
        } catch (_) { return null; }
    }

    function clearTimerState() {
        localStorage.removeItem(TIMER_KEY);
    }

    // In-memory mirror of current timer state
    const timerState = {
        mode:     "focus",
        seconds:  getDefaultFocusMinutes() * 60,
        running:  false,
    };
    let timerInterval = null;

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
        // Update dashboard display
        const display = document.getElementById("timerDisplay");
        if (display) display.textContent = formatTime(timerState.seconds);
        // Update floating widget display
        const widgetDisplay = document.getElementById("floatTimerDisplay");
        if (widgetDisplay) widgetDisplay.textContent = formatTime(timerState.seconds);
        // Update browser tab title when running
        if (timerState.running) {
            document.title = `${formatTime(timerState.seconds)} — StudyLink`;
        }
    }

    function syncDashboardUI() {
        const focusBtn = document.getElementById("focusModeBtn");
        const breakBtn = document.getElementById("breakModeBtn");
        const startBtn = document.getElementById("startTimerBtn");
        if (focusBtn && breakBtn) {
            focusBtn.classList.toggle("active", timerState.mode === "focus");
            breakBtn.classList.toggle("active", timerState.mode === "break");
        }
        if (startBtn) {
            startBtn.textContent = timerState.running ? "⏸ Pause" : "▷ Start";
        }
        updateTimerDisplay();
    }

    function syncWidgetUI() {
        const widget    = document.getElementById("floatTimer");
        const pauseBtn  = document.getElementById("floatPauseBtn");
        if (!widget) return;
        widget.style.display = timerState.running ? "flex" : "none";
        if (pauseBtn) pauseBtn.textContent = timerState.running ? "⏸" : "▷";
    }

    function setTimerMode(mode) {
        timerState.mode    = mode;
        timerState.seconds = mode === "focus"
            ? getDefaultFocusMinutes() * 60
            : 5 * 60;
        timerState.running = false;
        clearInterval(timerInterval);
        timerInterval = null;
        saveTimerState();
        syncDashboardUI();
        syncWidgetUI();
    }

    function startTimerTick() {
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (timerState.seconds > 0) {
                timerState.seconds -= 1;
                saveTimerState();
                updateTimerDisplay();
            } else {
                clearInterval(timerInterval);
                timerInterval      = null;
                timerState.running = false;
                saveTimerState();
                syncDashboardUI();
                syncWidgetUI();
                // Restore tab title
                document.title = "StudyLink";
                // Notify
                if (Notification && Notification.permission === "granted") {
                    new Notification("StudyLink", {
                        body: timerState.mode === "focus"
                            ? "Focus session complete! Take a break."
                            : "Break's over — back to work!",
                        icon: "/static/favicon.ico",
                    });
                } else {
                    alert(timerState.mode === "focus"
                        ? "Focus session complete! Take a break."
                        : "Break's over — back to work!");
                }
            }
        }, 1000);
    }

    function toggleTimer() {
        if (timerState.running) {
            timerState.running = false;
            clearInterval(timerInterval);
            timerInterval = null;
        } else {
            timerState.running = true;
            startTimerTick();
            // Request notification permission on first start
            if (Notification && Notification.permission === "default") {
                Notification.requestPermission();
            }
        }
        saveTimerState();
        syncDashboardUI();
        syncWidgetUI();
    }

    function resetTimer() {
        setTimerMode(timerState.mode);
    }

    function setupTimer() {
        // Load persisted state first
        const saved = loadTimerState();
        if (saved) {
            timerState.mode    = saved.mode;
            timerState.seconds = saved.seconds;
            timerState.running = saved.running;
        }

        // Wire dashboard buttons if we're on dashboard
        const focusBtn = document.getElementById("focusModeBtn");
        const breakBtn = document.getElementById("breakModeBtn");
        const startBtn = document.getElementById("startTimerBtn");
        const resetBtn = document.getElementById("resetTimerBtn");

        if (focusBtn) focusBtn.addEventListener("click", () => setTimerMode("focus"));
        if (breakBtn) breakBtn.addEventListener("click", () => setTimerMode("break"));
        if (startBtn) startBtn.addEventListener("click", toggleTimer);
        if (resetBtn) resetBtn.addEventListener("click", resetTimer);

        // Editable timer — click the display to set a custom duration
        const display = document.getElementById("timerDisplay");
        if (display) {
            display.style.cursor = "text";
            display.title = "Click to set custom duration";
            display.addEventListener("click", () => {
                if (timerState.running) return; // don't edit while running
                const current = Math.round(timerState.seconds / 60);
                const input = prompt(`Set timer duration (minutes). Default is ${getDefaultFocusMinutes()}min:`, current);
                if (input === null) return;
                const mins = parseInt(input, 10);
                if (isNaN(mins) || mins < 1 || mins > 999) return;
                // Save as new default for focus mode
                if (timerState.mode === "focus") setDefaultFocusMinutes(mins);
                timerState.seconds = mins * 60;
                saveTimerState();
                updateTimerDisplay();
            });
        }

        // Resume ticking if was running
        if (timerState.running) startTimerTick();

        syncDashboardUI();
    }

    // Called on every page from base_app.html to init floating widget
    function initFloatingTimer() {
        const saved = loadTimerState();
        if (saved) {
            timerState.mode    = saved.mode;
            timerState.seconds = saved.seconds;
            timerState.running = saved.running;
        }

        const widget = document.getElementById("floatTimer");
        if (!widget) return;

        // Show widget only when timer is running
        widget.style.display = timerState.running ? "flex" : "none";
        updateTimerDisplay();

        // Resume ticking if it was running
        if (timerState.running) startTimerTick();

        // Wire widget buttons
        const pauseBtn = document.getElementById("floatPauseBtn");
        const closeBtn = document.getElementById("floatCloseBtn");

        if (pauseBtn) {
            pauseBtn.textContent = timerState.running ? "⏸" : "▷";
            pauseBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleTimer();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                // Stop and clear the timer
                clearInterval(timerInterval);
                timerInterval      = null;
                timerState.running = false;
                timerState.seconds = getDefaultFocusMinutes() * 60;
                clearTimerState();
                syncDashboardUI();
                widget.style.display = "none";
                document.title = "StudyLink";
            });
        }
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
                    <div class="friend-info" style="flex:1;min-width:0;">
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

                // Make the whole card clickable to view their profile
                el.style.cursor = "pointer";
                el.title = `View ${friend.displayName || "friend"}'s room`;
                el.addEventListener("click", () => StudyLink.showFriendProfile(friend.id));
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
        const titleEl     = document.getElementById("sessionTitle");
        const coverEl     = document.getElementById("sessionCoverUrl");
        const descEl      = document.getElementById("sessionDescription");
        const title       = titleEl && titleEl.value.trim() ? titleEl.value.trim() : "Study Session";
        const coverImage  = coverEl ? coverEl.value.trim()  : "";
        const description = descEl  ? descEl.value.trim()   : "";
        const data        = await apiFetch("/api/sessions", {
            method: "POST",
            body: JSON.stringify({ title, coverImage, description })
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

                    </div>
                    <div class="participant-status">
                        ${statusIcon}
                        ${escapeHtml(p.status || "No status yet")}
                    </div>
                `;
                grid.appendChild(card);
            });

            // Show End Session button only for the owner
            const endBtn  = document.getElementById("endSessionBtn");
            const editBtn = document.getElementById("editRoomBtn");
            const iAmOwner = participants.some(p => p.id === currentUserId && p.isOwner);
            if (endBtn) {
                endBtn.style.display = "inline-flex";
                endBtn.textContent   = iAmOwner ? "End Session" : "Leave Session";
            }
            if (editBtn) editBtn.style.display = iAmOwner ? "inline-flex" : "none";
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

                // Store for edit panel pre-fill
                if (window.StudyLinkSession) {
                    window.StudyLinkSession.roomData = {
                        coverImage:  data.session.coverImage  || "",
                        description: data.session.description || "",
                    };
                }

                // Render description if present
                const descEl = document.getElementById("roomDescription");
                if (descEl) {
                    descEl.textContent   = data.session.description || "";
                    descEl.style.display = data.session.description ? "block" : "none";
                }

                // Redirect if session ended and we're not the owner
                if (!data.session.active) {
                    // Room ended — show modal if we have summary data, else go to study rooms
                    window.location.href = "/study-rooms";
                    return;
                }

                renderParticipants(data.participants || []);
                renderStatusFeed(data.events || [], data.participants || []);
                renderRoomPreview(data.session, data.participants || []);

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


    function showEditRoomPanel() {
        const panel = document.getElementById("editRoomPanel");
        if (!panel) return;
        panel.style.display = "block";
        const titleEl = document.getElementById("editRoomTitle");
        const coverEl = document.getElementById("editRoomCover");
        const descEl  = document.getElementById("editRoomDesc");
        const currentTitle = document.getElementById("sessionTitle");
        if (titleEl && currentTitle) titleEl.value = currentTitle.textContent.trim();
        if (window.StudyLinkSession && window.StudyLinkSession.roomData) {
            const d = window.StudyLinkSession.roomData;
            if (coverEl) coverEl.value = d.coverImage  || "";
            if (descEl)  descEl.value  = d.description || "";
        }
    }

    function hideEditRoomPanel() {
        const panel = document.getElementById("editRoomPanel");
        if (panel) panel.style.display = "none";
        const msg = document.getElementById("editRoomMsg");
        if (msg) msg.textContent = "";
    }

    async function saveRoomEdit() {
        if (!window.StudyLinkSession) return;
        const { sessionId, refresh } = window.StudyLinkSession;
        const titleEl = document.getElementById("editRoomTitle");
        const coverEl = document.getElementById("editRoomCover");
        const descEl  = document.getElementById("editRoomDesc");
        const msg     = document.getElementById("editRoomMsg");
        const payload = {
            title:       titleEl ? titleEl.value.trim() : undefined,
            coverImage:  coverEl ? coverEl.value.trim() : undefined,
            description: descEl  ? descEl.value.trim()  : undefined,
        };
        try {
            await apiFetch(`/api/sessions/${sessionId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
            hideEditRoomPanel();
            await refresh();
        } catch (err) {
            if (msg) msg.textContent = err.message || "Could not save.";
        }
    }


    function renderRoomPreview(session, participants) {
        // Image
        const imgWrap = document.getElementById("roomPreviewImgWrap");
        if (imgWrap) {
            if (session.coverImage) {
                imgWrap.innerHTML = `
                    <img class="room-preview-img"
                         src="${session.coverImage}"
                         alt="${escapeHtml(session.title || "")}"
                         onerror="this.style.display='none';
                                  this.nextElementSibling.style.display='flex';" />
                    <div class="room-preview-img-placeholder" style="display:none;">📚</div>`;
            } else {
                imgWrap.innerHTML = `<div class="room-preview-img-placeholder">📚</div>`;
            }
        }

        // Title
        const titleEl = document.getElementById("roomPreviewTitle");
        if (titleEl) titleEl.textContent = session.title || "Study Room";

        // Description
        const descEl = document.getElementById("roomPreviewDesc");
        if (descEl) {
            if (session.description) {
                descEl.textContent   = session.description;
                descEl.style.display = "block";
            } else {
                descEl.style.display = "none";
            }
        }

        // Participant count with live green dot
        const countEl = document.getElementById("roomPreviewCount");
        if (countEl) {
            const n = participants ? participants.length : 0;
            countEl.textContent = `${n} participant${n !== 1 ? "s" : ""}`;
        }
    }


    async function showFriendProfile(friendId) {
        try {
            const data    = await apiFetch(`/api/auth/friends/${friendId}/profile`);
            const profile = data.profile;
            renderFriendModal(profile);
        } catch (err) {
            console.error("Could not load friend profile:", err);
        }
    }

    function renderFriendModal(p) {
        const existing = document.getElementById("friendProfileModal");
        if (existing) existing.remove();

        const avatarHtml = p.pfp_url
            ? `<img src="${p.pfp_url}" alt="${escapeHtml(p.displayName)}"
                    style="width:160px;height:190px;object-fit:cover;
                           border-radius:var(--radius-md);border:2px solid #1a1a1a;
                           flex-shrink:0;" />`
            : `<div style="width:160px;height:190px;border-radius:var(--radius-md);
                           border:2px solid #1a1a1a;background:#f0f0f0;
                           display:flex;align-items:center;justify-content:center;
                           font-size:3rem;flex-shrink:0;">🎨</div>`;

        const bioHtml = p.bio
            ? `<div style="font-family:var(--font-display);font-style:italic;
                          color:#888;font-size:0.92rem;margin-bottom:8px;">
                   "${escapeHtml(p.bio)}"
               </div>
               <div style="letter-spacing:4px;color:#ccc;font-size:0.65rem;margin-bottom:12px;">
                   ✦ ° ✦ ° ✦ ° ✦ ° ✦
               </div>` : "";

        const metaHtml = [
            p.school ? `School: ${escapeHtml(p.school)}` : "",
            p.major  ? `Major: ${escapeHtml(p.major)}`   : "",
        ].filter(Boolean).join("<br>");

        // Inspo images — up to 3 shown in the modal
        const inspoHtml = (p.inspo_urls && p.inspo_urls.length)
            ? p.inspo_urls.slice(0, 3).map(url => `
                <img src="${url}" alt="Study inspo"
                     style="width:100%;height:130px;object-fit:cover;
                            border-radius:var(--radius-md);display:block;
                            margin-bottom:10px;"
                     onerror="this.style.display='none';" />`
            ).join("")
            : `<p style="color:var(--muted);font-size:0.85rem;">No study inspo yet.</p>`;

        const s = p.stats || {};

        const overlay = document.createElement("div");
        overlay.id = "friendProfileModal";
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
                padding:36px 40px;
                width:100%;max-width:860px;
                max-height:88vh;overflow-y:auto;
                display:grid;
                grid-template-columns:1fr 340px;
                gap:32px;
                align-items:start;
            ">
                <!-- Left column: profile card + stats -->
                <div>
                    <!-- Profile card -->
                    <div style="border:2px solid #1a1a1a;border-radius:var(--radius-xl);
                                padding:24px;margin-bottom:20px;position:relative;">
                        <div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:32px;">
                            ${avatarHtml}
                            <div style="flex:1;min-width:0;">
                                <div style="font-family:var(--font-display);font-style:italic;
                                            font-size:1.8rem;font-weight:400;margin-bottom:6px;">
                                    ${escapeHtml(p.displayName || "Friend")}
                                </div>
                                ${bioHtml}
                                <div style="font-size:0.88rem;line-height:1.8;
                                            font-family:'Courier New',monospace;color:#1a1a1a;">
                                    ${metaHtml}
                                </div>
                            </div>
                        </div>
                        <div style="font-family:var(--font-display);font-style:italic;
                                    font-size:1rem;color:var(--text);">
                            Studylink ID
                        </div>
                    </div>

                    <!-- Stats -->
                    <div style="border:2px solid #1a1a1a;border-radius:var(--radius-xl);padding:20px;">
                        <div style="font-size:0.88rem;font-weight:500;
                                    color:var(--text);margin-bottom:14px;">
                            My Study Stats
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
                            <div style="text-align:center;padding:14px 8px;
                                        border:2px solid #1a1a1a;border-radius:var(--radius-md);">
                                <div style="font-family:var(--font-display);font-size:1.3rem;">
                                    ${s.totalSessions || 0}
                                </div>
                                <div style="font-size:0.72rem;color:var(--muted);
                                            text-transform:uppercase;letter-spacing:0.04em;margin-top:3px;">
                                    Sessions
                                </div>
                            </div>
                            <div style="text-align:center;padding:14px 8px;
                                        border:2px solid #1a1a1a;border-radius:var(--radius-md);">
                                <div style="font-family:var(--font-display);font-size:1.3rem;">
                                    ${escapeHtml(s.totalTime || "0min")}
                                </div>
                                <div style="font-size:0.72rem;color:var(--muted);
                                            text-transform:uppercase;letter-spacing:0.04em;margin-top:3px;">
                                    Total Time
                                </div>
                            </div>
                            <div style="text-align:center;padding:14px 8px;
                                        border:2px solid #1a1a1a;border-radius:var(--radius-md);">
                                <div style="font-family:var(--font-display);font-size:1.3rem;">
                                    ${s.totalStatusUpdates || 0}
                                </div>
                                <div style="font-size:0.72rem;color:var(--muted);
                                            text-transform:uppercase;letter-spacing:0.04em;margin-top:3px;">
                                    Status Updates
                                </div>
                            </div>
                        </div>

                        <!-- Add Friend button (centred below stats) -->
                        <div style="text-align:center;margin-top:20px;">
                            <button onclick="document.getElementById('friendProfileModal').remove();
                                            StudyLink.showAddFriendRow();"
                                    style="background:var(--accent);color:#1a1a1a;
                                           border:2px solid #1a1a1a;border-radius:var(--radius-pill);
                                           padding:12px 36px;font-family:var(--font-body);
                                           font-size:0.95rem;font-weight:500;cursor:pointer;">
                                Add Friend
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Right column: Study Inspo -->
                <div style="position:relative;">
                    <button onclick="document.getElementById('friendProfileModal').remove();"
                            style="position:absolute;top:-8px;right:-8px;
                                   background:#fff;border:2px solid #1a1a1a;
                                   border-radius:50%;width:32px;height:32px;
                                   cursor:pointer;font-size:0.9rem;color:var(--muted);
                                   display:flex;align-items:center;justify-content:center;
                                   font-family:var(--font-body);">✕</button>

                    <div style="border:2px solid #1a1a1a;border-radius:var(--radius-xl);padding:24px;">
                        <div style="display:flex;justify-content:space-between;
                                    align-items:center;margin-bottom:16px;">
                            <span style="font-family:var(--font-display);font-style:italic;
                                         font-size:1.3rem;font-weight:400;">Study Inspo</span>
                            <span style="color:var(--muted);font-size:1rem;">···</span>
                        </div>
                        ${inspoHtml}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Click backdrop to close
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    // ── Public API ────────────────────────────────────────────
    return {
        // Auth
        initLogin,

        // Timer (global)
        initFloatingTimer,
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

        // Room editing
        showEditRoomPanel,
        hideEditRoomPanel,
        saveRoomEdit,
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
        showFriendProfile,

        // Auth
        logout,

        // Leave
        leaveSession,

        // Stats
        loadUserStats,
    };
})();