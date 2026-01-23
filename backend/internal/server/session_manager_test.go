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

func TestSessionManagerTextInputCreatesSession(t *testing.T) {
	manager := NewSessionManager()

	events, err := manager.Handle(ClientEvent{
		Type:      "TEXT_INPUT",
		SessionID: "s-text",
		Text:      "hello",
	})
	if err != nil {
		t.Fatalf("text input: %v", err)
	}
	if len(events) == 0 {
		t.Fatalf("expected server events for text input")
	}
	if session, ok := manager.Get("s-text"); !ok {
		t.Fatalf("expected session to be created")
	} else {
		if len(session.Transcripts) != 2 {
			t.Fatalf("expected user and assistant transcripts to be recorded")
		}
		if session.Transcripts[0].Text != "hello" {
			t.Fatalf("expected user transcript to be recorded")
		}
		if session.Transcripts[1].Speaker != "assistant" {
			t.Fatalf("expected assistant transcript")
		}
	}
	foundAudio := false
	for _, event := range events {
		if event.Type == "AUDIO_READY" {
			foundAudio = true
			if event.AudioBase64 == "" {
				t.Fatalf("expected audio payload")
			}
		}
	}
	if !foundAudio {
		t.Fatalf("expected AUDIO_READY event")
	}
}

func TestSessionManagerTextInputEmitsMetricsUpdate(t *testing.T) {
	manager := NewSessionManager()

	events, err := manager.Handle(ClientEvent{
		Type:      "TEXT_INPUT",
		SessionID: "s-metrics",
		Text:      "hello",
	})
	if err != nil {
		t.Fatalf("text input: %v", err)
	}

	var metricsEvent *ServerEvent
	for i := range events {
		if events[i].Type == "METRICS_UPDATE" {
			metricsEvent = &events[i]
			break
		}
	}
	if metricsEvent == nil {
		t.Fatalf("expected METRICS_UPDATE event")
	}
	if metricsEvent.Metrics == nil {
		t.Fatalf("expected metrics payload")
	}
	if metricsEvent.Metrics.GenerationID == "" {
		t.Fatalf("expected metrics generation id")
	}
	if metricsEvent.Metrics.TotalMs < 0 {
		t.Fatalf("expected non-negative totalMs")
	}
}

func TestSessionManagerSpeechEndUsesStubPipeline(t *testing.T) {
	manager := NewSessionManager()

	if _, err := manager.Handle(ClientEvent{Type: "START_SESSION", SessionID: "s-voice"}); err != nil {
		t.Fatalf("start session: %v", err)
	}

	events, err := manager.Handle(ClientEvent{
		Type:      "USER_SPEECH_END",
		SessionID: "s-voice",
	})
	if err != nil {
		t.Fatalf("speech end: %v", err)
	}
	if len(events) == 0 {
		t.Fatalf("expected server events for speech end")
	}
	session, ok := manager.Get("s-voice")
	if !ok {
		t.Fatalf("expected session to exist")
	}
	if len(session.Transcripts) != 2 {
		t.Fatalf("expected user and assistant transcripts to be recorded")
	}
	foundAudio := false
	for _, event := range events {
		if event.Type == "AUDIO_READY" {
			foundAudio = true
		}
	}
	if !foundAudio {
		t.Fatalf("expected AUDIO_READY event")
	}
}
