import { useEffect, useMemo, useRef, useState } from "react";
import "./app.css";
import { type ConnectionState, type ServerEvent, WSClient } from "./lib/wsClient";

type BoundaryView = {
  scope: string;
  allowedRanges: string[];
};

const resolveWebSocketUrl = () => {
  const envUrl = import.meta.env?.VITE_WS_ENDPOINT as string | undefined;
  if (envUrl) {
    return envUrl;
  }
  if (typeof window === "undefined") {
    return "ws://localhost:8080/ws";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "localhost";
  return `${protocol}//${host}:8080/ws`;
};

const createSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export default function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId] = useState<string>(() => createSessionId());
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [boundary, setBoundary] = useState<BoundaryView | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const clientRef = useRef<WSClient | null>(null);
  const wsUrl = useMemo(() => resolveWebSocketUrl(), []);

  useEffect(() => {
    const client = new WSClient({
      url: wsUrl,
      onEvent: (event: ServerEvent) => {
        if (event.type === "BOUNDARY_STATUS") {
          setBoundary({ scope: event.scope, allowedRanges: event.allowedRanges });
        }
        if (event.type === "ERROR") {
          setLastError(event.message);
        }
      },
      onConnectionChange: (state) => setConnectionState(state),
      onError: (error) => setLastError(error.message),
    });
    client.setSessionId(sessionId);
    client.connect();
    clientRef.current = client;
    return () => client.disconnect();
  }, [sessionId, wsUrl]);

  const handleStart = () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    setSessionActive(true);
    client.startSession(sessionId);
  };

  const handleStop = () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    client.stopSession();
    setSessionActive(false);
  };

  const statusLabel = sessionActive ? "Active" : "Idle";
  const connectionLabel = connectionState === "open" ? "Connected" : connectionState;
  const boundaryLabel = boundary
    ? `${boundary.scope} (${boundary.allowedRanges.join(", ")})`
    : "Unknown";

  return (
    <main className="app">
      <h1>Offline Voice Chat</h1>
      <p>Local-only voice chat starter.</p>
      <div className="controls">
        <button type="button" onClick={handleStart} disabled={sessionActive}>
          Start
        </button>
        <button type="button" onClick={handleStop} disabled={!sessionActive}>
          Stop
        </button>
      </div>
      <div className="status">
        Status: {statusLabel} ({connectionLabel})
      </div>
      <div className="boundary">Boundary: {boundaryLabel}</div>
      {lastError ? <div className="boundary">Error: {lastError}</div> : null}
    </main>
  );
}
