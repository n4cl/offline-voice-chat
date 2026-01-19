package main

import (
	"log"
	"net/http"
	"os"

	"offline-voice-chat/backend/internal/server"
)

func main() {
	addr := envOrDefault("BACKEND_ADDR", ":8080")

	h := server.NewMux()
	log.Printf("backend listening on %s", addr)
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
