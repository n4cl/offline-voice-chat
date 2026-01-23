# Design Document

## Overview
本機能はローカル完結の音声対話Webアプリとして、ブラウザ上でハンズフリーの音声対話、全二重、割り込み（barge-in）を提供する。ユーザーはUIの開始操作を起点に音声入力を有効化し、対話の継続・中断を直感的に行える。処理はローカル環境内で完結し、音声・テキストの外部送信を禁止する。

対象ユーザーはローカル環境で安全に音声対話を行いたい利用者であり、運用者は遅延やエラーの観測性を確保したい。既存コードはなく、新規のローカル・オーケストレータとブラウザクライアントで構成する。

### Goals
- ローカル完結の音声対話（1.x, 11.x）
- ハンズフリー入力、全二重、割り込み（3.x, 5.x）
- 状態が分かるUIと回復性（6.x, 7.x）
- 音声入力とテキスト入力の併用（12.x）

### Non-Goals
- ブラウザ非アクティブ/バックグラウンドでの常時待受
- 多人数通話、ルーム管理、SFU
- 高度なAECのサーバ実装（MVP外）
- 音声を直接LLMへ入力するマルチモーダル

## Architecture

### Existing Architecture Analysis (if applicable)
既存実装なし（新規開発）。

### Architecture Pattern & Boundary Map
**Architecture Integration**:
- Selected pattern: Ports & Adapters（ローカルオーケストレータ中心）
- Domain/feature boundaries: ブラウザUI/音声I/O、ローカルオーケストレータ、ASR/LLM/TTSアダプタ
- Existing patterns preserved: なし
- New components rationale: ASR/LLM/TTSを差し替え可能にし、ローカル境界を保証
- Steering compliance: steering不在のため明示的な方針なし

```mermaid
graph TB
  subgraph Browser
    UI
    TextInput
    AudioCapture
    AudioPlayback
    WSClient
  end
  subgraph LocalHost
    Orchestrator
    SessionStore
    ASRAdapter
    LLMAdapter
    TTSAdapter
    BoundaryGuard
    Metrics
  end
  subgraph LocalServices
    ASRService
    LLMService
    TTSService
  end

  UI --> WSClient
  TextInput --> WSClient
  AudioCapture --> WSClient
  WSClient --> Orchestrator
  Orchestrator --> SessionStore
  Orchestrator --> ASRAdapter
  Orchestrator --> LLMAdapter
  Orchestrator --> TTSAdapter
  Orchestrator --> Metrics
  BoundaryGuard --> Orchestrator
  ASRAdapter --> ASRService
  LLMAdapter --> LLMService
  TTSAdapter --> TTSService
  Orchestrator --> WSClient
```

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Frontend / CLI | React + TypeScript (Vite) | UI/状態表示、音声I/O、双方向通信 | AudioWorkletを主経路、ユーザー操作でAudioContextを開始 |
| Backend / Services | Go 1.25 | ローカルオーケストレータ | API/WS境界と会話セッション管理 |
| Data / Storage | In-memory + Local file (opt-in) | 会話セッション/ログ | 保持期限と削除APIを用意 |
| Messaging / Events | WebSocket (github.com/coder/websocket) | 制御/音声チャンク | MVPはWS一本化 |
| Infrastructure / Runtime | Docker Compose, Localhost / RFC1918 | ローカル隔離 | RFC1918 + localhost のみ通信 |
| ASR | whisper.cpp (latest stable) | ローカル音声認識 | アダプタ経由 |
| LLM | llama.cpp server (latest stable) | ローカル推論 | OpenAI互換JSON |
| TTS | VOICEVOX Engine (latest stable) | 日本語TTS | 24kHz出力前提 |

## System Flows

ブラウザはページロード時にWS接続を確立し、テキスト入力は音声入力状態の開始/停止に関わらず利用可能とする。音声入力はユーザー操作でマイクを有効化したときのみ開始する。

**用語の整理（詳細は glossary.md を参照）**
- **Connection**: ブラウザとローカルバックエンドのWS接続単位（再接続時に再確立される）
- **Conversation**: 会話履歴と generationId を束ねる論理単位
- **Conversation ID (`sessionId`)**: プロトコル上の識別子。会話セッションIDを指す
- **Voice State**: マイク入力の開始/停止や入力受付中かどうかを示す状態

