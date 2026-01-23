package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadServerConfigDefaultsWhenFileMissing(t *testing.T) {
	t.Setenv("BACKEND_AUDIO_CHUNK_MS", "")

	cfg, err := LoadServerConfig(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.AudioChunkMs != DefaultAudioChunkMs {
		t.Fatalf("expected audioChunkMs %d, got %d", DefaultAudioChunkMs, cfg.AudioChunkMs)
	}
}

func TestLoadServerConfigUsesFileAndEnvOverride(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"audioChunkMs":30}`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("BACKEND_AUDIO_CHUNK_MS", "25")

	cfg, err := LoadServerConfig(path)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.AudioChunkMs != 25 {
		t.Fatalf("expected audioChunkMs 25, got %d", cfg.AudioChunkMs)
	}
}

func TestLoadServerConfigIgnoresInvalidEnvOverride(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"audioChunkMs":30}`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("BACKEND_AUDIO_CHUNK_MS", "10")

	cfg, err := LoadServerConfig(path)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.AudioChunkMs != 30 {
		t.Fatalf("expected audioChunkMs 30, got %d", cfg.AudioChunkMs)
	}
}

func TestLoadServerConfigDefaultsWhenFileValueOutOfRange(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"audioChunkMs":5}`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("BACKEND_AUDIO_CHUNK_MS", "")

	cfg, err := LoadServerConfig(path)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.AudioChunkMs != DefaultAudioChunkMs {
		t.Fatalf("expected audioChunkMs %d, got %d", DefaultAudioChunkMs, cfg.AudioChunkMs)
	}
}
