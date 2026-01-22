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
	Text         string      `json:"text,omitempty"`
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
	AudioBase64   string   `json:"audioBase64,omitempty"`
	MimeType      string   `json:"mimeType,omitempty"`
	Filename      string   `json:"filename,omitempty"`
	Metrics       *MetricSnapshot `json:"metrics,omitempty"`
}

type MetricSnapshot struct {
	GenerationID string `json:"generationId"`
	ASRMs        *int64 `json:"asrMs,omitempty"`
	LLMMs        *int64 `json:"llmMs,omitempty"`
	TTSMs        *int64 `json:"ttsMs,omitempty"`
	TotalMs      int64  `json:"totalMs"`
	TimestampMs  int64  `json:"timestampMs"`
}
