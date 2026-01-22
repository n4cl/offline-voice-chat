# 用語集

- **接続（Connection）**: ブラウザとバックエンド間の WebSocket 接続。切断や再接続が起こる通信路の単位。
- **会話セッション（Conversation）**: 会話履歴と generationId を束ねる論理単位。プロトコル上の `sessionId` はこの会話セッションIDを指す。
- **音声入力状態（Voice State）**: マイク入力の開始/停止や、入力受付中かどうかを示す状態。会話セッションとは別の概念。
- **生成（Generation）**: 応答生成の単位。LLM/TTS の一連処理を束ねる。
