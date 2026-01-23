export type AudioCaptureHandlers = {
  onSpeechStart?: (timestampMs: number) => void;
  onSpeechEnd?: (timestampMs: number) => void;
  onChunk?: (payload: AudioChunkPayload) => void;
  onError?: (error: Error) => void;
};

export type AudioFormat = "pcm16";

export type SampleRateHz = number;

export type AudioChunkMeta = {
  sequence: number;
  timestampMs: number;
  format: AudioFormat;
  sampleRateHz: SampleRateHz;
  channels: 1 | 2;
  byteLength: number;
};

export type AudioChunkPayload = {
  meta: AudioChunkMeta;
  data: ArrayBuffer;
};

export type AudioCaptureOptions = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  audioContextFactory?: () => AudioContext;
  audioWorkletNodeFactory?: (
    context: AudioContext,
    name: string,
    options?: AudioWorkletNodeOptions,
  ) => AudioWorkletNode;
  workletModuleUrl?: string | URL;
  vadThreshold?: number;
  speechStartFrames?: number;
  speechEndFrames?: number;
  chunkDurationMs?: number;
};

const DEFAULT_VAD_THRESHOLD = 0.02;
const DEFAULT_SPEECH_START_FRAMES = 3;
const DEFAULT_SPEECH_END_FRAMES = 10;
const DEFAULT_CHUNK_DURATION_MS = 20;
const MIN_CHUNK_DURATION_MS = 20;
const MAX_CHUNK_DURATION_MS = 50;

export class AudioCapture {
  private getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private audioContextFactory: () => AudioContext;
  private audioWorkletNodeFactory: (
    context: AudioContext,
    name: string,
    options?: AudioWorkletNodeOptions,
  ) => AudioWorkletNode;
  private workletModuleUrl: string | URL;
  private vadThreshold: number;
  private speechStartFrames: number;
  private speechEndFrames: number;
  private chunkDurationMs: number;

  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sinkNode: GainNode | null = null;
  private active = false;
  private pendingSamples: number[] = [];
  private chunkSamples = 0;
  private sequence = 1;

  private handlers: AudioCaptureHandlers = {};

  constructor(options: AudioCaptureOptions = {}) {
    this.getUserMedia =
      options.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    this.audioContextFactory = options.audioContextFactory ?? (() => new AudioContext());
    this.audioWorkletNodeFactory =
      options.audioWorkletNodeFactory ??
      ((context, name, nodeOptions) => new AudioWorkletNode(context, name, nodeOptions));
    this.workletModuleUrl =
      options.workletModuleUrl ?? new URL("./vadWorklet.ts", import.meta.url);
    this.vadThreshold = options.vadThreshold ?? DEFAULT_VAD_THRESHOLD;
    this.speechStartFrames = options.speechStartFrames ?? DEFAULT_SPEECH_START_FRAMES;
    this.speechEndFrames = options.speechEndFrames ?? DEFAULT_SPEECH_END_FRAMES;
    this.chunkDurationMs = options.chunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS;
  }

  async start() {
    if (this.active) {
      return;
    }
    this.active = true;
    try {
      this.stream = await this.getUserMedia({ audio: true });
      this.context = this.audioContextFactory();
      if (!this.context.audioWorklet) {
        throw new Error("AudioWorklet is not supported");
      }
      await this.context.audioWorklet.addModule(this.workletModuleUrl);
      this.source = this.context.createMediaStreamSource(this.stream);
      this.chunkSamples = resolveChunkSamples(
        this.context.sampleRate,
        this.chunkDurationMs,
      );
      this.sequence = 1;
      this.pendingSamples = [];
      this.workletNode = this.audioWorkletNodeFactory(this.context, "vad-processor", {
        processorOptions: {
          threshold: this.vadThreshold,
          speechStartFrames: this.speechStartFrames,
          speechEndFrames: this.speechEndFrames,
        },
      });
      this.workletNode.port.onmessage = (event) => {
        const payload = event.data;
        if (!payload || typeof payload.type !== "string") {
          return;
        }
        if (payload.type === "speech_start") {
          this.handlers.onSpeechStart?.(payload.timestampMs);
        }
        if (payload.type === "speech_end") {
          this.pendingSamples = [];
          this.handlers.onSpeechEnd?.(payload.timestampMs);
        }
        if (payload.type === "audio_frame" && payload.payload instanceof Float32Array) {
          this.handleAudioFrame(payload.payload);
        }
        if (payload.type === "error") {
          this.handlers.onError?.(new Error(payload.message ?? "vad error"));
        }
      };
      this.sinkNode = this.context.createGain();
      this.sinkNode.gain.value = 0;
      this.source.connect(this.workletNode);
      this.workletNode.connect(this.sinkNode);
      this.sinkNode.connect(this.context.destination);
    } catch (error) {
      this.handlers.onError?.(error instanceof Error ? error : new Error("audio capture failed"));
      this.stop();
    }
  }

  stop() {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.pendingSamples = [];
    this.chunkSamples = 0;
    if (this.workletNode) {
      this.workletNode.disconnect();
    }
    if (this.source) {
      this.source.disconnect();
    }
    if (this.sinkNode) {
      this.sinkNode.disconnect();
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
    }
    if (this.context) {
      this.context.close();
    }
    this.stream = null;
    this.context = null;
    this.source = null;
    this.workletNode = null;
    this.sinkNode = null;
  }

  onSpeechStart(callback: (timestampMs: number) => void) {
    this.handlers.onSpeechStart = callback;
  }

  onSpeechEnd(callback: (timestampMs: number) => void) {
    this.handlers.onSpeechEnd = callback;
  }

  onChunk(callback: (payload: AudioChunkPayload) => void) {
    this.handlers.onChunk = callback;
  }

  onError(callback: (error: Error) => void) {
    this.handlers.onError = callback;
  }

  private handleAudioFrame(frame: Float32Array) {
    if (!this.context || this.chunkSamples === 0) {
      return;
    }
    for (let index = 0; index < frame.length; index += 1) {
      this.pendingSamples.push(frame[index]);
    }
    while (this.pendingSamples.length >= this.chunkSamples) {
      const samples = this.pendingSamples.splice(0, this.chunkSamples);
      const pcm = new Int16Array(samples.length);
      for (let index = 0; index < samples.length; index += 1) {
        const value = Math.max(-1, Math.min(1, samples[index]));
        pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
      }
      const data = pcm.buffer;
      const meta: AudioChunkMeta = {
        sequence: this.sequence,
        timestampMs: Date.now(),
        format: "pcm16",
        sampleRateHz: this.context.sampleRate,
        channels: 1,
        byteLength: data.byteLength,
      };
      this.sequence += 1;
      this.handlers.onChunk?.({ meta, data });
    }
  }
}

const resolveChunkSamples = (sampleRate: number, chunkDurationMs: number) => {
  const clamped = Math.max(MIN_CHUNK_DURATION_MS, Math.min(MAX_CHUNK_DURATION_MS, chunkDurationMs));
  const samples = Math.round(sampleRate * (clamped / 1000));
  return Math.max(1, samples);
};
