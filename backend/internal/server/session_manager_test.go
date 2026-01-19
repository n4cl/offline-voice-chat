package server

import "testing"

func TestSessionManagerLifecycle(t *testing.T) {
	manager := NewSessionManager()

	if _, err := manager.Handle(ClientEvent{Type: "START_SESSION", SessionID: "s1"}); err != nil {
		t.Fatalf("start session: %v", err)
	}
	if session, ok := manager.Get("s1"); !ok || !session.Active {
		t.Fatalf("expected active session after start")
	}

	if _, err := manager.Handle(ClientEvent{Type: "USER_SPEECH_START", SessionID: "s1", TimestampMs: 10}); err != nil {
		t.Fatalf("speech start: %v", err)
	}
	if session, _ := manager.Get("s1"); session.State != StateListening {
		t.Fatalf("expected state listening, got %q", session.State)
	}

	if _, err := manager.Handle(ClientEvent{Type: "USER_SPEECH_END", SessionID: "s1", TimestampMs: 20}); err != nil {
		t.Fatalf("speech end: %v", err)
	}
	session, _ := manager.Get("s1")
	if session.State != StateThinking {
		t.Fatalf("expected state thinking, got %q", session.State)
	}
	if session.ActiveGenerationID == "" {
		t.Fatalf("expected generation id to be set")
	}
	generationID := session.ActiveGenerationID

	if _, err := manager.Handle(ClientEvent{Type: "CANCEL_RESPONSE", SessionID: "s1", GenerationID: generationID}); err != nil {
		t.Fatalf("cancel response: %v", err)
	}
	if session, _ := manager.Get("s1"); session.ActiveGenerationID != "" || session.State != StateListening {
		t.Fatalf("expected generation cleared and state listening after cancel")
	}

	if _, err := manager.Handle(ClientEvent{Type: "STOP_SESSION", SessionID: "s1"}); err != nil {
		t.Fatalf("stop session: %v", err)
	}
	if session, _ := manager.Get("s1"); session.Active || session.State != StateIdle {
		t.Fatalf("expected idle inactive session after stop")
	}
}