### 音声入力〜応答再生
```mermaid
sequenceDiagram
  participant User
  participant Browser
  participant Orchestrator
  participant ASR
  participant LLM
  participant TTS

  User->>Browser: Start
  Browser->>Orchestrator: START_SESSION
  User->>Browser: Speak
  Browser->>Orchestrator: USER_SPEECH_START
  Browser->>Orchestrator: AUDIO_CHUNK
  Browser->>Orchestrator: USER_SPEECH_END
  Orchestrator->>ASR: Transcribe
  ASR-->>Orchestrator: Transcript
  Orchestrator->>LLM: Generate
  LLM-->>Orchestrator: ResponseText
  Orchestrator->>TTS: Synthesize
  TTS-->>Orchestrator: Audio
  Orchestrator-->>Browser: ASSISTANT_SPEAKING + AUDIO
  Browser-->>User: Play Audio
```

### ASR未実装時の暫定表示（ユーザー発話）
ASRが未実装の間は、音声入力に対して暫定的なユーザー発話メッセージをチャットログへ表示する。  
この表示は **仮のプレースホルダー** とし、ASR導入後は `FINAL_TRANSCRIPT` を正とする。

**暫定表示の方針**
- `USER_SPEECH_END` を受信したタイミングで「音声入力を受け付けました」等の表示を行う
- ASR導入後は `FINAL_TRANSCRIPT` に置き換え、暫定表示はフェードアウト/更新で吸収する

### テキスト入力〜応答再生
```mermaid
sequenceDiagram
  participant User
  participant Browser
  participant Orchestrator
  participant LLM
  participant TTS

  User->>Browser: Type & Send
  Browser->>Orchestrator: TEXT_INPUT
  Orchestrator->>LLM: Generate
  LLM-->>Orchestrator: ResponseText
  Orchestrator->>TTS: Synthesize
  TTS-->>Orchestrator: Audio
  Orchestrator-->>Browser: ASSISTANT_SPEAKING + AUDIO
  Browser-->>User: Play Audio
```

### 割り込み（barge-in）
```mermaid
sequenceDiagram
  participant User
  participant Browser
  participant Orchestrator

  User->>Browser: Speak
  Browser->>Orchestrator: USER_SPEECH_START
  Browser->>Browser: Stop Playback
  Browser->>Orchestrator: CANCEL_RESPONSE
  Orchestrator-->>Browser: ASSISTANT_STOPPED
```

### 会話状態
```mermaid
stateDiagram-v2
  [*] --> IDLE
  IDLE --> LISTENING: USER_SPEECH_START
  IDLE --> THINKING: TEXT_INPUT
  LISTENING --> THINKING: USER_SPEECH_END
  THINKING --> SPEAKING: AUDIO_READY
  SPEAKING --> LISTENING: USER_SPEECH_START
  SPEAKING --> CANCELING: CANCEL_RESPONSE
  CANCELING --> LISTENING: CANCEL_DONE
  state ERROR
  IDLE --> ERROR: ERROR
  IDLE --> ERROR: BOUNDARY_VIOLATION
  ERROR --> IDLE: RESET
  LISTENING --> ERROR: BOUNDARY_VIOLATION
  THINKING --> ERROR: BOUNDARY_VIOLATION
  SPEAKING --> ERROR: BOUNDARY_VIOLATION
  CANCELING --> ERROR: BOUNDARY_VIOLATION
```
※ 本図は **会話状態（Conversation State）** の遷移を示す。TEXT_INPUT は音声入力状態の有無に関わらず利用可能で、送信時は THINKING → SPEAKING → IDLE の遷移を想定する。音声入力状態（Voice State）は別途管理する。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1, 1.2, 1.3, 1.4 | ローカル完結とデータ境界 | BoundaryGuard, Orchestrator, SessionStore | WS API, Policy Config | 音声入力〜応答再生 |
| 2.1, 2.2, 2.3, 2.4, 2.5 | 音声入力開始/停止 | UI, AudioCapture, Orchestrator | WS API | 音声入力〜応答再生 |
| 3.1, 3.2, 3.3, 3.4, 3.5 | ハンズフリー入力 | AudioCapture | AudioCapture API | 音声入力〜応答再生 |
| 4.1, 4.2, 4.3, 4.4, 4.5 | ASR/LLM/TTSパイプライン | Orchestrator, ASRAdapter, LLMAdapter, TTSAdapter | Adapter Service API | 音声入力〜応答再生 |
| 5.1, 5.2, 5.3, 5.4, 5.5 | 全二重と割り込み | AudioPlayback, Orchestrator | WS API, Cancel API | 割り込み |
| 6.1, 6.2, 6.3, 6.4, 6.5 | 状態表示 | UI, ConversationState | UI State Contract | 音声入力〜応答再生 |
| 7.1, 7.2, 7.3, 7.4, 7.5 | エラー処理 | Orchestrator, UI | Error Envelope | 音声入力〜応答再生 |
| 8.1, 8.2, 8.3, 8.4, 8.5 | 観測性 | Metrics, Orchestrator | Metrics API | 音声入力〜応答再生 |
| 9.1, 9.2, 9.3, 9.4, 9.5 | 双方向通信 | WSClient, Orchestrator | WS API | 音声入力〜応答再生 |
| 10.1, 10.2, 10.3, 10.4, 10.5 | 開始/停止UI | UI, AudioPlayback | UI Events | 音声入力〜応答再生 |
| 11.1, 11.2, 11.3, 11.4 | 通信境界 | BoundaryGuard, Orchestrator | Policy Config | 音声入力〜応答再生 |
| 12.1, 12.2, 12.3, 12.4, 12.5 | テキスト入力併用 | VoiceChatUI, WSClient, Orchestrator | WS API | テキスト入力〜応答再生 |

