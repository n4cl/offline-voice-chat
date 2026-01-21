# Requirements Document

## Introduction
本ドキュメントは、ローカル完結の音声対話Webアプリの要件を定義する。ブラウザ上でハンズフリーに音声対話を行い、全二重と割り込みを実現することを目的とする。

## Requirements

### Requirement 1: ローカル完結とデータ境界
**Objective:** As a ユーザー, I want 音声対話がローカルで完結すること, so that 音声と会話内容が外部へ送信されない

#### Acceptance Criteria
1. The Voice Chat Web App shall 音声・テキストの処理をローカル環境内で完結させる
2. When ネットワーク接続が利用できない, the Voice Chat Web App shall 主要な音声対話機能を継続して提供する
3. Where 外部通信が禁止されている, the Voice Chat Web App shall 音声・テキストデータを外部へ送信しない
4. The Voice Chat Web App shall ローカルに保存された対話データをユーザーが削除できる

### Requirement 2: 音声セッション開始・停止と権限
**Objective:** As a ユーザー, I want 音声セッションを開始・停止できること, so that 必要なときだけ音声対話を行える

#### Acceptance Criteria
1. When ユーザーが音声入力の開始を指示したとき, the Voice Chat Web App shall マイク利用権限の取得を行う
2. If マイク利用権限が拒否されたとき, the Voice Chat Web App shall 権限付与の手順を提示する
3. When 音声セッションが開始されたとき, the Voice Chat Web App shall 音声入力の受付を開始する
4. When ユーザーが音声セッションの停止を指示したとき, the Voice Chat Web App shall 音声入力の受付と音声由来の応答生成を停止する
5. The Voice Chat Web App shall 音声セッションが停止中に音声入力を取得しない

### Requirement 3: ハンズフリー音声入力（VAD含む）
**Objective:** As a ユーザー, I want ハンズフリーで発話できること, so that 操作せずに対話を進められる

#### Acceptance Criteria
1. While セッションが有効な間, the Voice Chat Web App shall ユーザーの発話開始と終了を検知する
2. When 発話開始を検知したとき, the Voice Chat Web App shall 発話区間の音声取得を開始する
3. When 発話終了を検知したとき, the Voice Chat Web App shall 発話区間の音声取得を終了し処理に回す
4. If 発話の検知に失敗したとき, the Voice Chat Web App shall ユーザーに通知して再試行を可能にする
5. The Voice Chat Web App shall 連続した発話を途切れずに受け付ける

### Requirement 4: 会話パイプライン（ASR/LLM/TTS）
**Objective:** As a ユーザー, I want 音声が自然に対話へ変換されること, so that 音声だけで会話できる

#### Acceptance Criteria
1. When 発話区間の音声が確定したとき, the Voice Chat Web App shall 音声をテキストに変換する
2. When 音声からテキストへの変換が完了したとき, the Voice Chat Web App shall 応答テキストを生成する
3. When 応答テキストが生成されたとき, the Voice Chat Web App shall 応答音声を生成する
4. When 応答音声が生成されたとき, the Voice Chat Web App shall ブラウザで再生できる形式で提供する
5. The Voice Chat Web App shall セッション内の会話履歴を保持し応答生成に利用する

### Requirement 5: 全二重と割り込み（barge-in）
**Objective:** As a ユーザー, I want AIが話していても割り込めること, so that 会話が自然に続く

#### Acceptance Criteria
1. While 応答音声が再生中, when ユーザーの発話開始を検知したとき, the Voice Chat Web App shall 応答音声の再生を即時停止する
2. When 割り込みが発生したとき, the Voice Chat Web App shall 進行中の応答生成を中断する
3. When 割り込みが発生したとき, the Voice Chat Web App shall 新しい発話を最優先で処理する
4. The Voice Chat Web App shall 進行中の応答と新しい発話が競合しないよう整合性を保つ
5. If 古い応答が後から到着したとき, the Voice Chat Web App shall それを再生しない

### Requirement 6: 状態表示と操作性
**Objective:** As a ユーザー, I want 現在の状態が分かること, so that 安心して操作できる

#### Acceptance Criteria
1. The Voice Chat Web App shall セッション状態を明示的に表示する
2. While 音声入力受付中, the Voice Chat Web App shall 収録中であることを表示する
3. While 応答生成中, the Voice Chat Web App shall 処理中であることを表示する
4. While 応答音声再生中, the Voice Chat Web App shall 再生中であることを表示する
5. If エラーが発生したとき, the Voice Chat Web App shall エラー内容と対処方法を表示する

