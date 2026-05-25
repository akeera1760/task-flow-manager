import { WebSocketServer } from "ws";
import { verifyToken } from "./auth.js";

const userSockets = new Map();

export function initWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket, req) => {
    const host = req.headers.host;
    const url = new URL(req.url, `http://${host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      socket.close(1008, "Missing token");
      return;
    }

    const payload = verifyToken(token);
    if (!payload?.userId) {
      socket.close(1008, "Invalid token");
      return;
    }

    const userId = payload.userId;

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }

    userSockets.get(userId).add(socket);

    socket.on("close", () => {
      const sockets = userSockets.get(userId);
      if (!sockets) {
        return;
      }

      sockets.delete(socket);
      if (sockets.size === 0) {
        userSockets.delete(userId);
      }
    });

    socket.send(JSON.stringify({ type: "connected", message: "Realtime channel ready" }));
  });

  return wss;
}

export function notifyUser(userId, payload) {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) {
    return;
  }

  const message = JSON.stringify(payload);
  sockets.forEach((socket) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  });
}
