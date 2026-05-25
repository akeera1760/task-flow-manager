import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import http from "http";
import crypto from "crypto";
import { sendPasswordResetEmail } from "./mailer.js";
import { connectToDatabase } from "./db.js";
import { authMiddleware, signToken } from "./auth.js";
import { initWebSocket, notifyUser } from "./realtime.js";
import { Task } from "./models/Task.js";
import { User } from "./models/User.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "task-management-api", stack: "MERN" });
});
app.get("/api/test-email", async (req, res) => {
  try {
    const result = await sendPasswordResetEmail({
      to: "test@example.com",
      name: "Test",
      token: "TESTTOKEN"
    });

    if (result.sent) {
      return res.json({ message: "Email sent" });
    }

    return res.status(500).json({ message: "Email not sent", reason: result.reason });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Email failed", error: error.message });
  }
});
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "name, email, and password are required" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    return res.status(409).json({ message: "User already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const createdUser = await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash
  });

  const token = signToken(createdUser);
  return res.status(201).json({
    token,
    user: {
      id: String(createdUser._id),
      name: createdUser.name,
      email: createdUser.email
    }
  });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !user.passwordHash) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email
    }
  });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "email is required" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return res.json({ message: "If the account exists, a reset token has been generated." });
  }

  const now = new Date();
  const cooldownMs = 60 * 1000;
  if (user.resetPasswordRequestedAt && now.getTime() - new Date(user.resetPasswordRequestedAt).getTime() < cooldownMs) {
    return res.status(429).json({ message: "Please wait a minute before requesting another reset email." });
  }

  const resetToken = crypto.randomBytes(24).toString("hex");
  user.resetPasswordToken = resetToken;
  user.resetPasswordExpires = new Date(now.getTime() + 1000 * 60 * 30);
  user.resetPasswordRequestedAt = now;
  await user.save();

  const emailResult = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    token: resetToken
  });

  if (!emailResult.sent && emailResult.reason !== "SMTP_NOT_CONFIGURED") {
    return res.status(503).json({
      message: "Unable to send reset email right now. Please try again later."
    });
  }

  return res.json({
    message: emailResult.sent
      ? "Password reset email sent. Check your inbox and spam folder."
      : "Reset token generated. SMTP is not configured, so the token was not emailed.",
    ...(emailResult.sent ? {} : { resetToken })
  });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email, token, newPassword } = req.body;

  if (!email || !token || !newPassword) {
    return res.status(400).json({ message: "email, token, and newPassword are required" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({
    email: normalizedEmail,
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: new Date() }
  });

  if (!user) {
    return res.status(400).json({ message: "Invalid or expired reset token" });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  user.resetPasswordRequestedAt = null;
  await user.save();

  return res.json({ message: "Password updated successfully" });
});

app.get("/api/tasks", authMiddleware, async (req, res) => {
  const tasks = await Task.find({ userId: req.user.userId }).sort({ updatedAt: -1 }).lean();

  return res.json({
    tasks: tasks.map((task) => ({
      ...task,
      id: String(task._id),
      userId: String(task.userId)
    }))
  });
});

app.post("/api/tasks", authMiddleware, async (req, res) => {
  const { title, description = "", dueDate = null, priority = "medium", status = "todo" } = req.body;

  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: "title is required" });
  }

  const allowedPriority = ["low", "medium", "high"];
  const allowedStatus = ["todo", "in-progress", "done"];

  if (!allowedPriority.includes(priority) || !allowedStatus.includes(status)) {
    return res.status(400).json({ message: "Invalid priority or status" });
  }

  const createdTask = await Task.create({
    userId: req.user.userId,
    title: String(title).trim(),
    description: String(description || "").trim(),
    dueDate: dueDate || null,
    priority,
    status
  });

  const task = {
    ...createdTask.toObject(),
    id: String(createdTask._id),
    userId: String(createdTask.userId)
  };

  notifyUser(req.user.userId, { type: "task:created", task });
  return res.status(201).json({ task });
});

app.put("/api/tasks/:id", authMiddleware, async (req, res) => {
  const taskId = req.params.id;
  const updates = req.body || {};

  const allowedPriority = ["low", "medium", "high"];
  const allowedStatus = ["todo", "in-progress", "done"];

  if (updates.priority && !allowedPriority.includes(updates.priority)) {
    return res.status(400).json({ message: "Invalid priority" });
  }

  if (updates.status && !allowedStatus.includes(updates.status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  const task = await Task.findOne({ _id: taskId, userId: req.user.userId });
  if (!task) {
    return res.status(404).json({ message: "Task not found" });
  }

  if (updates.title !== undefined) {
    const trimmedTitle = String(updates.title).trim();
    if (!trimmedTitle) {
      return res.status(400).json({ message: "title cannot be empty" });
    }
    task.title = trimmedTitle;
  }

  if (updates.description !== undefined) {
    task.description = String(updates.description).trim();
  }

  if (updates.dueDate !== undefined) {
    task.dueDate = updates.dueDate || null;
  }

  if (updates.priority) {
    task.priority = updates.priority;
  }

  if (updates.status) {
    task.status = updates.status;
  }

  await task.save();

  const updatedTask = {
    ...task.toObject(),
    id: String(task._id),
    userId: String(task.userId)
  };

  notifyUser(req.user.userId, { type: "task:updated", task: updatedTask });
  return res.json({ task: updatedTask });
});

app.delete("/api/tasks/:id", authMiddleware, async (req, res) => {
  const task = await Task.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });

  if (!task) {
    return res.status(404).json({ message: "Task not found" });
  }

  notifyUser(req.user.userId, { type: "task:deleted", taskId: String(task._id) });
  return res.status(204).send();
});

async function startServer() {
  try {
    await connectToDatabase();
    initWebSocket(server);

    server.listen(PORT, () => {
      console.log(`Task API listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
