package main

import (
	"log/slog"
	"net/http"
	"os"

	"offline-voice-chat/backend/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	addr := envOrDefault("BACKEND_ADDR", ":8080")

	h := server.NewMux()
	slog.Info("backend_listening", "event", "backend_listening", "addr", addr)
	if err := http.ListenAndServe(addr, h); err != nil {
		slog.Error("backend_listen_failed", "event", "backend_listen_failed", "err", err)
		os.Exit(1)
	}
}

func envOrDefault(key, fallback string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	return val
}
