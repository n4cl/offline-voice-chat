package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"

	"github.com/coder/websocket"
)

type WSHandler struct {
	sessions *SessionManager
	policy   BoundaryPolicy
	nextID   uint64
}

func NewWSHandler(policy BoundaryPolicy, sessions *SessionManager) *WSHandler {
	if sessions == nil {
		sessions = NewSessionManager()
	}
	return &WSHandler{sessions: sessions, policy: policy}
}

func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ip := remoteIP(r.RemoteAddr)
	if !h.policy.AllowsIP(ip) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	conn, err := AcceptWS(w, r)
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	connID := h.nextConnectionID()
	boundaryEvent := ServerEvent{
		Type:          "BOUNDARY_STATUS",
		SessionID:     connID,
		Scope:         h.policy.ScopeForIP(ip),
		AllowedRanges: h.policy.AllowedRanges,
	}
	_ = writeServerEvent(r.Context(), conn, boundaryEvent)

	var lastSessionID string
	for {
		clientEvent, err := readClientEvent(r.Context(), conn)
		if err != nil {
			if lastSessionID != "" {
				h.sessions.MarkDisconnected(lastSessionID)
			}
			return
		}
		if clientEvent.SessionID != "" {
			lastSessionID = clientEvent.SessionID
		}

		serverEvents, err := h.sessions.Handle(clientEvent)
		if err != nil {
			_ = writeServerEvent(r.Context(), conn, ServerEvent{
				Type:      "ERROR",
				SessionID: clientEvent.SessionID,
				Code:      "UNKNOWN",
				Message:   err.Error(),
			})
			continue
		}
		for _, event := range serverEvents {
			_ = writeServerEvent(r.Context(), conn, event)
		}
	}
}

func (h *WSHandler) nextConnectionID() string {
	id := atomic.AddUint64(&h.nextID, 1)
	return fmt.Sprintf("conn-%d", id)
}

func readClientEvent(ctx context.Context, conn *websocket.Conn) (ClientEvent, error) {
	_, data, err := conn.Read(ctx)
	if err != nil {
		return ClientEvent{}, err
	}

	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return ClientEvent{}, fmt.Errorf("invalid json")
	}
	if envelope.Type == "" {
		return ClientEvent{}, fmt.Errorf("missing type")
	}

	event := ClientEvent{Type: envelope.Type}
	if err := json.Unmarshal(data, &event); err != nil {
		return ClientEvent{}, fmt.Errorf("invalid event")
	}
	return event, nil
}

func writeServerEvent(ctx context.Context, conn *websocket.Conn, event ServerEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, payload)
}
