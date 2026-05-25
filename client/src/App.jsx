import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

const emptyTaskForm = {
  title: "",
  description: "",
  dueDate: "",
  priority: "medium",
  status: "todo"
};

const emptyAuthForm = {
  name: "",
  email: "",
  password: ""
};

function getStoredSession() {
  try {
    return {
      token: localStorage.getItem("tm_token") || "",
      user: JSON.parse(localStorage.getItem("tm_user") || "null")
    };
  } catch (_error) {
    return { token: "", user: null };
  }
}

function toDateInputValue(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function formatDueDate(value) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function getTaskTone(task) {
  if (!task.dueDate || task.status === "done") {
    return "";
  }

  const due = new Date(`${toDateInputValue(task.dueDate)}T23:59:59`);
  const diffDays = (due - new Date()) / (1000 * 60 * 60 * 24);

  if (diffDays < 0) {
    return "overdue";
  }

  if (diffDays <= 3) {
    return "soon";
  }

  return "";
}

function nextStatus(status) {
  if (status === "todo") return "in-progress";
  if (status === "in-progress") return "done";
  return "todo";
}

function App() {
  const session = getStoredSession();
  const socketRef = useRef(null);

  const [mode, setMode] = useState("login");
  const [token, setToken] = useState(session.token);
  const [user, setUser] = useState(session.user);
  const [authForm, setAuthForm] = useState(emptyAuthForm);
  const [tasks, setTasks] = useState([]);
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [filters, setFilters] = useState({
    status: "all",
    priority: "all",
    search: "",
    sortBy: "updated"
  });
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [realtimeState, setRealtimeState] = useState("offline");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStage, setForgotStage] = useState("request");
  const [forgotForm, setForgotForm] = useState({
    email: session.user?.email || "",
    token: "",
    newPassword: ""
  });

  const isAuthenticated = Boolean(token && user);

  useEffect(() => {
    if (token) {
      localStorage.setItem("tm_token", token);
    } else {
      localStorage.removeItem("tm_token");
    }

    if (user) {
      localStorage.setItem("tm_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("tm_user");
    }
  }, [token, user]);

  useEffect(() => {
    if (!isAuthenticated) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setRealtimeState("offline");
      return;
    }

    let mounted = true;

    async function loadAndConnect() {
      await loadTasks();

      if (!mounted) {
        return;
      }

      if (socketRef.current) {
        socketRef.current.close();
      }

      const wsBase = API_BASE.replace("http://", "ws://").replace("https://", "wss://").replace("/api", "");
      const socket = new WebSocket(`${wsBase}?token=${encodeURIComponent(token)}`);
      socketRef.current = socket;
      setRealtimeState("connecting");

      socket.addEventListener("open", () => setRealtimeState("live"));
      socket.addEventListener("close", () => setRealtimeState("offline"));
      socket.addEventListener("message", async (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type && payload.type.startsWith("task:")) {
          await loadTasks();
        }
      });
    }

    loadAndConnect().catch((error) => showToast(error.message));

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token]);

  const filteredTasks = useMemo(() => {
    let list = [...tasks];

    if (filters.status !== "all") {
      list = list.filter((task) => task.status === filters.status);
    }

    if (filters.priority !== "all") {
      list = list.filter((task) => task.priority === filters.priority);
    }

    if (filters.search.trim()) {
      const query = filters.search.trim().toLowerCase();
      list = list.filter((task) => {
        return task.title.toLowerCase().includes(query) || task.description.toLowerCase().includes(query);
      });
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };

    if (filters.sortBy === "due-asc") {
      list.sort((a, b) => {
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
        return aDate - bDate;
      });
    } else if (filters.sortBy === "due-desc") {
      list.sort((a, b) => {
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Number.NEGATIVE_INFINITY;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Number.NEGATIVE_INFINITY;
        return bDate - aDate;
      });
    } else if (filters.sortBy === "priority") {
      list.sort((a, b) => {
        const priorityDelta = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    } else {
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    return list;
  }, [filters, tasks]);

  const stats = useMemo(() => {
    const overdue = tasks.filter((task) => getTaskTone(task) === "overdue").length;
    return {
      total: tasks.length,
      todo: tasks.filter((task) => task.status === "todo").length,
      inProgress: tasks.filter((task) => task.status === "in-progress").length,
      done: tasks.filter((task) => task.status === "done").length,
      overdue
    };
  }, [tasks]);

  function showToast(message) {
    setToast(message);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(""), 2500);
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    if (response.status === 204) {
      return null;
    }

    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && token) {
      logout();
      throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }

    return data;
  }

  async function loadTasks() {
    const data = await api("/tasks");
    setTasks(data.tasks || []);
  }

  function logout() {
    setToken("");
    setUser(null);
    setTasks([]);
    setAuthForm(emptyAuthForm);
    setTaskForm(emptyTaskForm);
    setEditingTask(null);
    setRealtimeState("offline");
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    showToast("Logged out");
  }

  function openForgotPassword() {
    setForgotStage("request");
    setForgotForm({
      email: authForm.email || session.user?.email || "",
      token: "",
      newPassword: ""
    });
    setForgotOpen(true);
  }

  function closeForgotPassword() {
    setForgotOpen(false);
    setForgotStage("request");
  }

  async function requestResetToken(event) {
    event.preventDefault();

    const data = await api("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: forgotForm.email.trim() })
    });

    setForgotForm((current) => ({
      ...current,
      token: data.resetToken || current.token || ""
    }));
    setForgotStage("reset");
    showToast(data.message || "Reset token generated");
  }

  async function submitPasswordReset(event) {
    event.preventDefault();

    await api("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        email: forgotForm.email.trim(),
        token: forgotForm.token.trim(),
        newPassword: forgotForm.newPassword
      })
    });

    setForgotOpen(false);
    setForgotStage("request");
    setAuthForm((current) => ({ ...current, email: forgotForm.email.trim(), password: "" }));
    showToast("Password updated. Please log in.");
    setMode("login");
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
    const payload = {
      email: authForm.email.trim(),
      password: authForm.password
    };

    if (mode === "register") {
      payload.name = authForm.name.trim();
    }

    const data = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setToken(data.token);
    setUser(data.user);
    setAuthForm(emptyAuthForm);
    showToast(mode === "login" ? "Welcome back" : "Account created");
  }

  async function handleTaskCreate(event) {
    event.preventDefault();

    const payload = {
      title: taskForm.title.trim(),
      description: taskForm.description.trim(),
      dueDate: taskForm.dueDate || null,
      priority: taskForm.priority,
      status: taskForm.status
    };

    if (!payload.title) {
      showToast("Title is required");
      return;
    }

    await api("/tasks", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setTaskForm(emptyTaskForm);
    await loadTasks();
    showToast("Task created");
  }

  async function saveEditedTask(event) {
    event.preventDefault();
    if (!editingTask) return;

    const payload = {
      title: editingTask.title.trim(),
      description: editingTask.description.trim(),
      dueDate: editingTask.dueDate || null,
      priority: editingTask.priority,
      status: editingTask.status
    };

    await api(`/tasks/${editingTask.id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    setEditingTask(null);
    await loadTasks();
    showToast("Task updated");
  }

  async function deleteTask(taskId) {
    if (!window.confirm("Delete this task?")) {
      return;
    }

    await api(`/tasks/${taskId}`, { method: "DELETE" });
    await loadTasks();
    showToast("Task deleted");
  }

  async function cycleTaskStatus(task) {
    await api(`/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: nextStatus(task.status) })
    });

    await loadTasks();
    showToast("Status updated");
  }

  const dashboardNote =
    filters.priority !== "all" || filters.status !== "all" || filters.search.trim()
      ? `${filteredTasks.length} task(s) match the current filters`
      : `${tasks.length} task(s) in your workspace`;

  return (
    <div className="app">
      <div className="bg bg-left" />
      <div className="bg bg-right" />

      <main className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Task Manager</p>
            <h1>TaskFlow Manager</h1>
            <p className="subtitle">
              Track tasks by priority, deadlines, and progress with realtime updates.
            </p>
          </div>

          <div className="topbar-actions">
            <span className={`status-pill ${realtimeState}`}>{realtimeState}</span>
            {isAuthenticated ? (
              <button className="btn btn-secondary" onClick={logout} type="button">
                Logout
              </button>
            ) : null}
          </div>
        </header>

        {!isAuthenticated ? (
          <section className="panel auth-panel">
            <div className="tab-row">
              <button
                type="button"
                className={`tab ${mode === "login" ? "active" : ""}`}
                onClick={() => setMode("login")}
              >
                Login
              </button>
              <button
                type="button"
                className={`tab ${mode === "register" ? "active" : ""}`}
                onClick={() => setMode("register")}
              >
                Register
              </button>
            </div>

            <form className="form-grid" onSubmit={handleAuthSubmit}>
              {mode === "register" ? (
                <label>
                  Name
                  <input
                    value={authForm.name}
                    onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
                    placeholder="Your full name"
                    required
                  />
                </label>
              ) : null}

              <label>
                Email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                  placeholder="you@example.com"
                  required
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                  placeholder="••••••••"
                  required
                />
              </label>

              {mode === "login" ? (
                <button className="text-button" type="button" onClick={openForgotPassword}>
                  Forgot password?
                </button>
              ) : null}

              <button className="btn btn-primary" type="submit">
                {mode === "login" ? "Login" : "Create account"}
              </button>
            </form>
          </section>
        ) : (
          <>
            <section className="panel stats-panel">
              <div>
                <p className="eyebrow">Workspace overview</p>
                <h2>Your tasks</h2>
                <p className="subtitle">{dashboardNote}</p>
              </div>
              <div className="stats-grid">
                <Stat label="Total" value={stats.total} />
                <Stat label="Todo" value={stats.todo} />
                <Stat label="In Progress" value={stats.inProgress} />
                <Stat label="Done" value={stats.done} />
                <Stat label="Overdue" value={stats.overdue} accent />
              </div>
            </section>

            <section className="stack-layout">
              <div className="panel">
                <h2>Create Task</h2>
                <form className="form-grid" onSubmit={handleTaskCreate}>
                  <label>
                    Title
                    <input
                      value={taskForm.title}
                      onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
                      placeholder="Task title"
                      required
                    />
                  </label>

                  <label>
                    Description
                    <textarea
                      rows="4"
                      value={taskForm.description}
                      onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })}
                      placeholder="Task details"
                    />
                  </label>

                  <div className="split-grid">
                    <label>
                      Deadline
                      <input
                        type="date"
                        value={taskForm.dueDate}
                        onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })}
                      />
                    </label>

                    <label>
                      Priority
                      <select
                        value={taskForm.priority}
                        onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>

                    <label>
                      Status
                      <select
                        value={taskForm.status}
                        onChange={(event) => setTaskForm({ ...taskForm, status: event.target.value })}
                      >
                        <option value="todo">Todo</option>
                        <option value="in-progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                    </label>
                  </div>

                  <button className="btn btn-primary" type="submit">
                    Add Task
                  </button>
                </form>
              </div>

              <div className="panel">
                <div className="toolbar">
                  <div>
                    <h2>Task Board</h2>
                    <p className="subtitle">Filter by priority and deadline, then sort the list your way.</p>
                  </div>

                  <div className="toolbar-controls">
                    <input
                      type="search"
                      placeholder="Search tasks"
                      value={filters.search}
                      onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                    />

                    <select
                      value={filters.priority}
                      onChange={(event) => setFilters({ ...filters, priority: event.target.value })}
                    >
                      <option value="all">Priority: All</option>
                      <option value="high">Priority: High</option>
                      <option value="medium">Priority: Medium</option>
                      <option value="low">Priority: Low</option>
                    </select>

                    <select
                      value={filters.status}
                      onChange={(event) => setFilters({ ...filters, status: event.target.value })}
                    >
                      <option value="all">Status: All</option>
                      <option value="todo">Todo</option>
                      <option value="in-progress">In Progress</option>
                      <option value="done">Done</option>
                    </select>

                    <select
                      value={filters.sortBy}
                      onChange={(event) => setFilters({ ...filters, sortBy: event.target.value })}
                    >
                      <option value="updated">Sort: Recent</option>
                      <option value="due-asc">Due: Asc</option>
                      <option value="due-desc">Due: Desc</option>
                      <option value="priority">Sort: Priority</option>
                    </select>
                  </div>
                </div>

                <div className="task-list">
                  {filteredTasks.length === 0 ? (
                    <div className="empty-state">No tasks match the current filters.</div>
                  ) : (
                    filteredTasks.map((task) => {
                      const tone = getTaskTone(task);
                      return (
                        <article key={task.id} className={`task-card ${tone}`}>
                          <div className="task-top">
                            <div>
                              <h3>{task.title}</h3>
                              <p className="task-meta">
                                {task.status} · Due {formatDueDate(task.dueDate)}
                              </p>
                            </div>
                            <span className={`badge ${task.priority}`}>{task.priority}</span>
                          </div>

                          <p className="task-description">{task.description || "No description"}</p>

                          <div className="task-actions">
                            <button className="btn btn-secondary" onClick={() => cycleTaskStatus(task)} type="button">
                              Next Status
                            </button>
                            <button className="btn btn-secondary" onClick={() => setEditingTask(task)} type="button">
                              Edit
                            </button>
                            <button className="btn btn-secondary" onClick={() => deleteTask(task.id)} type="button">
                              Delete
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {editingTask ? (
        <div className="modal-backdrop" onClick={() => setEditingTask(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Task</h3>
              <button className="icon-button" type="button" onClick={() => setEditingTask(null)}>
                ×
              </button>
            </div>

            <form className="form-grid" onSubmit={saveEditedTask}>
              <label>
                Title
                <input
                  value={editingTask.title}
                  onChange={(event) => setEditingTask({ ...editingTask, title: event.target.value })}
                  required
                />
              </label>

              <label>
                Description
                <textarea
                  rows="4"
                  value={editingTask.description}
                  onChange={(event) => setEditingTask({ ...editingTask, description: event.target.value })}
                />
              </label>

              <div className="split-grid">
                <label>
                  Deadline
                  <input
                    type="date"
                    value={toDateInputValue(editingTask.dueDate)}
                    onChange={(event) => setEditingTask({ ...editingTask, dueDate: event.target.value })}
                  />
                </label>

                <label>
                  Priority
                  <select
                    value={editingTask.priority}
                    onChange={(event) => setEditingTask({ ...editingTask, priority: event.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>

                <label>
                  Status
                  <select
                    value={editingTask.status}
                    onChange={(event) => setEditingTask({ ...editingTask, status: event.target.value })}
                  >
                    <option value="todo">Todo</option>
                    <option value="in-progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </label>
              </div>

              <div className="modal-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setEditingTask(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit">
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {forgotOpen ? (
        <div className="modal-backdrop" onClick={closeForgotPassword}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Reset password</h3>
              <button className="icon-button" type="button" onClick={closeForgotPassword}>
                ×
              </button>
            </div>

            {forgotStage === "request" ? (
              <form className="form-grid" onSubmit={requestResetToken}>
                <p className="subtitle">
                  Enter your email and we will send a reset link token to your inbox.
                </p>
                <label>
                  Email
                  <input
                    type="email"
                    value={forgotForm.email}
                    onChange={(event) => setForgotForm({ ...forgotForm, email: event.target.value })}
                    placeholder="you@example.com"
                    required
                  />
                </label>

                <div className="modal-actions">
                  <button className="btn btn-secondary" type="button" onClick={closeForgotPassword}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" type="submit">
                    Send reset token
                  </button>
                </div>
              </form>
            ) : (
              <form className="form-grid" onSubmit={submitPasswordReset}>
                <p className="subtitle">
                  Paste the token from your email and choose a new password.
                </p>

                <label>
                  Email
                  <input type="email" value={forgotForm.email} readOnly />
                </label>

                <label>
                  Reset token
                  <input
                    value={forgotForm.token}
                    onChange={(event) => setForgotForm({ ...forgotForm, token: event.target.value })}
                    placeholder="Paste the token here"
                    required
                  />
                </label>

                <label>
                  New password
                  <input
                    type="password"
                    value={forgotForm.newPassword}
                    onChange={(event) => setForgotForm({ ...forgotForm, newPassword: event.target.value })}
                    placeholder="Choose a new password"
                    required
                  />
                </label>

                <div className="modal-actions">
                  <button className="btn btn-secondary" type="button" onClick={closeForgotPassword}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" type="submit">
                    Reset password
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
      {loading ? <div className="loading-bar" /> : null}
    </div>
  );
}

function Stat({ label, value, accent = false }) {
  return (
    <div className={`stat-card ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