### Requirement 7: エラー処理と回復
**Objective:** As a ユーザー, I want エラー発生時に復旧できること, so that 対話を継続できる

#### Acceptance Criteria
1. If 音声入力デバイスが利用できないとき, the Voice Chat Web App shall 問題を通知し再試行手段を提示する
2. If 音声認識に失敗したとき, the Voice Chat Web App shall エラーを通知し再試行を可能にする
3. If 応答生成または音声合成に失敗したとき, the Voice Chat Web App shall エラーを通知し再試行を可能にする
4. While エラー状態のとき, when ユーザーが再試行を指示したとき, the Voice Chat Web App shall 音声対話の再開を試みる
5. The Voice Chat Web App shall 重大なエラー発生時にセッションを安全に終了できる

### Requirement 8: 観測性と品質
**Objective:** As a 運用者, I want 品質を把握できること, so that 改善点を特定できる

#### Acceptance Criteria
1. The Voice Chat Web App shall セッション開始・終了などのイベントを記録する
2. The Voice Chat Web App shall 処理時間を計測し可視化できる
3. Where ログを記録する場合, the Voice Chat Web App shall 音声データおよび会話本文を含めない
4. The Voice Chat Web App shall 前面タブで安定して動作する
5. The Voice Chat Web App shall 長時間稼働時の資源使用が継続して監視可能である

### Requirement 9: 双方向リアルタイム通信
**Objective:** As a ユーザー, I want ブラウザとローカルバックエンドが双方向で通信できること, so that 対話が途切れずに継続できる

#### Acceptance Criteria
1. The Voice Chat Web App shall ブラウザとローカルバックエンド間で双方向のリアルタイム通信を提供する
2. When セッションが開始されたとき, the Voice Chat Web App shall 双方向チャネルを確立する
3. While セッションが有効な間, the Voice Chat Web App shall 双方向通信の接続状態を維持する
4. If 双方向通信が切断されたとき, the Voice Chat Web App shall ユーザーに通知し再接続を試みる
5. The Voice Chat Web App shall 双方向通信の再接続後にセッションの継続または再開を可能にする

### Requirement 10: 音声開始/停止UIと自動再生制約対応
**Objective:** As a ユーザー, I want 明確な音声開始/停止操作ができること, so that ブラウザの制約下でも安全に音声対話を開始できる

#### Acceptance Criteria
1. The Voice Chat Web App shall 音声セッション開始のための明確な操作手段を提供する
2. When ユーザーが音声開始操作を行ったとき, the Voice Chat Web App shall 音声入出力の初期化を実行する
3. When ユーザーが音声停止操作を行ったとき, the Voice Chat Web App shall 音声入力と音声応答再生を停止する
4. While 音声セッションが停止中, the Voice Chat Web App shall 音声入力の取得と自動再生を行わない
5. The Voice Chat Web App shall ブラウザの自動再生制約により音声再生が開始できない場合に案内を表示する

### Requirement 11: ローカル通信境界の厳密化
**Objective:** As a 運用者, I want 通信がローカル境界内に限定されること, so that 外部流出のリスクを避けられる

#### Acceptance Criteria
1. The Voice Chat Web App shall 通信のエンドポイントが IPv4 のプライベートアドレス（RFC1918）および localhost（127.0.0.0/8）に限定されることを保証する
2. Where 外向き通信が無効化されている, the Voice Chat Web App shall 外部ネットワークへの送信を行わない
3. If 外向き通信が検出されたとき, the Voice Chat Web App shall ただちに通知し動作を停止できる
4. The Voice Chat Web App shall RFC1918 と localhost（127.0.0.0/8）以外の宛先への通信が発生しないよう構成される

### Requirement 12: テキスト入力の併用（音声と同等）
**Objective:** As a ユーザー, I want テキストでも入力できること, so that 音声が使えない環境や検証時にも対話を継続できる

#### Acceptance Criteria
1. The Voice Chat Web App shall 音声入力に加えてテキスト入力手段を提供する
2. When ユーザーがテキスト入力を送信したとき, the Voice Chat Web App shall 音声入力と同等の対話パイプラインで応答を生成する
3. The Voice Chat Web App shall テキスト入力と音声入力の両方が同等に利用可能であることを明示する
4. The Voice Chat Web App shall 音声セッションが停止中にテキスト入力を利用可能にする
5. While 音声セッションが開始中, the Voice Chat Web App shall テキスト入力をロックして送信を防止する
