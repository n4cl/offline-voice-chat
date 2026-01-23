package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestWSBoundaryStatusSentOnConnect(t *testing.T) {
	srv := httptest.NewServer(NewMux())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	event := readServerEvent(t, conn)
	if event.Type != "BOUNDARY_STATUS" {
		t.Fatalf("expected BOUNDARY_STATUS, got %q", event.Type)
	}
	if event.SessionID == "" {
		t.Fatalf("expected sessionId to be set")
	}
	if event.Scope != "localhost" {
		t.Fatalf("expected scope localhost, got %q", event.Scope)
	}
	if !containsString(event.AllowedRanges, "127.0.0.0/8") {
		t.Fatalf("expected allowedRanges to include 127.0.0.0/8")
	}
}

func TestWSPingPong(t *testing.T) {
	srv := httptest.NewServer(NewMux())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	_ = readServerEvent(t, conn)
	_ = readServerEvent(t, conn)

	sessionID := "session-1"
	writeClientEvent(t, conn, ClientEvent{Type: "START_SESSION", SessionID: sessionID})

	ts := int64(123456)
	writeClientEvent(t, conn, ClientEvent{Type: "PING", SessionID: sessionID, TimestampMs: ts})

	event := readServerEvent(t, conn)
	if event.Type != "PONG" {
		t.Fatalf("expected PONG, got %q", event.Type)
	}
	if event.SessionID != sessionID {
		t.Fatalf("expected sessionId %q, got %q", sessionID, event.SessionID)
	}
	if event.TimestampMs != ts {
		t.Fatalf("expected timestamp %d, got %d", ts, event.TimestampMs)
	}
}

func TestWSConfigSentOnConnect(t *testing.T) {
	dir := t.TempDir()
	configPath := dir + "/config.json"
	if err := os.WriteFile(configPath, []byte(`{"audioChunkMs":30}`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("BACKEND_CONFIG_PATH", configPath)

	srv := httptest.NewServer(NewMux())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	_ = readServerEvent(t, conn)
	event := readServerEvent(t, conn)
	if event.Type != "CONFIG" {
		t.Fatalf("expected CONFIG, got %q", event.Type)
	}
	if event.AudioChunkMs != 30 {
		t.Fatalf("expected audioChunkMs 30, got %d", event.AudioChunkMs)
	}
}

func TestWSAcceptsAudioChunkBinaryFrames(t *testing.T) {
	srv := httptest.NewServer(NewMux())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	_ = readServerEvent(t, conn)
	_ = readServerEvent(t, conn)

	sessionID := "session-1"
	writeClientEvent(t, conn, ClientEvent{Type: "START_SESSION", SessionID: sessionID})

	writeClientEvent(t, conn, ClientEvent{
		Type:      "AUDIO_CHUNK",
		SessionID: sessionID,
		Chunk: &AudioChunk{
			SessionID:   sessionID,
			Sequence:    1,
			TimestampMs: 100,
			Format:      "pcm16",
			SampleRate:  16000,
			Channels:    1,
			ByteLength:  4,
		},
	})
	writeBinaryFrame(t, conn, []byte{0, 1, 2, 3})

	ts := int64(42)
	writeClientEvent(t, conn, ClientEvent{Type: "PING", SessionID: sessionID, TimestampMs: ts})
	event := readServerEvent(t, conn)
	if event.Type != "PONG" {
		t.Fatalf("expected PONG, got %q", event.Type)
	}
}

func TestWSAudioChunkTimeoutKeepsConnection(t *testing.T) {
	srv := httptest.NewServer(NewMux())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	_ = readServerEvent(t, conn)
	_ = readServerEvent(t, conn)

	sessionID := "session-1"
	writeClientEvent(t, conn, ClientEvent{Type: "START_SESSION", SessionID: sessionID})

	writeClientEvent(t, conn, ClientEvent{
		Type:      "AUDIO_CHUNK",
		SessionID: sessionID,
		Chunk: &AudioChunk{
			SessionID:   sessionID,
			Sequence:    1,
			TimestampMs: 100,
			Format:      "pcm16",
			SampleRate:  16000,
			Channels:    1,
			ByteLength:  4,
		},
	})

	time.Sleep(audioChunkBinaryTimeout + 20*time.Millisecond)

	ts := int64(99)
	writeClientEvent(t, conn, ClientEvent{Type: "PING", SessionID: sessionID, TimestampMs: ts})
	event := readServerEvent(t, conn)
	if event.Type != "PONG" {
		t.Fatalf("expected PONG, got %q", event.Type)
	}
}

func readServerEvent(t *testing.T, conn *websocket.Conn) ServerEvent {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read event: %v", err)
	}

	var event ServerEvent
	if err := json.Unmarshal(data, &event); err != nil {
		t.Fatalf("unmarshal event: %v", err)
	}
	return event
}

func writeClientEvent(t *testing.T, conn *websocket.Conn, event ClientEvent) {
	t.Helper()
	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, payload); err != nil {
		t.Fatalf("write event: %v", err)
	}
}

func writeBinaryFrame(t *testing.T, conn *websocket.Conn, payload []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageBinary, payload); err != nil {
		t.Fatalf("write binary: %v", err)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
