package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

const (
	DefaultAudioChunkMs = 20
	MinAudioChunkMs     = 20
	MaxAudioChunkMs     = 50
)

const (
	envConfigPath     = "BACKEND_CONFIG_PATH"
	envAudioChunkMs   = "BACKEND_AUDIO_CHUNK_MS"
	defaultConfigPath = "config.json"
)

// ServerConfig はサーバ設定値を保持する。
type ServerConfig struct {
	AudioChunkMs int `json:"audioChunkMs"`
}

// DefaultServerConfig はデフォルト設定を返す。
func DefaultServerConfig() ServerConfig {
	return ServerConfig{AudioChunkMs: DefaultAudioChunkMs}
}

// LoadServerConfigFromEnv は環境変数から設定を読み込む。
func LoadServerConfigFromEnv() (ServerConfig, error) {
	path := os.Getenv(envConfigPath)
	if path == "" {
		path = defaultConfigPath
	}
	return LoadServerConfig(path)
}

// LoadServerConfig は指定ファイルと環境変数から設定を読み込む。
func LoadServerConfig(path string) (ServerConfig, error) {
	cfg := DefaultServerConfig()

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				return cfg, err
			}
		} else if len(strings.TrimSpace(string(data))) > 0 {
			var fileConfig struct {
				AudioChunkMs *int `json:"audioChunkMs"`
			}
			if err := json.Unmarshal(data, &fileConfig); err != nil {
				return cfg, err
			}
			if fileConfig.AudioChunkMs != nil {
				if normalized, ok := normalizeAudioChunkMs(*fileConfig.AudioChunkMs); ok {
					cfg.AudioChunkMs = normalized
				} else {
					slog.Warn(
						"invalid_audio_chunk_ms_in_config",
						"event", "invalid_audio_chunk_ms_in_config",
						"value", *fileConfig.AudioChunkMs,
					)
				}
			}
		}
	}

	if envValue := os.Getenv(envAudioChunkMs); envValue != "" {
		parsed, err := strconv.Atoi(envValue)
		if err != nil {
			slog.Warn(
				"invalid_audio_chunk_ms_env",
				"event", "invalid_audio_chunk_ms_env",
				"value", envValue,
			)
			return cfg, nil
		}
		if normalized, ok := normalizeAudioChunkMs(parsed); ok {
			cfg.AudioChunkMs = normalized
		} else {
			slog.Warn(
				"invalid_audio_chunk_ms_env",
				"event", "invalid_audio_chunk_ms_env",
				"value", parsed,
			)
		}
	}

	return cfg, nil
}

func normalizeAudioChunkMs(value int) (int, bool) {
	if value < MinAudioChunkMs || value > MaxAudioChunkMs {
		return DefaultAudioChunkMs, false
	}
	return value, true
}
