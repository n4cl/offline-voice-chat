package main

import (
	"log"
	"net/http"
	"os"

	"offline-voice-chat/backend/internal/mockservice"
)

func main() {
	addr := envOrDefault("ASR_ADDR", ":9001")
	h := mockservice.NewHandler("asr")
	log.Printf("mock asr listening on %s", addr)
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
