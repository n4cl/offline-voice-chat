package server

import (
	"log/slog"
	"net/http"
)

// NewMux はHTTPルーティングを構築する。
func NewMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok"))
	})

	config, err := LoadServerConfigFromEnv()
	if err != nil {
		slog.Error("config_load_failed", "event", "config_load_failed", "err", err)
		config = DefaultServerConfig()
	}
	wsHandler := NewWSHandler(DefaultBoundaryPolicy(), nil, config)
	mux.Handle("/ws", wsHandler)

	return mux
}
