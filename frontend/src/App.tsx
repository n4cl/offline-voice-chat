import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "./app.css";
import { AudioCapture, type AudioChunkPayload } from "./lib/audioCapture";
import {
  type ConnectionState,
  type MetricSnapshot,
  type ServerEvent,
  type WSClient,
} from "./lib/wsClient";
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
  placeholder?: boolean;
  generationId?: string;
  audio?: {
    url: string;
    filename: string;
  };
};

type Notice = {
  title: string;
  message: string;
  kind?: "config" | "general";
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

const DEFAULT_AUDIO_CHUNK_MS = 20;
const MIN_AUDIO_CHUNK_MS = 20;
const MAX_AUDIO_CHUNK_MS = 50;
const CONFIG_WARNING_TIMEOUT_MS = 1000;

/**
 * WS接続先を決定する。環境変数があれば優先し、なければローカルを使う。
 */
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

/**
 * 会話セッションID（プロトコル上の sessionId）を生成する。
 */
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

/**
 * 低レベルエラーをユーザー向けメッセージに変換する。
 */
const resolveErrorMessage = (message: string) => {
  if (message === "websocket error") {
    return "WebSocket接続エラーが発生しました。サーバやURLを確認してください。";
  }
  return message;
};

/**
 * エラー種別ごとの対処ヒントを返す。
 */
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

/**
 * チャット表示用の時刻フォーマット。
 */
const formatTimestamp = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * 任意のメトリクス値を表示用に整形する。
 */
const formatMetric = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) {
    return "--";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${Math.round(value)}ms`;
};

const normalizeAudioChunkMs = (value: number) => {
  if (value < MIN_AUDIO_CHUNK_MS || value > MAX_AUDIO_CHUNK_MS) {
    return DEFAULT_AUDIO_CHUNK_MS;
  }
  return value;
};

/**
 * Base64文字列をバイト列へ変換する（ブラウザ/Node両対応）。
 */
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

/**
 * 応答生成中の仮メッセージを作成する。
 */
const createPendingAssistant = () => ({
  id: `assistant-${Date.now()}`,
  speaker: "assistant" as const,
  text: "応答を生成しています…",
  timestamp: formatTimestamp(),
  status: "処理中",
  phase: "pending" as const,
});

const createVoicePlaceholderMessage = () => ({
  id: `voice-${Date.now()}`,
  speaker: "user" as const,
  text: "音声入力を受け付けました。",
  timestamp: formatTimestamp(),
  status: "音声入力（仮）",
  placeholder: true,
});

export default function App() {
  // 音声入力状態（Voice State）
  const [voiceActive, setVoiceActive] = useState(false);
  // 会話セッションID（プロトコル上の sessionId）
  const [sessionId] = useState<string>(() => createSessionId());
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [boundary, setBoundary] = useState<BoundaryView | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>(() => INITIAL_MESSAGES);
  const [textInput, setTextInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [metrics, setMetrics] = useState<MetricSnapshot | null>(null);
  const [audioChunkMs, setAudioChunkMs] = useState(DEFAULT_AUDIO_CHUNK_MS);
  const clientRef = useRef<WSClient | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<string[]>([]);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const configReceivedRef = useRef(false);
  const configWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsUrl = useMemo(() => resolveWebSocketUrl(), []);

  const clearConfigWarningTimer = () => {
    if (configWarningTimerRef.current) {
      clearTimeout(configWarningTimerRef.current);
      configWarningTimerRef.current = null;
    }
  };

  const resetConfigState = () => {
    configReceivedRef.current = false;
    setAudioChunkMs(DEFAULT_AUDIO_CHUNK_MS);
    setNotice((current) => (current?.kind === "config" ? null : current));
    clearConfigWarningTimer();
  };

  const scheduleConfigWarning = () => {
    clearConfigWarningTimer();
    configWarningTimerRef.current = setTimeout(() => {
      if (configReceivedRef.current) {
        return;
      }
      console.warn("CONFIG not received; using default audioChunkMs");
      setNotice((current) => {
        if (current && current.kind !== "config") {
          return current;
        }
        return {
          title: "音声設定",
          message: `CONFIGを取得できなかったため、${DEFAULT_AUDIO_CHUNK_MS}msで継続します。`,
          kind: "config",
        };
      });
    }, CONFIG_WARNING_TIMEOUT_MS);
  };

  useEffect(() => {
    const client = acquireWSClient({
      url: wsUrl,
      onEvent: (event: ServerEvent) => {
        if (event.type === "CONFIG") {
          const normalized = normalizeAudioChunkMs(event.audioChunkMs);
          if (normalized !== event.audioChunkMs) {
            console.warn("invalid audioChunkMs received; using default", event.audioChunkMs);
          }
          configReceivedRef.current = true;
          setAudioChunkMs(normalized);
          setNotice((current) => (current?.kind === "config" ? null : current));
        }
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
          setMessages((prev) => {
            const index = [...prev]
              .map((message, idx) => ({ message, idx }))
              .reverse()
              .find(
                ({ message }) =>
                  message.speaker === "user" && message.placeholder === true,
              )?.idx;
            if (index === undefined) {
              return [
                ...prev,
                {
                  id: `user-${Date.now()}`,
                  speaker: "user",
                  text: event.text,
                  timestamp: formatTimestamp(),
                  status: "文字起こし",
                },
              ];
            }
            return prev.map((message, idx) =>
              idx === index
                ? {
                    ...message,
                    text: event.text,
                    status: "文字起こし",
                    placeholder: false,
                  }
                : message,
            );
          });
        }
        if (event.type === "METRICS_UPDATE") {
          setMetrics(event.metrics);
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
      onConnectionChange: (state) => {
        setConnectionState(state);
        if (state === "connecting" || state === "reconnecting") {
          resetConfigState();
          return;
        }
        if (state === "open") {
          scheduleConfigWarning();
        }
        if (state === "closed") {
          clearConfigWarningTimer();
        }
      },
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
      clearConfigWarningTimer();
      if (audioCaptureRef.current) {
        audioCaptureRef.current.stop();
        audioCaptureRef.current = null;
      }
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

  /**
   * マイク権限とストリームを取得する。
   */
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

  const handleAudioCaptureError = (error: Error) => {
    setNotice({
      title: "音声入力エラー",
      message: error.message || "音声入力の初期化に失敗しました。",
    });
    setVoiceActive(false);
    setUiState("idle");
  };

  const createAudioCapture = () => {
    const getUserMedia = async (constraints: MediaStreamConstraints) => {
      if (micStreamRef.current) {
        return micStreamRef.current;
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;
      return stream;
    };
    const capture = new AudioCapture({
      getUserMedia,
      chunkDurationMs: audioChunkMs,
    });
    capture.onSpeechStart((timestampMs) => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      client.sendUserSpeechStart(timestampMs);
    });
    capture.onSpeechEnd((timestampMs) => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      setMessages((prev) => [...prev, createVoicePlaceholderMessage()]);
      client.sendUserSpeechEnd(timestampMs);
    });
    capture.onChunk((payload: AudioChunkPayload) => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      client.sendAudioChunk({
        meta: {
          ...payload.meta,
          sessionId,
        },
        data: payload.data,
      });
    });
    capture.onError(handleAudioCaptureError);
    return capture;
  };

  /**
   * 音声再生のためにAudioContextを有効化する。
   */
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

  /**
   * メッセージ本文をクリップボードへコピーする。
   */
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

  /**
   * 指定メッセージの音声を再生する。
   */
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

  /**
   * エラー後の再試行（接続の再確立）を行う。
   */
  const handleRetry = () => {
    setErrorState(null);
    const client = clientRef.current;
    if (client) {
      client.connect();
      if (voiceActive) {
        client.startSession(sessionId);
      }
    }
  };

  /**
   * エラー時の安全終了（音声入力停止 + 会話セッション停止）。
   */
  const handleSafeEnd = () => {
    const client = clientRef.current;
    stopMicrophone();
    if (client) {
      client.stopSession();
    }
    setVoiceActive(false);
    setUiState("idle");
    setErrorState(null);
  };

  /**
   * テキスト入力を送信し、仮の応答メッセージを追加する。
   */
  const handleSendText = () => {
    if (voiceActive) {
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
    if (inputRef.current) {
      inputRef.current.style.height = "";
    }
  };

  /**
   * テキスト入力欄の高さを内容に合わせて調整する（上限6行）。
   */
  const adjustInputHeight = (target: HTMLTextAreaElement) => {
    target.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(target).lineHeight || "0");
    const maxHeight = lineHeight > 0 ? lineHeight * 6 : 160;
    target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`;
  };

  /**
   * IME変換中のEnter送信を抑止しつつ、修飾キー+Enterで送信する。
   */
  const handleTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    const nativeEvent = event.nativeEvent as { isComposing?: boolean } | undefined;
    if (event.isComposing || nativeEvent?.isComposing) {
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      handleSendText();
    }
  };

  /**
   * マイク入力を停止し、トラックを解放する。
   */
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

  /**
   * 音声入力を開始する（権限取得 + 再生準備 + セッション開始）。
   */
  const handleStart = async () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    const hasPermission = await requestMicrophonePermission();
    if (!hasPermission) {
      setVoiceActive(false);
      setUiState("idle");
      return;
    }
    const playbackReady = await ensureAudioPlayback();
    setVoiceActive(true);
    setUiState("listening");
    if (playbackReady) {
      setNotice(null);
    }
    if (audioCaptureRef.current) {
      audioCaptureRef.current.stop();
      audioCaptureRef.current = null;
    }
    const capture = createAudioCapture();
    audioCaptureRef.current = capture;
    await capture.start();
    client.startSession(sessionId);
  };

  /**
   * 音声入力を停止する（マイク停止 + セッション停止）。
   */
  const handleStop = () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    if (audioCaptureRef.current) {
      audioCaptureRef.current.stop();
      audioCaptureRef.current = null;
    }
    stopMicrophone();
    client.stopSession();
    setVoiceActive(false);
    setUiState("idle");
  };

  const handleVoiceToggle = () => {
    if (voiceActive) {
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
  const metricsLabel = metrics
    ? `ASR ${formatMetric(metrics.asrMs)} | LLM ${formatMetric(metrics.llmMs)} | TTS ${formatMetric(metrics.ttsMs)} | Total ${formatMetric(metrics.totalMs)}`
    : "ASR -- | LLM -- | TTS -- | Total --";

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
            <textarea
              id="chat-input"
              className="chat-input"
              rows={1}
              placeholder="お話してみましょう"
              value={textInput}
              ref={inputRef}
              onChange={(event) => {
                setTextInput(event.target.value);
                adjustInputHeight(event.currentTarget);
              }}
              onKeyDown={handleTextKeyDown}
              disabled={voiceActive}
            />
            <button
              className="send-button"
              type="button"
              onClick={handleSendText}
              disabled={voiceActive}
            >
              送信
            </button>
            <button
              className="voice-toggle"
              type="button"
              aria-pressed={voiceActive}
              onClick={handleVoiceToggle}
            >
              <span className="voice-indicator" aria-hidden="true" />
              {voiceActive ? "音声入力停止" : "音声入力開始"}
            </button>
          </section>
          <p className="input-hint">テキストと音声はどちらも同等に利用できます。</p>
          <div className="footer-meta-row">
            <span className="metrics-hint">{metricsLabel}</span>
            <span className="footer-meta">Boundary: {boundaryLabel}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
