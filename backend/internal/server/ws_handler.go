package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"

	"github.com/coder/websocket"
)

// WSHandler はWS接続の受付とイベントループを担う。
type WSHandler struct {
	sessions *SessionManager
	policy   BoundaryPolicy
	config   ServerConfig
	nextID   uint64
}

// NewWSHandler は境界ポリシーと会話セッション管理を受け取り初期化する。
func NewWSHandler(policy BoundaryPolicy, sessions *SessionManager, config ServerConfig) *WSHandler {
	if sessions == nil {
		sessions = NewSessionManager()
	}
	if config.AudioChunkMs == 0 {
		config = DefaultServerConfig()
	}
	return &WSHandler{sessions: sessions, policy: policy, config: config}
}

// ServeHTTP はWS接続を受け付け、クライアントイベントを処理する。
func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ip := remoteIP(r.RemoteAddr)
	origin := r.Header.Get("Origin")
	slog.Info(
		"ws_connect",
		"event", "ws_connect",
		"remoteAddr", r.RemoteAddr,
		"ip", formatIP(ip),
		"origin", origin,
	)
	if !h.policy.AllowsIP(ip) {
		slog.Warn(
			"ws_forbidden",
			"event", "ws_forbidden",
			"remoteAddr", r.RemoteAddr,
			"ip", formatIP(ip),
			"origin", origin,
		)
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	conn, err := AcceptWS(w, r)
	if err != nil {
		slog.Error(
			"ws_accept_failed",
			"event", "ws_accept_failed",
			"remoteAddr", r.RemoteAddr,
			"ip", formatIP(ip),
			"origin", origin,
			"err", err,
		)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	connID := h.nextConnectionID()
	slog.Info(
		"ws_accepted",
		"event", "ws_accepted",
		"connId", connID,
		"ip", formatIP(ip),
		"origin", origin,
		"scope", h.policy.ScopeForIP(ip),
	)
	boundaryEvent := ServerEvent{
		Type:          "BOUNDARY_STATUS",
		SessionID:     connID,
		Scope:         h.policy.ScopeForIP(ip),
		AllowedRanges: h.policy.AllowedRanges,
	}
	_ = writeServerEvent(r.Context(), conn, boundaryEvent)
	configEvent := ServerEvent{
		Type:         "CONFIG",
		SessionID:    connID,
		AudioChunkMs: h.config.AudioChunkMs,
	}
	_ = writeServerEvent(r.Context(), conn, configEvent)

	var lastSessionID string
	var pendingAudioChunk bool
	for {
		messageType, data, err := conn.Read(r.Context())
		if err != nil {
			if lastSessionID != "" {
				h.sessions.MarkDisconnected(lastSessionID)
			}
			slog.Error(
				"ws_read_error",
				"event", "ws_read_error",
				"connId", connID,
				"sessionId", lastSessionID,
				"err", err,
			)
			return
		}
		if messageType == websocket.MessageBinary {
			if pendingAudioChunk {
				pendingAudioChunk = false
			}
			continue
		}

		clientEvent, err := parseClientEvent(data)
		if err != nil {
			if pendingAudioChunk {
				pendingAudioChunk = false
			}
			slog.Error(
				"ws_read_error",
				"event", "ws_read_error",
				"connId", connID,
				"sessionId", lastSessionID,
				"err", err,
			)
			return
		}
		if clientEvent.SessionID != "" {
			lastSessionID = clientEvent.SessionID
		}
		if clientEvent.Type == "AUDIO_CHUNK" && clientEvent.Chunk != nil {
			pendingAudioChunk = true
		} else if pendingAudioChunk {
			pendingAudioChunk = false
		}
		logClientEvent(connID, clientEvent)

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

func parseClientEvent(data []byte) (ClientEvent, error) {
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
	if event.Type == "AUDIO_CHUNK" && event.Chunk == nil {
		return ClientEvent{}, fmt.Errorf("missing chunk")
	}
	if event.SessionID == "" && event.Chunk != nil && event.Chunk.SessionID != "" {
		event.SessionID = event.Chunk.SessionID
	}
	return event, nil
}

func logClientEvent(connID string, event ClientEvent) {
	if event.Chunk != nil {
		slog.Info(
			"ws_client_event",
			"event", "ws_client_event",
			"connId", connID,
			"type", event.Type,
			"sessionId", event.SessionID,
			"generationId", event.GenerationID,
			"timestampMs", event.TimestampMs,
			"chunkSequence", event.Chunk.Sequence,
			"chunkTimestampMs", event.Chunk.TimestampMs,
			"chunkFormat", event.Chunk.Format,
			"chunkSampleRate", event.Chunk.SampleRate,
			"chunkChannels", event.Chunk.Channels,
		)
		return
	}
	slog.Info(
		"ws_client_event",
		"event", "ws_client_event",
		"connId", connID,
		"type", event.Type,
		"sessionId", event.SessionID,
		"generationId", event.GenerationID,
		"timestampMs", event.TimestampMs,
	)
}

func formatIP(ip net.IP) string {
	if ip == nil {
		return ""
	}
	return ip.String()
}

func writeServerEvent(ctx context.Context, conn *websocket.Conn, event ServerEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, payload)
}
