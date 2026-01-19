package mockservice

import (
	"encoding/json"
	"net/http"
)

type healthResponse struct {
	OK      bool   `json:"ok"`
	Service string `json:"service"`
}

func NewHandler(serviceName string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, healthResponse{OK: true, Service: serviceName})
	})

	switch serviceName {
	case "asr":
		mux.HandleFunc("/transcribe", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{
				"text":     "hello from mock asr",
				"isFinal":  true,
				"service":  serviceName,
				"language": "ja",
			})
		})
	case "llm":
		mux.HandleFunc("/generate", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{
				"text":    "hello from mock llm",
				"tokens":  5,
				"service": serviceName,
			})
		})
	case "tts":
		mux.HandleFunc("/synthesize", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{
				"audio":        "",
				"sampleRateHz": 24000,
				"service":      serviceName,
			})
		})
	default:
		mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusNotFound, map[string]any{
				"error": "unknown service",
			})
		})
	}

	return mux
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
