import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCapture } from "./audioCapture";

type MockMediaStream = {
  getTracks: () => Array<{ stop: ReturnType<typeof vi.fn> }>;
};

type MockAudioWorkletNode = {
  port: { onmessage: ((event: { data: any }) => void) | null };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const createMockStream = (): MockMediaStream => {
  const tracks = [{ stop: vi.fn() }];
  return {
    getTracks: () => tracks,
  };
};

const createMockWorkletNode = (): MockAudioWorkletNode => ({
  port: { onmessage: null },
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const createMockAudioContext = () => {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
  return {
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    destination: {},
    close: vi.fn().mockResolvedValue(undefined),
    __source: source,
    __gain: gain,
  };
};

describe("AudioCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits speech start/end when worklet messages arrive", async () => {
    const stream = createMockStream();
    const workletNode = createMockWorkletNode();
    const context = createMockAudioContext();

    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();

    const capture = new AudioCapture({
      getUserMedia: vi.fn().mockResolvedValue(stream),
      audioContextFactory: vi.fn(() => context as unknown as AudioContext),
      audioWorkletNodeFactory: vi.fn(() => workletNode as unknown as AudioWorkletNode),
      workletModuleUrl: "mock://vad",
    });
    capture.onSpeechStart(onSpeechStart);
    capture.onSpeechEnd(onSpeechEnd);

    await capture.start();

    workletNode.port.onmessage?.({ data: { type: "speech_start", timestampMs: 123 } });
    workletNode.port.onmessage?.({ data: { type: "speech_end", timestampMs: 456 } });

    expect(onSpeechStart).toHaveBeenCalledWith(123);
    expect(onSpeechEnd).toHaveBeenCalledWith(456);
  });

  it("notifies error when microphone acquisition fails", async () => {
    const onError = vi.fn();
    const capture = new AudioCapture({
      getUserMedia: vi.fn().mockRejectedValue(new Error("denied")),
      audioContextFactory: vi.fn(),
      audioWorkletNodeFactory: vi.fn(),
      workletModuleUrl: "mock://vad",
    });
    capture.onError(onError);

    await capture.start();

    expect(onError).toHaveBeenCalled();
  });

  it("stops tracks and disconnects nodes on stop", async () => {
    const stream = createMockStream();
    const workletNode = createMockWorkletNode();
    const context = createMockAudioContext();

    const capture = new AudioCapture({
      getUserMedia: vi.fn().mockResolvedValue(stream),
      audioContextFactory: vi.fn(() => context as unknown as AudioContext),
      audioWorkletNodeFactory: vi.fn(() => workletNode as unknown as AudioWorkletNode),
      workletModuleUrl: "mock://vad",
    });

    await capture.start();
    capture.stop();

    const track = stream.getTracks()[0];
    expect(track.stop).toHaveBeenCalled();
    expect(workletNode.disconnect).toHaveBeenCalled();
    expect(context.__source.disconnect).toHaveBeenCalled();
  });
});
