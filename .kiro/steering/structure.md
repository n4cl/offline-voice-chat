# Project Structure

## Organization Philosophy

- Frontend / Backend を明確に分離し、それぞれ独立して開発・テスト可能にする
- Backend は `cmd/` にエントリポイント、`internal/` に実装を集約する
- Frontend は `src/` 以下に UI と通信クライアントを配置する

## Directory Patterns

### Backend App Entrypoints
**Location**: `/backend/cmd/`  
**Purpose**: 実行バイナリのエントリポイント  
**Example**: `cmd/server/main.go`

### Backend Core
**Location**: `/backend/internal/`  
**Purpose**: セッション管理・WS処理・ポリシーなどの中核ロジック  
**Example**: `internal/server/*.go`

### Frontend App
**Location**: `/frontend/src/`  
**Purpose**: UI とブラウザ側ロジック  
**Example**: `src/App.tsx`, `src/lib/wsClient.ts`

### Docker
**Location**: `/docker/`  
**Purpose**: backend/frontend/mock のビルド定義  
**Example**: `docker/backend/Dockerfile`

## Naming Conventions

- **Go files**: `snake_case.go`（例: `ws_handler.go`）
- **React components**: `PascalCase`（例: `App.tsx`）
- **Tests**: `*_test.go`, `*.test.ts(x)`

## Import Organization

```typescript
import { WSClient } from './lib/wsClient'
```

**Path Aliases**:
- なし（相対パスを使用）

## Code Organization Principles

- 境界ポリシーは中心ロジックに先立って適用する
- WSイベントは明示的な型で管理し、拡張時は contract を更新する
- UI状態は接続状態とセッション状態を分離して管理する

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
