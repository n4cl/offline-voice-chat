import { WSClient, type WSClientOptions } from "./wsClient";

const DISCONNECT_GRACE_MS = 100;

let sharedClient: WSClient | null = null;
let sharedUrl: string | null = null;
let refCount = 0;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** 共有WSクライアントを取得し、ハンドラを更新する。 */
export const acquireWSClient = (options: WSClientOptions) => {
  if (!sharedClient || sharedUrl !== options.url) {
    sharedClient = new WSClient(options);
    sharedUrl = options.url;
  } else {
    sharedClient.updateHandlers({
      onEvent: options.onEvent,
      onError: options.onError,
      onConnectionChange: options.onConnectionChange,
    });
  }

  refCount += 1;
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  return sharedClient;
};

/** 共有WSクライアントの参照を解放し、必要に応じて切断する。 */
export const releaseWSClient = () => {
  if (refCount === 0) {
    return;
  }
  refCount -= 1;
  if (refCount !== 0 || disconnectTimer) {
    return;
  }
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    if (refCount === 0 && sharedClient) {
      sharedClient.disconnect();
    }
  }, DISCONNECT_GRACE_MS);
};
