package server

import (
	"fmt"
	"sync"
	"time"
)

// SessionState は会話状態（Conversation State）を表す。
type SessionState string

const (
	StateIdle      SessionState = "idle"
	StateListening SessionState = "listening"
	StateThinking  SessionState = "thinking"
	StateSpeaking  SessionState = "speaking"
	StateCanceling SessionState = "canceling"
)

// Session は会話セッションの状態を保持する。
type Session struct {
	ID                 string
	State              SessionState
	Active             bool
	Connected          bool
	ActiveGenerationID string
	NextGeneration     int
	Transcripts        []TranscriptEntry
}

type TranscriptEntry struct {
	Speaker     string
	Text        string
	TimestampMs int64
}

// SessionManager は会話セッションの生成・状態遷移を管理する。
type SessionManager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

// NewSessionManager は空の会話セッション管理を初期化する。
func NewSessionManager() *SessionManager {
	return &SessionManager{sessions: make(map[string]*Session)}
}

// Get は指定IDの会話セッションを取得する。
func (m *SessionManager) Get(sessionID string) (Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return Session{}, false
	}
	return *session, true
}

// Handle はクライアントイベントを処理し、必要に応じてサーバイベントを返す。
func (m *SessionManager) Handle(event ClientEvent) ([]ServerEvent, error) {
	if event.Type == "" {
		return nil, fmt.Errorf("missing event type")
	}
	if event.Type != "BOUNDARY_STATUS" && event.SessionID == "" {
		return nil, fmt.Errorf("missing sessionId")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[event.SessionID]

	switch event.Type {
	case "START_SESSION":
		if !exists {
			session = &Session{ID: event.SessionID, NextGeneration: 1}
			m.sessions[event.SessionID] = session
		}
		session.Active = true
		session.Connected = true
		session.State = StateIdle
		session.ActiveGenerationID = ""
		return nil, nil
	case "STOP_SESSION":
		if !exists {
			return nil, fmt.Errorf("unknown session")
		}
		session.Active = false
		session.State = StateIdle
		session.ActiveGenerationID = ""
		return nil, nil
	case "USER_SPEECH_START":
		if err := requireActiveSession(session); err != nil {
			return nil, err
		}
		session.State = StateListening
		return nil, nil
	case "USER_SPEECH_END":
		if err := requireActiveSession(session); err != nil {
			return nil, err
		}
		return m.handleStubPipeline(session, event.SessionID, stubTranscriptText)
	case "TEXT_INPUT":
		if event.Text == "" {
			return nil, fmt.Errorf("missing text")
		}
		if !exists {
			session = &Session{ID: event.SessionID, NextGeneration: 1}
			m.sessions[event.SessionID] = session
		}
		return m.handleStubPipeline(session, event.SessionID, event.Text)
	case "CANCEL_RESPONSE":
		if err := requireActiveSession(session); err != nil {
			return nil, err
		}
		if event.GenerationID == "" {
			return nil, fmt.Errorf("missing generationId")
		}
		if event.GenerationID != session.ActiveGenerationID {
			return nil, fmt.Errorf("generationId mismatch")
		}
		session.ActiveGenerationID = ""
		session.State = StateListening
		return nil, nil
	case "AUDIO_CHUNK":
		if err := requireActiveSession(session); err != nil {
			return nil, err
		}
		return nil, nil
	case "PING":
		if !exists {
			return nil, fmt.Errorf("unknown session")
		}
		return []ServerEvent{{
			Type:        "PONG",
			SessionID:   event.SessionID,
			TimestampMs: event.TimestampMs,
		}}, nil
	default:
		return nil, fmt.Errorf("unsupported event type")
	}
}

const silentWavBase64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="
const stubTranscriptText = "（音声入力）"

// MarkDisconnected は接続断の情報を会話セッションに反映する。
func (m *SessionManager) MarkDisconnected(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return
	}
	session.Connected = false
}

func requireActiveSession(session *Session) error {
	if session == nil {
		return fmt.Errorf("unknown session")
	}
	if !session.Active {
		return fmt.Errorf("session not active")
	}
	return nil
}

func (m *SessionManager) handleStubPipeline(session *Session, sessionID string, text string) ([]ServerEvent, error) {
	startedAt := time.Now()
	session.State = StateThinking
	session.ActiveGenerationID = fmt.Sprintf("gen-%d", session.NextGeneration)
	session.NextGeneration++
	session.Transcripts = append(session.Transcripts, TranscriptEntry{
		Speaker: "user",
		Text:    text,
	})
	generationID := session.ActiveGenerationID
	llmDoneAt := time.Now()
	ttsDoneAt := time.Now()
	llmMs := llmDoneAt.Sub(startedAt).Milliseconds()
	ttsMs := ttsDoneAt.Sub(llmDoneAt).Milliseconds()
	totalMs := ttsDoneAt.Sub(startedAt).Milliseconds()
	metrics := MetricSnapshot{
		GenerationID: generationID,
		LLMMs:        &llmMs,
		TTSMs:        &ttsMs,
		TotalMs:      totalMs,
		TimestampMs:  ttsDoneAt.UnixMilli(),
	}
	return []ServerEvent{
		{
			Type:         "ASSISTANT_SPEAKING",
			SessionID:    sessionID,
			GenerationID: generationID,
		},
		{
			Type:         "AUDIO_READY",
			SessionID:    sessionID,
			GenerationID: generationID,
			AudioBase64:  silentWavBase64,
			MimeType:     "audio/wav",
			Filename:     "reply.wav",
		},
		{
			Type:         "METRICS_UPDATE",
			SessionID:    sessionID,
			GenerationID: generationID,
			Metrics:      &metrics,
		},
		{
			Type:         "ASSISTANT_STOPPED",
			SessionID:    sessionID,
			GenerationID: generationID,
		},
	}, nil
}