## Components and Interfaces

### Component Summary
| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies (P0/P1) | Contracts |
|-----------|--------------|--------|--------------|--------------------------|-----------|
| VoiceChatUI | Browser UI | 状態表示と操作 | 2.1, 2.4, 6.1, 10.1 | ConversationState (P0) | State |
| TextInput | Browser UI | テキスト入力 | 12.1, 12.2, 12.3, 12.4, 12.5 | WSClient (P0) | Event |
| AudioCapture | Browser Audio | VADと音声取得 | 3.1, 3.2, 3.3 | AudioWorklet (P0) | Service, State |
| AudioPlayback | Browser Audio | 応答再生と停止 | 5.1, 10.3 | AudioContext (P0) | State |
| WSClient | Browser Net | 双方向通信 | 9.1, 9.2 | WebSocket (P0) | API, Event |
| Orchestrator | Local Core | 会話セッション制御/パイプライン統合 | 2.3, 4.1, 5.2 | Adapters (P0) | Service, Event |
| SessionStore | Local Core | 会話セッション/履歴の保持 | 1.4, 4.5 | LocalStorage (P1) | Service, State |
| ASRAdapter | Local Adapter | ASR統合 | 4.1 | ASRService (P0) | Service |
| LLMAdapter | Local Adapter | LLM統合 | 4.2 | LLMService (P0) | Service |
| TTSAdapter | Local Adapter | TTS統合 | 4.3, 5.2 | TTSService (P0) | Service |
| BoundaryGuard | Local Policy | 外部送信防止 | 1.3, 11.1, 11.2, 11.4 | Config (P0) | State |
| Metrics | Local Ops | イベント計測 | 8.1, 8.2, 8.3 | Orchestrator (P0) | State |

### ブラウザ層

#### VoiceChatUI
| Field | Detail |
|-------|--------|
| Intent | 会話状態の表示、開始/停止操作 |
| Requirements | 2.1, 2.4, 6.1, 10.1 |

**Responsibilities & Constraints**
- 会話状態（待機/収録/処理/再生）を表示
- 開始/停止操作を提供
- テキスト入力と音声入力の両方が同等に使えることを明示
- 接続状態と音声入力状態を分離して扱う

**Dependencies**
- Inbound: WSClient — サーバ状態イベント (P0)
- Outbound: WSClient — 開始/停止イベント (P0)
- External: None

**Contracts**: Service [ ] / API [ ] / Event [x] / Batch [ ] / State [x]

##### State Management
```typescript
type UIStatus = {
  conversationState: "idle" | "listening" | "thinking" | "speaking";
};
```
- Preconditions: サーバから状態イベントを受信済み
- Postconditions: UIに状態が表示される
- Invariants: conversationState はサーバ状態と整合

