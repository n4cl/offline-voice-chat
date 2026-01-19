package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/coder/websocket"
)

func TestHealthz(t *testing.T) {
	h := NewMux()

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	res := w.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, res.StatusCode)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}

	if string(body) != "ok" {
		t.Fatalf("expected body ok, got %q", string(body))
	}
}

func TestAcceptWSRejectsNonWebSocket(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://example.com/ws", nil)
	w := httptest.NewRecorder()

	conn, err := AcceptWS(w, req)
	if err == nil {
		if conn != nil {
			_ = conn.Close(websocket.StatusNormalClosure, "")
		}
		t.Fatalf("expected error for non-websocket request")
	}

	res := w.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusUpgradeRequired {
		t.Fatalf("expected status %d, got %d", http.StatusUpgradeRequired, res.StatusCode)
	}
}
