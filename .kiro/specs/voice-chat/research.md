# Research & Design Decisions

---
**目的**: 技術設計に影響する調査結果と意思決定を記録する。
---

## Summary
- **Feature**: voice-chat
- **Discovery Scope**: New Feature
- **Key Findings**:
  - getUserMedia はセキュアコンテキストでのみ利用でき、localhost はセキュア扱い。
  - AudioWorklet は低遅延の音声処理に適し、VADに有効。
  - VOICEVOX Engine はローカルHTTPで音声合成APIを提供し、24kHz出力を前提とする。

## Research Log

### ブラウザ音声入出力と制約
- **Context**: ハンズフリー入力、割り込み停止、低遅延に必要なブラウザ機能と制約を確認するため。
- **Sources Consulted**:
  - https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
  - https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
  - https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
  - https://developer.chrome.com/blog/autoplay/
- **Findings**:
  - getUserMedia はセキュアコンテキストが必要で、localhost は許容される。
  - AudioWorklet は専用スレッドでの低遅延音声処理に使える。
  - MediaRecorder は timeslice 指定でチャンク生成が可能。
  - 自動再生制約により、音声再生開始はユーザー操作を伴う必要がある。
- **Implications**: 開始UIにユーザー操作を必須化し、AudioContext のresumeを明示する設計が必要。

### 双方向チャネルとバイナリ送信
- **Context**: 音声チャンクと制御イベントを同一チャネルで双方向送受信する方式の検討。
- **Sources Consulted**:
  - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- **Findings**:
  - WebSocket は双方向通信とバイナリ送信（ArrayBuffer/Blob）に対応する。
- **Implications**: MVPは WebSocket を主チャネルとし、後続でWebRTCへ拡張可能な設計にする。

### ローカル音声合成（TTS）
- **Context**: 日本語向けローカルTTSの実現方法を確認するため。
- **Sources Consulted**:
  - https://github.com/VOICEVOX/voicevox_engine
- **Findings**:
  - VOICEVOX Engine はローカルHTTPで audio_query / synthesis を提供する。
  - 出力は 24kHz WAV を前提とする。
- **Implications**: TTSアダプタで 24kHz 変換や再生形式の整合を保証する必要がある。

### ローカル音声認識（ASR）
- **Context**: オフラインASRの候補を比較するため。
- **Sources Consulted**:
  - https://github.com/ggml-org/whisper.cpp
- **Findings**:
  - whisper.cpp はCPU向けのローカルASR実装を提供する。
- **Implications**: ASRはローカル実行前提で、オーケストレータが外部送信を禁止する設計にする。

### ローカルLLMサーバ
- **Context**: ローカルでのLLM推論提供方式を確認するため。
- **Sources Consulted**:
  - https://git.cturan.dev/cturan/llama.cpp/src/branch/master/examples/server/README.md
- **Findings**:
  - llama.cpp サーバは OpenAI互換のAPIエンドポイントを提供できる。
- **Implications**: LLMアダプタは OpenAI互換JSONをサポートする契約設計とする。

### 代替TTS候補
- **Context**: 代替のローカルTTS候補を把握するため。
- **Sources Consulted**:
  - https://github.com/rhasspy/piper
- **Findings**:
  - Piper はリポジトリがアーカイブされ、移行先が提示されている。
- **Implications**: プラグイン型アダプタにして差し替えを容易にする。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Browser-only (WASM) | すべてをブラウザ内で完結 | 外部依存が少ない | モデル負荷が高く端末差が大きい | 非推奨（MVP外） |
| Ports & Adapters | ローカルオーケストレータ + アダプタ | 境界明確、差し替え容易 | アダプタ実装が必要 | 採用 |
| WebRTC中心 | 双方向ストリーム重視 | 低遅延に有利 | 実装負荷が高い | 将来検討 |

## Design Decisions

### Decision: WebSocket を一次チャネルとして採用
- **Context**: 双方向通信要件（9.x）と実装負荷のバランス。
- **Alternatives Considered**:
  1. WebSocket
  2. WebRTC
- **Selected Approach**: WebSocket に制御イベントと音声チャンクを統合。
- **Rationale**: 実装が軽量で、MVPの要件を満たす。
- **Trade-offs**: 超低遅延はWebRTCに劣る。
- **Follow-up**: 将来 WebRTC へ置換可能なアダプタ境界を維持。

### Decision: TTSにVOICEVOX Engine をデフォルト採用
- **Context**: 日本語品質とローカル運用。
- **Alternatives Considered**:
  1. VOICEVOX Engine
  2. Piper
- **Selected Approach**: VOICEVOX Engine を優先し、TTSアダプタで差し替え可能にする。
- **Rationale**: 日本語品質とローカルHTTP APIが明確。
- **Trade-offs**: 24kHz固定の変換が必要。
- **Follow-up**: サンプルレート変換の負荷を測定する。

### Decision: AudioWorklet をVADの主経路にする
- **Context**: 低遅延と安定性が要件（11.x）に影響。
- **Alternatives Considered**:
  1. AudioWorklet
  2. ScriptProcessor
- **Selected Approach**: AudioWorkletを主経路、非対応環境は縮退。
- **Rationale**: 専用スレッドでの処理が可能。
- **Trade-offs**: 実装複雑度が上がる。
- **Follow-up**: 対応ブラウザ検証を実施。

## Risks & Mitigations
- 自動再生制約で再生が開始できない — 開始操作のUXを必須化しガイダンス表示。
- 低スペック端末で遅延悪化 — モデル負荷を監視し軽量構成へ縮退。
- 24kHz TTS出力の再生互換 — 変換パイプラインをアダプタ内に閉じる。
- LLM/ASRの停止制御不一致 — generationId とキャンセルAPIで整合を保証。

## References
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- https://developer.chrome.com/blog/autoplay/
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- https://github.com/VOICEVOX/voicevox_engine
- https://github.com/ggml-org/whisper.cpp
- https://git.cturan.dev/cturan/llama.cpp/src/branch/master/examples/server/README.md
- https://github.com/rhasspy/piper