**Implementation Notes**
- Risks: 状態イベント遅延による表示のズレ

#### TextInput
| Field | Detail |
|-------|--------|
| Intent | テキスト入力の送信 |
| Requirements | 12.1, 12.2, 12.3, 12.4, 12.5 |

**Responsibilities & Constraints**
- テキスト入力を `TEXT_INPUT` としてWS送信する
- 音声入力状態の有無に関わらず送信可能とする
- 空文字列は送信しない
- 音声入力開始中は入力欄をロックし、送信を防止する

**Dependencies**
- Inbound: VoiceChatUI — 送信操作 (P0)
- Outbound: WSClient — TEXT_INPUT 送信 (P0)
- External: None

**Contracts**: Service [ ] / API [ ] / Event [x] / Batch [ ] / State [x]

#### AudioCapture
| Field | Detail |
|-------|--------|
| Intent | ハンズフリー音声入力とVADによる区間化 |
| Requirements | 3.1, 3.2, 3.3, 3.4, 3.5 |

**Responsibilities & Constraints**
- AudioWorkletでVADを実行し発話開始/終了を判定
- 入力は音声入力状態が有効なときのみ
- 発話区間中は音声チャンクを逐次送信し、発話終了で送信を止める
- 取得音声は一定フォーマットで送出

**Dependencies**
- Inbound: VoiceChatUI — 開始/停止操作 (P0)
- Outbound: WSClient — 音声チャンク送信 (P0)
- External: Web Audio API — マイク入力 (P0)

**Contracts**: Service [x] / API [ ] / Event [x] / Batch [ ] / State [x]

##### Service Interface
```typescript
type SampleRateHz = 16000 | 24000 | 48000;

type AudioFormat = "pcm16" | "wav";

type AudioChunkMeta = {
  sessionId: string;
  sequence: number;
  timestampMs: number;
  format: AudioFormat;
  sampleRateHz: SampleRateHz;
  channels: 1 | 2;
  byteLength: number;
};

type AudioChunkPayload = {
  meta: AudioChunkMeta;
  data: ArrayBuffer;
};

interface AudioCaptureService {
  start(): void;
  stop(): void;
  onSpeechStart(cb: (timestampMs: number) => void): void;
  onSpeechEnd(cb: (timestampMs: number) => void): void;
  onChunk(cb: (chunk: AudioChunkPayload) => void): void;
}
```
- Preconditions: 音声入力状態が開始済み
- Postconditions: 発話区間のチャンクが順序通りに発行される
- Invariants: sessionId と sequence は単調増加

**Implementation Notes**
- Integration: AudioWorklet でVADを実装
- Validation: マイク権限の有無を確認
- Risks: 対応ブラウザの制限
- Notes: 音声はチャンクで逐次送信（ストリーミングASR前提）
- Notes: チャンク長はデフォルト20ms、サーバ設定ファイルで指定し環境変数で上書き可能とする（20–50ms）

#### AudioPlayback
| Field | Detail |
|-------|--------|
| Intent | 応答音声の再生と即時停止 |
| Requirements | 5.1, 10.3, 10.4 |

**Responsibilities & Constraints**
- 再生中の割り込み停止を最優先
- 自動再生制約を回避するためユーザー操作起点

**Dependencies**
- Inbound: WSClient — 音声受信 (P0)
- Outbound: VoiceChatUI — 状態表示 (P1)
- External: Web Audio API — 再生 (P0)

**Contracts**: Service [x] / API [ ] / Event [x] / Batch [ ] / State [x]

##### Service Interface
```typescript
interface AudioPlaybackService {
  resumeByUserGesture(): Promise<void>;
  play(audio: ArrayBuffer, sampleRateHz: SampleRateHz): Promise<void>;
  stop(): void;
  isPlaying(): boolean;
}
```
- Preconditions: ユーザー操作でAudioContextが有効化済み
- Postconditions: stop() 実行後は再生が停止
- Invariants: 同時再生は1ストリームのみ

**Implementation Notes**
- Integration: AudioContext で再生
- Validation: 再生開始前に isPlaying を確認
- Risks: 自動再生制約

