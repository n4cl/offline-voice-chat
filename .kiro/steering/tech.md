# Technology Stack

## Architecture

- ローカルオーケストレータ中心の Ports & Adapters
- ブラウザUI/音声I/O とローカルバックエンドを分離
- WebSocket で双方向イベントを統一

## Core Technologies

- **Language**: Go 1.25 / TypeScript
- **Framework**: React 18 + Vite
- **Runtime**: Node.js（frontend dev/build）

## Key Libraries

- Go: github.com/coder/websocket（WS）
- Frontend: React, Vite, Vitest

## Development Standards

### Type Safety
- TypeScript を使用し、イベント型は明示定義する
- Go は型を明確化し、境界チェックを優先する

### Code Quality
- ローカル境界ポリシーを最優先で遵守
- ログは構造化（JSON）で出力する

### Testing
- Frontend: Vitest
- Backend: go test

## Development Environment

### Required Tools
- Go 1.25
- Node.js LTS

### Common Commands
```bash
# Frontend dev
npm run dev
# Frontend test
npm test
# Backend dev
go run ./cmd/server
# Backend test
go test ./...
```

## Key Technical Decisions

- 通信は RFC1918 + localhost のみ許可
- WebSocket で制御/音声イベントを集約
- 音声/テキスト入力は同等のパイプラインで処理

---
_Document standards and patterns, not every dependency_
