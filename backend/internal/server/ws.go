package server

import (
	"net/http"

	"github.com/coder/websocket"
)

func AcceptWS(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	return websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: localOriginPatterns(),
	})
}

func localOriginPatterns() []string {
	return []string{
		"localhost:*",
		"127.0.0.1:*",
		"[::1]:*",
	}
}