#### WSClient
| Field | Detail |
|-------|--------|
| Intent | 双方向チャネルの維持 |
| Requirements | 9.1, 9.2, 9.3, 9.4, 9.5 |

**Responsibilities & Constraints**
- 音声チャンクとイベントを同一チャネルで送受信
- 切断時の再接続と通知
- テキスト入力はWSイベント（TEXT_INPUT）として送信する
- ページロード時に接続を開始する
- 音声チャンクは **バイナリフレーム** で送信する（低遅延・低オーバーヘッド）
- 接続確立後に `CONFIG` を送信し、クライアント側で音声設定を同期する
- `CONFIG` 取得失敗時はデフォルト値（20ms）で継続し、警告を表示する

**Dependencies**
- Inbound: Orchestrator — サーバイベント (P0)
- Outbound: Orchestrator — クライアントイベント (P0)
- External: WebSocket — 双方向通信 (P0)

**Contracts**: Service [x] / API [x] / Event [x] / Batch [ ] / State [x]

##### API Contract
```typescript
type SessionId = string;
type GenerationId = string;

type ClientEvent =
  | { type: "START_SESSION"; sessionId: SessionId }
  | { type: "STOP_SESSION"; sessionId: SessionId }
  | { type: "USER_SPEECH_START"; sessionId: SessionId; timestampMs: number }
  | { type: "USER_SPEECH_END"; sessionId: SessionId; timestampMs: number }
  | { type: "TEXT_INPUT"; sessionId: SessionId; text: string }
  | { type: "CANCEL_RESPONSE"; sessionId: SessionId; generationId: GenerationId }
  | { type: "AUDIO_CHUNK"; chunk: AudioChunkMeta }
  | { type: "PING"; sessionId: SessionId; timestampMs: number };

type ServerEvent =
  | { type: "CONFIG"; sessionId: SessionId; audioChunkMs: number }
  | { type: "ASSISTANT_SPEAKING"; sessionId: SessionId; generationId: GenerationId }
  | { type: "ASSISTANT_STOPPED"; sessionId: SessionId; generationId: GenerationId }
  | {
      type: "ASSISTANT_TEXT";
      sessionId: SessionId;
      generationId: GenerationId;
      text: string;
      stale?: boolean;
    }
  | { type: "PARTIAL_TRANSCRIPT"; sessionId: SessionId; text: string }
  | { type: "FINAL_TRANSCRIPT"; sessionId: SessionId; text: string }
  | { type: "METRICS_UPDATE"; sessionId: SessionId; metrics: MetricSnapshot }
  | { type: "ERROR"; sessionId: SessionId; code: ErrorCode; message: string }
  | { type: "PONG"; sessionId: SessionId; timestampMs: number };

type ErrorCode =
  | "PERMISSION_DENIED"
  | "DEVICE_UNAVAILABLE"
  | "ASR_FAILED"
  | "LLM_FAILED"
  | "TTS_FAILED"
  | "BOUNDARY_VIOLATION"
  | "CHANNEL_DISCONNECTED"
  | "UNKNOWN";
```
- Preconditions: 会話セッション開始済み
- Postconditions: 接続維持中は送受信が継続
- Invariants: generationId は応答単位で一意

**Implementation Notes**
- Integration: 再接続時に状態を同期
- Validation: メッセージ型をバリデート
- Risks: 再接続時の状態不整合
- Notes: sessionId はページロード時に生成し、WS再接続時も同一IDを利用する

##### Transport Encoding
- 音声は **チャンク単位でストリーミング送信**する
- 送信順序（チャンクごと）:
  1. JSON `AUDIO_CHUNK` (メタデータのみ。`byteLength` を含む)
  2. 直後の **バイナリフレーム** に raw PCM を格納
- Base64によるサイズ増を避ける
- Notes: メタとバイナリは1:1対応とし、一定時間内にバイナリが来ない場合は破棄して次のメタから再同期する
- Notes: 欠落時はASR品質低下として扱い、再送は行わない（ログ記録のみ）

### ローカルオーケストレータ層

#### Orchestrator
| Field | Detail |
|-------|--------|
| Intent | 会話セッション管理とASR/LLM/TTSパイプライン制御 |
| Requirements | 2.3, 4.1, 4.2, 4.3, 5.2, 7.1 |

