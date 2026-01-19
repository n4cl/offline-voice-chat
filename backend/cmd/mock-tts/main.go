package main

import (
	"log"
	"net/http"
	"os"

	"offline-voice-chat/backend/internal/mockservice"
)

func main() {
	addr := envOrDefault("TTS_ADDR", ":9003")
	h := mockservice.NewHandler("tts")
	log.Printf("mock tts listening on %s", addr)
	if err := http.ListenAndServe(addr, h); err != nil {
		log.Fatal(err)
	}
}

func envOrDefault(key, fallback string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	return val
}
