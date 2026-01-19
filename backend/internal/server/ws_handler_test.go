package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"net/http/httptest"
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

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
