export type AudioCaptureHandlers = {
  onSpeechStart?: (timestampMs: number) => void;
  onSpeechEnd?: (timestampMs: number) => void;
  onError?: (error: Error) => void;
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
};

const DEFAULT_VAD_THRESHOLD = 0.02;
const DEFAULT_SPEECH_START_FRAMES = 3;
const DEFAULT_SPEECH_END_FRAMES = 10;

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

  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sinkNode: GainNode | null = null;
  private active = false;

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
          this.handlers.onSpeechEnd?.(payload.timestampMs);
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

  onError(callback: (error: Error) => void) {
    this.handlers.onError = callback;
  }
}
