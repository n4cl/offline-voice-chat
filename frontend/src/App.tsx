import { useEffect, useMemo, useRef, useState } from "react";
import "./app.css";
import { type ConnectionState, type ServerEvent, type WSClient } from "./lib/wsClient";
import { acquireWSClient, releaseWSClient } from "./lib/wsClientManager";

type BoundaryView = {
  scope: string;
  allowedRanges: string[];
};

type UIState = "idle" | "listening" | "thinking" | "speaking";

type ChatSpeaker = "assistant" | "user";

type ChatMessage = {
  id: string;
  speaker: ChatSpeaker;
  text: string;
  timestamp: string;
  status: string;
};

type Notice = {
  title: string;
  message: string;
};

const INITIAL_MESSAGES: ChatMessage[] = [];

const UI_STATE_LABEL: Record<UIState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  open: "Connected",
  closed: "Closed",
  reconnecting: "Reconnecting",
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

const getStatusTone = (state: UIState) => {
  if (state === "speaking") {
    return "accent";
  }
  if (state === "thinking") {
    return "warm";
  }
  if (state === "listening") {
    return "cool";
  }
  return "muted";
};

const getConnectionTone = (state: ConnectionState) => {
  if (state === "open") {
    return "cool";
  }
  if (state === "connecting" || state === "reconnecting") {
    return "warm";
  }
  return "muted";
};

const resolveErrorMessage = (message: string) => {
  if (message === "websocket error") {
    return "WebSocket接続エラーが発生しました。サーバやURLを確認してください。";
  }
  return message;
};

export default function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId] = useState<string>(() => createSessionId());
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [boundary, setBoundary] = useState<BoundaryView | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [messages] = useState<ChatMessage[]>(() => INITIAL_MESSAGES);
  const clientRef = useRef<WSClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wsUrl = useMemo(() => resolveWebSocketUrl(), []);

  useEffect(() => {
    const client = acquireWSClient({
      url: wsUrl,
      onEvent: (event: ServerEvent) => {
        if (event.type === "BOUNDARY_STATUS") {
          setBoundary({ scope: event.scope, allowedRanges: event.allowedRanges });
        }
        if (event.type === "ERROR") {
          setNotice({ title: "エラー", message: event.message });
          setUiState("idle");
        }
        if (event.type === "PARTIAL_TRANSCRIPT") {
          setUiState("listening");
        }
        if (event.type === "FINAL_TRANSCRIPT") {
          setUiState("thinking");
        }
        if (event.type === "ASSISTANT_SPEAKING") {
          setUiState("speaking");
        }
        if (event.type === "ASSISTANT_STOPPED") {
          setUiState("idle");
        }
      },
      onConnectionChange: (state) => setConnectionState(state),
      onError: (error) =>
        setNotice({ title: "通信エラー", message: resolveErrorMessage(error.message) }),
    });
    client.setSessionId(sessionId);
    client.connect();
    clientRef.current = client;
    return () => {
      client.updateHandlers({
        onEvent: undefined,
        onError: undefined,
        onConnectionChange: undefined,
      });
      clientRef.current = null;
      releaseWSClient();
    };
  }, [sessionId, wsUrl]);

  const requestMicrophonePermission = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice({
        title: "マイク未対応",
        message: "このブラウザではマイクを利用できません。",
      });
      return false;
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch (error) {
      setNotice({
        title: "マイク権限",
        message: "マイク利用が拒否されました。ブラウザの設定で許可してください。",
      });
      return false;
    }
  };

  const ensureAudioPlayback = async () => {
    if (typeof AudioContext === "undefined") {
      return true;
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    try {
      await audioContextRef.current.resume();
      return true;
    } catch (error) {
      setNotice({
        title: "自動再生制約",
        message:
          "音声の自動再生がブロックされています。開始ボタンを再度押すか、ブラウザ設定を確認してください。",
      });
      return false;
    }
  };

  const handleStart = async () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    const hasPermission = await requestMicrophonePermission();
    if (!hasPermission) {
      setSessionActive(false);
      setUiState("idle");
      return;
    }
    const playbackReady = await ensureAudioPlayback();
    setSessionActive(true);
    setUiState("listening");
    if (playbackReady) {
      setNotice(null);
    }
    client.startSession(sessionId);
  };

  const handleStop = () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    client.stopSession();
    setSessionActive(false);
    setUiState("idle");
  };

  const handleVoiceToggle = () => {
    if (sessionActive) {
      handleStop();
      return;
    }
    handleStart();
  };

  const connectionLabel = CONNECTION_LABEL[connectionState];
  const statusLabel = UI_STATE_LABEL[uiState];
  const boundaryLabel = boundary
    ? `${boundary.scope} (${boundary.allowedRanges.join(", ")})`
    : "Unknown";

  return (
    <main className="app-shell">
      <div className="app-backdrop" aria-hidden="true">
        <span className="orb orb-amber" />
        <span className="orb orb-jade" />
        <span className="orb orb-gold" />
        <span className="grain" />
      </div>

      <div className="app-content">
        <header className="app-header">
          <div className="title-block">
            <h1>OFFLINE VOICE CHAT</h1>
          </div>
          <div className="status-card">
            <div className="status-row">
              <span className={`status-dot status-dot--${getConnectionTone(connectionState)}`} />
              <span>接続: {connectionLabel}</span>
            </div>
            <div className="status-row">
              <span className={`status-dot status-dot--${getStatusTone(uiState)}`} />
              <span>状態: {statusLabel}</span>
            </div>
          </div>
        </header>
        {notice ? (
          <div className="error-banner" role="alert" aria-live="polite">
            <div className="error-content">
              <p className="error-title">{notice.title}</p>
              <p className="error-message">{notice.message}</p>
            </div>
            <button
              className="error-dismiss"
              type="button"
              onClick={() => setNotice(null)}
              aria-label="エラー通知を閉じる"
            >
              閉じる
            </button>
          </div>
        ) : null}

        <section className="chat-log" aria-label="チャットログ">
          {messages.length === 0 ? (
            <div className="chat-empty" role="status">
              <p>まだ会話がありません。</p>
              <p>音声入力を開始するか、テキストで話しかけてみましょう。</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                key={message.id}
                className={`chat-bubble chat-bubble--${message.speaker} fade-up`}
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <p className="chat-role">
                  {message.speaker === "assistant" ? "Assistant" : "You"}
                </p>
                <p className="chat-text">{message.text}</p>
                <div className="chat-meta">
                  <span>{message.timestamp}</span>
                  <span>{message.status}</span>
                </div>
              </article>
            ))
          )}
        </section>

        <footer className="app-footer" aria-label="フッター">
          <section className="input-bar" aria-label="入力バー">
            <button className="icon-button" type="button" aria-label="添付">
              +
            </button>
            <label className="sr-only" htmlFor="chat-input">
              メッセージ
            </label>
            <input
              id="chat-input"
              className="chat-input"
              type="text"
              placeholder="お話してみましょう"
            />
            <button className="send-button" type="button">
              送信
            </button>
            <button
              className="voice-toggle"
              type="button"
              aria-pressed={sessionActive}
              onClick={handleVoiceToggle}
            >
              <span className="voice-indicator" aria-hidden="true" />
              {sessionActive ? "音声入力停止" : "音声入力開始"}
            </button>
          </section>
          <div className="footer-meta-row">
            <span className="metrics-hint">ASR 320ms | LLM 1.1s | TTS 240ms</span>
            <span className="footer-meta">Boundary: {boundaryLabel}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
