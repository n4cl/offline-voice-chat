package mockservice

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthz(t *testing.T) {
	h := NewHandler("asr")

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	res := w.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, res.StatusCode)
	}

	var payload healthResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if payload.Service != "asr" {
		t.Fatalf("expected service asr, got %q", payload.Service)
	}
	if !payload.OK {
		t.Fatalf("expected ok true")
	}
}

func TestTranscribeEndpoint(t *testing.T) {
	h := NewHandler("asr")

	req := httptest.NewRequest(http.MethodPost, "/transcribe", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	res := w.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, res.StatusCode)
	}

	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["text"] == "" {
		t.Fatalf("expected text in response")
	}
}

func TestGenerateEndpoint(t *testing.T) {
	h := NewHandler("llm")

	req := httptest.NewRequest(http.MethodPost, "/generate", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	res := w.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, res.StatusCode)
	}

	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["text"] == "" {
		t.Fatalf("expected text in response")
	}
}

func TestSynthesizeEndpoint(t *testing.T) {
	h := NewHandler("tts")

	req := httptest.NewRequest(http.MethodPost, "/synthesize", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	res := w.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, res.StatusCode)
	}

	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["sampleRateHz"] != float64(24000) {
		t.Fatalf("expected sampleRateHz 24000")
	}
}
