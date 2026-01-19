package server

type AudioChunk struct {
	SessionID   string `json:"sessionId,omitempty"`
	Sequence    int    `json:"sequence,omitempty"`
	TimestampMs int64  `json:"timestampMs,omitempty"`
	Format      string `json:"format,omitempty"`
	SampleRate  int    `json:"sampleRateHz,omitempty"`
	Channels    int    `json:"channels,omitempty"`
	Data        any    `json:"data,omitempty"`
}

type ClientEvent struct {
	Type         string      `json:"type"`
	SessionID    string      `json:"sessionId,omitempty"`
	TimestampMs  int64       `json:"timestampMs,omitempty"`
	GenerationID string      `json:"generationId,omitempty"`
	Chunk        *AudioChunk `json:"chunk,omitempty"`
}

type ServerEvent struct {
	Type          string   `json:"type"`
	SessionID     string   `json:"sessionId,omitempty"`
	GenerationID  string   `json:"generationId,omitempty"`
	TimestampMs   int64    `json:"timestampMs,omitempty"`
	Scope         string   `json:"scope,omitempty"`
	AllowedRanges []string `json:"allowedRanges,omitempty"`
	Code          string   `json:"code,omitempty"`
	Message       string   `json:"message,omitempty"`
	Text          string   `json:"text,omitempty"`
}
