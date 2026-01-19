package server

import (
	"net/http"

	"github.com/coder/websocket"
)

func AcceptWS(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	return websocket.Accept(w, r, nil)
}
