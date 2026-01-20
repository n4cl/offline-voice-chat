package main

import (
	"log/slog"
	"net/http"
	"os"

	"offline-voice-chat/backend/internal/mockservice"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	addr := envOrDefault("LLM_ADDR", ":9002")
	h := mockservice.NewHandler("llm")
	slog.Info("mock_llm_listening", "event", "mock_llm_listening", "addr", addr)
	if err := http.ListenAndServe(addr, h); err != nil {
		slog.Error("mock_llm_listen_failed", "event", "mock_llm_listen_failed", "err", err)
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