**Responsibilities & Constraints**
- 会話状態遷移と generationId 管理
- CANCEL_RESPONSE による中断処理
- TEXT_INPUT はASRを経由せず、ASR完了相当としてLLM/TTSへ進める
- TEXT_INPUT は音声入力状態に関わらず受理する
- TEXT_INPUT を受信したら user の transcript をSessionStoreへ追加する
- 最新 generationId を activeGenerationId として保持し、古い応答の音声は送信しない
- LLM開始前のキャンセルは処理を中断し、応答テキストは送信しない
- LLM開始後にキャンセルされた応答は `ASSISTANT_TEXT` を stale として送信し、音声は送信しない

**Dependencies**
- Inbound: WSClient — クライアントイベント (P0)
- Outbound: WSClient — サーバイベント (P0)
- External: ASRAdapter, LLMAdapter, TTSAdapter (P0)

**Contracts**: Service [x] / API [ ] / Event [x] / Batch [ ] / State [x]

##### Service Interface
```typescript
interface OrchestratorService {
  handleClientEvent(event: ClientEvent): Promise<void>;
  cancelGeneration(sessionId: SessionId, generationId: GenerationId): Promise<void>;
}
```
- Preconditions: sessionId が有効
- Postconditions: 状態遷移とイベント送信が完了
- Invariants: 同時に有効なgenerationIdは1つ

**Implementation Notes**
- Integration: アダプタのI/FでASR/LLM/TTSを統合
- Validation: 状態遷移の整合性をチェック
- Risks: 中断競合による再生誤り
- Notes: TEXT_INPUT 受信時に sessionId が未存在なら新規の会話セッションを初期化して処理を継続する
- Notes: stale 応答の扱いは「テキストのみ表示、音声は再生しない」

#### SessionStore
| Field | Detail |
|-------|--------|
| Intent | 会話セッションと履歴の保持、削除 |
| Requirements | 1.4, 4.5 |

**Responsibilities & Constraints**
- 会話状態と履歴を保持（デフォルトはメモリ、永続化はオプトイン）
- ユーザー削除操作でローカル保存データを完全削除
- 保持期限と容量の上限を設定可能

**Dependencies**
- Inbound: Orchestrator — 会話セッション更新 (P0)
- Outbound: None
- External: LocalStorage — ローカル保存 (P1)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [x]

##### Service Interface
```typescript
type RetentionMode = "memory" | "local_file";

type TranscriptEntry = {
  timestampMs: number;
  speaker: "user" | "assistant";
  text: string;
};

type SessionRecord = {
  sessionId: SessionId;
  createdAt: number;
  updatedAt: number;
  transcripts: TranscriptEntry[];
};

interface SessionStoreService {
  get(sessionId: SessionId): SessionRecord | undefined;
  upsert(record: SessionRecord): void;
  appendTranscript(sessionId: SessionId, entry: TranscriptEntry): void;
  delete(sessionId: SessionId): void;
  list(): SessionRecord[];
  setRetention(mode: RetentionMode, ttlMs?: number): void;
}
```
- Preconditions: sessionId が有効
- Postconditions: 削除後はローカルに痕跡を残さない
- Invariants: retention 設定は会話セッション単位で一貫

**Implementation Notes**
- Integration: 永続化は明示的に有効化された場合のみ
- Validation: TTL/容量制限の設定値を検証
- Risks: 長時間稼働時のストレージ肥大

#### BoundaryGuard
| Field | Detail |
|-------|--------|
| Intent | ローカル通信境界の保証 |
| Requirements | 1.3, 11.1, 11.2, 11.4 |

**Responsibilities & Constraints**
- RFC1918 と localhost 以外への通信をブロック
- 外向き通信検知時の停止
- 起動時に全エンドポイントが RFC1918/localhost であることを検証
- 許可範囲は localhost と RFC1918 のプライベートレンジに限定
- ホスト名の接続先は拒否する（IPアドレスのみ許可）
- IPv6 は許可対象外（IPv4 の RFC1918 と 127.0.0.0/8 のみ許可）
- 入力経路（音声/テキスト）に関わらず外部サービス呼び出し前に必ず適用する

**Dependencies**
- Inbound: Orchestrator — 送信前検査 (P0)
- Outbound: Metrics — 監査ログ (P1)
- External: Policy Config (P0)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [x]

