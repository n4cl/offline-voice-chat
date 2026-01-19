import "./app.css";

export default function App() {
  return (
    <main className="app">
      <h1>Offline Voice Chat</h1>
      <p>Local-only voice chat starter.</p>
      <div className="controls">
        <button type="button">Start</button>
        <button type="button" disabled>
          Stop
        </button>
      </div>
      <div className="status">Status: Idle</div>
      <div className="boundary">Boundary: Unknown</div>
    </main>
  );
}
