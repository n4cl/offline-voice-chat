# Product Overview

ローカル環境で完結する音声対話Webアプリ。ブラウザから音声/テキスト入力を受け取り、ローカルのASR/LLM/TTSで応答を生成し、外部送信を避ける。

## Core Capabilities

- ブラウザとローカルバックエンドの双方向リアルタイム通信
- 音声入力/テキスト入力の両対応と応答再生
- ローカル境界（RFC1918 + localhost）の厳格化
- セッション管理と再接続の継続

## Target Use Cases

- オフライン/ローカル環境での安全な音声対話
- ローカルLLM/ASR/TTSの統合検証
- 低遅延の対話プロトタイピング

## Value Proposition

- 音声/テキストの外部送信を避けた安全な対話
- ローカルサービスを差し替え可能な構成
- 最小構成での双方向対話の検証が可能

---
_Focus on patterns and purpose, not exhaustive feature lists_
