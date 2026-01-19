package server

import (
	"net/http"
)

func NewMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok"))
	})

	wsHandler := NewWSHandler(DefaultBoundaryPolicy(), nil)
	mux.Handle("/ws", wsHandler)

	return mux
}
