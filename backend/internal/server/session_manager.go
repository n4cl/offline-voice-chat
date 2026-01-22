package server

import (
	"fmt"
	"sync"
)

type SessionState string

const (
	StateIdle      SessionState = "idle"
	StateListening SessionState = "listening"
	StateThinking  SessionState = "thinking"
	StateSpeaking  SessionState = "speaking"
	StateCanceling SessionState = "canceling"
)

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

type SessionManager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewSessionManager() *SessionManager {
	return &SessionManager{sessions: make(map[string]*Session)}
}

func (m *SessionManager) Get(sessionID string) (Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return Session{}, false
	}
	return *session, true
}

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
		session.State = StateThinking
		session.ActiveGenerationID = fmt.Sprintf("gen-%d", session.NextGeneration)
		session.NextGeneration++
		return nil, nil
	case "TEXT_INPUT":
		if event.Text == "" {
			return nil, fmt.Errorf("missing text")
		}
		if !exists {
			session = &Session{ID: event.SessionID, NextGeneration: 1}
			m.sessions[event.SessionID] = session
		}
		session.State = StateThinking
		session.ActiveGenerationID = fmt.Sprintf("gen-%d", session.NextGeneration)
		session.NextGeneration++
		session.Transcripts = append(session.Transcripts, TranscriptEntry{
			Speaker: "user",
			Text:    event.Text,
		})
		generationID := session.ActiveGenerationID
		return []ServerEvent{
			{
				Type:         "ASSISTANT_SPEAKING",
				SessionID:    event.SessionID,
				GenerationID: generationID,
			},
			{
				Type:         "AUDIO_READY",
				SessionID:    event.SessionID,
				GenerationID: generationID,
				AudioBase64:  silentWavBase64,
				MimeType:     "audio/wav",
				Filename:     "reply.wav",
			},
			{
				Type:         "ASSISTANT_STOPPED",
				SessionID:    event.SessionID,
				GenerationID: generationID,
			},
		}, nil
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