##### Service Interface
```typescript
type BoundaryScope = "localhost" | "rfc1918";

type BoundaryPolicy = {
  scope: BoundaryScope;
  allowedRanges: string[];
};

type Endpoint = {
  host: string;
  port: number;
};

interface BoundaryGuardService {
  assertAllowed(endpoint: Endpoint): void;
  recordViolation(endpoint: Endpoint, reason: string): void;
}
```
- Preconditions: endpoint が指定される
- Postconditions: 非許可なら例外
- Invariants: 許可対象は localhost と RFC1918 のみ

**Implementation Notes**
- Integration: 起動時検証 + アダプタ呼び出し直前に検査
- Validation: 設定値の整合性
- Risks: サービス側の設定逸脱
- Notes: 接続先はIP表記のみ許可し、DNS解決は行わない

#### Metrics
| Field | Detail |
|-------|--------|
| Intent | 遅延・イベントの計測 |
| Requirements | 8.1, 8.2, 8.3 |

**Responsibilities & Constraints**
- 主要イベントと処理時間を記録
- 音声/本文は保存しない
- 計測結果は **最小のUI表示** に反映できるようにする（開発用）

**Dependencies**
- Inbound: Orchestrator — イベント通知 (P0)
- Outbound: LocalStorage — メトリクス保存 (P1)
- External: None

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [x]

##### Service Interface
```typescript
type MetricEvent = {
  sessionId: SessionId;
  name: "session_start" | "session_stop" | "asr_done" | "llm_done" | "tts_done" | "latency";
  timestampMs: number;
  valueMs?: number;
};

type MetricSnapshot = {
  generationId: GenerationId;
  asrMs?: number;
  llmMs?: number;
  ttsMs?: number;
  totalMs?: number;
  timestampMs: number;
};

interface MetricsService {
  record(event: MetricEvent): void;
}
```
- Preconditions: sessionId 有効
- Postconditions: 保存先に記録
- Invariants: 音声/本文は記録しない

**Implementation Notes**
- Integration: ローカル保存のみ
- Validation: PII除外
- Risks: 計測過剰による遅延
- Notes: Orchestrator がステージ完了ごとに `METRICS_UPDATE` を通知する
- Notes: UIは `currentGenerationId` を保持し、該当IDのメトリクスが揃った時のみ表示を更新する
- Notes: `METRICS_UPDATE` は ASR/LLM/TTS 完了ごとに送信する

### アダプタ層

#### ASRAdapter
| Field | Detail |
|-------|--------|
| Intent | ASRサービスの統合 |
| Requirements | 4.1 |

**Responsibilities & Constraints**
- 音声入力をASRに変換してテキストを取得
- チャンク単位で部分結果/最終結果を返す

**Dependencies**
- Inbound: Orchestrator — 変換要求 (P0)
- Outbound: ASRService — ローカルASR (P0)
- External: whisper.cpp server (P0)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface
```typescript
interface ASRService {
  transcribe(audio: AudioChunk): Promise<{ text: string; isFinal: boolean }>;
}
```
- Preconditions: audio が有効
- Postconditions: text を返却
- Invariants: ローカル実行のみ

**Implementation Notes**
- Integration: 変換失敗時はASR_FAILED
- Validation: サンプルレート整合
- Risks: CPU負荷
- Notes: ストリーミングASRを想定し、isFinal=false を部分結果として扱う

#### LLMAdapter
| Field | Detail |
|-------|--------|
| Intent | LLMサービスの統合 |
| Requirements | 4.2 |

**Responsibilities & Constraints**
- 会話履歴に基づく応答生成

**Dependencies**
- Inbound: Orchestrator — 生成要求 (P0)
- Outbound: LLMService — ローカルLLM (P0)
- External: llama.cpp server (P0)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface
```typescript
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type LLMResult = { text: string; tokens?: number };

interface LLMService {
  generate(messages: ChatMessage[], sessionId: SessionId): Promise<LLMResult>;
  cancel?(sessionId: SessionId): Promise<void>;
}
```
- Preconditions: 会話履歴が整合
- Postconditions: 応答テキストを返却
- Invariants: 生成単位はgenerationId

**Implementation Notes**
- Integration: 生成中断に対応
- Validation: 文字数上限
- Risks: 応答遅延

