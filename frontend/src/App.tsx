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
  phase?: "pending" | "ready";
  generationId?: string;
  audio?: {
    url: string;
    filename: string;
  };
};

type Notice = {
  title: string;
  message: string;
};

type ErrorState = {
  code: string;
  message: string;
  hint: string;
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

const resolveErrorHint = (code: string) => {
  switch (code) {
    case "PERMISSION_DENIED":
      return "マイクの権限が必要です。ブラウザの設定で許可してください。";
    case "DEVICE_UNAVAILABLE":
      return "マイクが利用できません。接続を確認してください。";
    case "ASR_FAILED":
      return "ローカルASRサービスの起動を確認してください。";
    case "LLM_FAILED":
      return "ローカルLLMサービスの起動を確認してください。";
    case "TTS_FAILED":
      return "ローカルTTSサービスの起動を確認してください。";
    case "BOUNDARY_VIOLATION":
      return "通信境界違反が検出されました。設定を見直してください。";
    case "CHANNEL_DISCONNECTED":
      return "接続が切断されました。再接続をお試しください。";
    default:
      return "しばらく待って再試行してください。";
  }
};

const formatTimestamp = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const decodeBase64 = (payload: string) => {
  if (payload.length === 0) {
    return new Uint8Array();
  }
  if (typeof atob === "function") {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  // eslint-disable-next-line no-undef
  if (typeof Buffer !== "undefined") {
    // eslint-disable-next-line no-undef
    return Uint8Array.from(Buffer.from(payload, "base64"));
  }
  return new Uint8Array();
};

const createPendingAssistant = () => ({
  id: `assistant-${Date.now()}`,
  speaker: "assistant" as const,
  text: "応答を生成しています…",
  timestamp: formatTimestamp(),
  status: "処理中",
  phase: "pending" as const,
});

export default function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId] = useState<string>(() => createSessionId());
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [boundary, setBoundary] = useState<BoundaryView | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>(() => INITIAL_MESSAGES);
  const [textInput, setTextInput] = useState("");
  const clientRef = useRef<WSClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<string[]>([]);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const wsUrl = useMemo(() => resolveWebSocketUrl(), []);

  useEffect(() => {
    const client = acquireWSClient({
      url: wsUrl,
      onEvent: (event: ServerEvent) => {
        if (event.type === "BOUNDARY_STATUS") {
          setBoundary({ scope: event.scope, allowedRanges: event.allowedRanges });
        }
        if (event.type === "ERROR") {
          setErrorState({
            code: event.code,
            message: event.message,
            hint: resolveErrorHint(event.code),
          });
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
          setMessages((prev) => {
            const index = [...prev]
              .map((message, idx) => ({ message, idx }))
              .reverse()
              .find(
                ({ message }) =>
                  message.speaker === "assistant" && message.phase === "pending",
              )?.idx;
            if (index === undefined) {
              return [
                ...prev,
                {
                  ...createPendingAssistant(),
                  generationId: event.generationId,
                },
              ];
            }
            return prev.map((message, idx) =>
              idx === index
                ? {
                    ...message,
                    generationId: event.generationId,
                  }
                : message,
            );
          });
        }
        if (event.type === "ASSISTANT_STOPPED") {
          setUiState("idle");
        }
        if (event.type === "AUDIO_READY") {
          const mimeType = event.mimeType ?? "audio/wav";
          const filename = event.filename ?? `reply-${Date.now()}.wav`;
          const data = decodeBase64(event.audioBase64);
          const blob = new Blob([data], { type: mimeType });
          const url = URL.createObjectURL(blob);
          audioUrlsRef.current.push(url);
          setMessages((prev) => {
            let updated = false;
            const next = prev.map((message) => {
              if (event.generationId && message.generationId === event.generationId) {
                updated = true;
                return {
                  ...message,
                  text: "音声応答が届きました。",
                  status: "音声受信",
                  phase: "ready",
                  audio: { url, filename },
                };
              }
              return message;
            });
            if (updated) {
              return next;
            }
            const pendingIndex = [...next]
              .map((message, idx) => ({ message, idx }))
              .reverse()
              .find(
                ({ message }) =>
                  message.speaker === "assistant" && message.phase === "pending",
              )?.idx;
            if (pendingIndex === undefined) {
              return [
                ...next,
                {
                  id: `assistant-${Date.now()}`,
                  speaker: "assistant",
                  text: "音声応答が届きました。",
                  timestamp: formatTimestamp(),
                  status: "音声受信",
                  phase: "ready",
                  audio: { url, filename },
                },
              ];
            }
            return next.map((message, idx) =>
              idx === pendingIndex
                ? {
                    ...message,
                    text: "音声応答が届きました。",
                    status: "音声受信",
                    phase: "ready",
                    generationId: event.generationId ?? message.generationId,
                    audio: { url, filename },
                  }
                : message,
            );
          });
        }
      },
      onConnectionChange: (state) => setConnectionState(state),
      onError: (error) =>
        setErrorState({
          code: "CHANNEL_DISCONNECTED",
          message: resolveErrorMessage(error.message),
          hint: resolveErrorHint("CHANNEL_DISCONNECTED"),
        }),
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

  useEffect(() => {
    return () => {
      for (const url of audioUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      const stream = micStreamRef.current;
      if (stream && typeof stream.getTracks === "function") {
        for (const track of stream.getTracks()) {
          if (track?.stop) {
            track.stop();
          }
        }
      }
      micStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const node = chatBottomRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length]);

  const requestMicrophonePermission = async () => {
    if (micStreamRef.current) {
      return true;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice({
        title: "マイク未対応",
        message: "このブラウザではマイクを利用できません。",
      });
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!stream || typeof stream.getTracks !== "function") {
        setNotice({
          title: "マイク未対応",
          message: "この環境ではマイクを利用できません。",
        });
        return false;
      }
      micStreamRef.current = stream;
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

  const handleCopyMessage = async (text: string) => {
    if (!navigator.clipboard?.writeText) {
      setNotice({ title: "コピー", message: "この環境ではコピーできません。" });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ title: "コピー", message: "テキストをコピーしました。" });
    } catch (error) {
      setNotice({ title: "コピー", message: "コピーに失敗しました。" });
    }
  };

  const handlePlayAudio = async (messageId: string) => {
    const target = audioRefs.current[messageId];
    if (!target) {
      return;
    }
    try {
      await target.play();
    } catch (error) {
      setNotice({
        title: "再生エラー",
        message: "音声の再生に失敗しました。もう一度お試しください。",
      });
    }
  };

  const handleRetry = () => {
    setErrorState(null);
    const client = clientRef.current;
    if (client) {
      client.connect();
      if (sessionActive) {
        client.startSession(sessionId);
      }
    }
  };

  const handleSafeEnd = () => {
    const client = clientRef.current;
    stopMicrophone();
    if (client) {
      client.stopSession();
    }
    setSessionActive(false);
    setUiState("idle");
    setErrorState(null);
  };

  const handleSendText = () => {
    if (sessionActive) {
      return;
    }
    const trimmed = textInput.trim();
    if (!trimmed) {
      return;
    }
    const client = clientRef.current;
    if (!client) {
      return;
    }
    client.sendTextInput(trimmed);
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        speaker: "user",
        text: trimmed,
        timestamp: formatTimestamp(),
        status: "送信済み",
      },
      createPendingAssistant(),
    ]);
    setTextInput("");
  };

  const stopMicrophone = () => {
    const stream = micStreamRef.current;
    if (!stream || typeof stream.getTracks !== "function") {
      micStreamRef.current = null;
      return;
    }
    for (const track of stream.getTracks()) {
      if (track?.stop) {
        track.stop();
      }
    }
    micStreamRef.current = null;
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
    stopMicrophone();
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
        ) : errorState ? (
          <div className="error-banner" role="alert" aria-live="polite">
            <div className="error-content">
              <p className="error-title">エラー</p>
              <p className="error-message">{errorState.message}</p>
              <p className="error-hint">{errorState.hint}</p>
            </div>
            <div className="error-actions">
              <button className="error-action" type="button" onClick={handleRetry}>
                再試行
              </button>
              <button className="error-action" type="button" onClick={handleSafeEnd}>
                安全に終了
              </button>
            </div>
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
                {message.audio ? (
                  <div className="chat-audio">
                    <audio
                      ref={(node) => {
                        audioRefs.current[message.id] = node;
                      }}
                      src={message.audio.url}
                      aria-label="応答音声"
                      preload="metadata"
                    />
                    <div className="chat-actions">
                      <button
                        className="chat-action"
                        type="button"
                        onClick={() => handleCopyMessage(message.text)}
                        aria-label="コピー"
                      >
                        コピー
                      </button>
                      <button
                        className="chat-action"
                        type="button"
                        onClick={() => handlePlayAudio(message.id)}
                        aria-label="再生"
                      >
                        再生
                      </button>
                      <a
                        className="chat-action chat-action--link"
                        href={message.audio.url}
                        download={message.audio.filename}
                        aria-label="音声をダウンロード"
                      >
                        音声をダウンロード
                      </a>
                    </div>
                  </div>
                ) : null}
              </article>
            ))
          )}
          <div ref={chatBottomRef} data-testid="chat-bottom" />
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
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSendText();
                }
              }}
              disabled={sessionActive}
            />
            <button
              className="send-button"
              type="button"
              onClick={handleSendText}
              disabled={sessionActive}
            >
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
          <p className="input-hint">テキストと音声はどちらも同等に利用できます。</p>
          <div className="footer-meta-row">
            <span className="metrics-hint">ASR 320ms | LLM 1.1s | TTS 240ms</span>
            <span className="footer-meta">Boundary: {boundaryLabel}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