#### TTSAdapter
| Field | Detail |
|-------|--------|
| Intent | TTSサービスの統合 |
| Requirements | 4.3, 5.2 |

**Responsibilities & Constraints**
- 応答テキストを音声化
- 24kHz出力の前提を吸収
- 出力フォーマットは未決定（TBD）。TTSAdapter がブラウザ再生可能形式へ正規化する

**Dependencies**
- Inbound: Orchestrator — 合成要求 (P0)
- Outbound: TTSService — ローカルTTS (P0)
- External: VOICEVOX Engine (P0)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface
```typescript
interface TTSService {
  synthesize(text: string): Promise<{ audio: ArrayBuffer; sampleRateHz: 24000 }>;
  cancel?(sessionId: SessionId): Promise<void>;
}
```
- Preconditions: text が空でない
- Postconditions: 24kHz音声を返却
- Invariants: ローカル実行のみ

**Implementation Notes**
- Integration: 途中停止は cancel を優先
- Validation: 文字長の制限
- Risks: 合成時間のばらつき

## Data Models

### Domain Model
- **Conversation**: 会話状態、generationId、開始/終了時刻
- **Generation**: 応答生成単位（LLM/TTS）
- **Transcript**: ASR結果（partial/final）
- **RetentionPolicy**: 保存モード、保持期限、容量上限

### Logical Data Model
**Structure Definition**:
- ConversationSession { sessionId, state, activeGenerationId, startedAt, stoppedAt }
- Generation { generationId, sessionId, status, createdAt }
- MetricEvent { name, timestampMs, valueMs }
- RetentionPolicy { mode, ttlMs, maxSessions }

**Consistency & Integrity**:
- ConversationSession は単一アクティブ generationId を保持
- Generation は sessionId に従属
- delete 操作は ConversationSession/Transcript を完全に削除

### Data Contracts & Integration
- WebSocket イベントは `ClientEvent` / `ServerEvent` に準拠
- 送受信は sessionId と generationId を必須
- `AUDIO_CHUNK` はメタデータ、直後のバイナリフレームが実データ

## Error Handling

### Error Strategy
- 早期検知と即時通知
- 会話セッション継続可能なら復旧を優先

### Error Categories and Responses
- **User Errors**: 権限拒否・デバイス未接続 → 操作ガイド
- **System Errors**: ASR/LLM/TTS失敗 → 再試行案内
- **State Errors**: 会話セッション不整合 → 会話セッション再初期化
- **Boundary Violations**: 外向き通信を検知したら `ERROR (BOUNDARY_VIOLATION)` を通知し、会話セッションを停止

### Monitoring
- ERROR イベントを Metrics に記録
- 重大エラー時は会話セッションを安全終了

## Testing Strategy
- **Unit Tests**: VAD判定、状態遷移、メッセージバリデーション
- **Integration Tests**: WS接続、ASR/LLM/TTSアダプタ連携、割り込み
- **E2E/UI Tests**: 開始/停止、連続会話、再接続
- **Performance/Load**: 発話終了→応答開始の遅延計測

### VAD評価の方針（暫定）
- **目的**: 発話区間の切り出しが安定していることを担保し、体験品質は人間評価で検証する
- **単体テスト（自動）**:
  - 合成音（無音→発話→無音）で開始/終了タイミングの検証
  - ノイズ混入時の誤検知・過検知の抑制を検証
  - 連続発話で不要な分割が発生しないことを検証
- **人間評価（手動）**:
  - 実録音を用いて「切り方の自然さ」「遅延感」を評価
  - デバッグUIで VADイベントのログ/タイムラインを表示して確認
- **補足**: 単体テストで評価が難しい項目（自然な区切り/主観品質）は、テスト設計のみ先行して記載し、実装は後続タスクで行う

## Optional Sections

### Security Considerations
- すべての通信を RFC1918 と localhost（127.0.0.0/8）に限定
- ログから音声/本文を除外
- UIで録音中を明示
 - Docker Compose でローカル境界内の通信に限定する

### Performance & Scalability
- パフォーマンスは実装後の計測結果に基づきチューニングする
- モデル負荷に応じて縮退モードを検討

## Supporting References (Optional)
- 追加資料は `research.md` に集約する
