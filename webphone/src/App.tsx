import { useState, useRef, useEffect } from "react";
import JsSIP from "jssip";

type Status = "disconnected" | "connecting" | "online" | "ringing" | "incall";
type Role = "none" | "customer" | "employee";

export default function App() {
  const [role, setRole] = useState<Role>("none");
  const [ext, setExt] = useState("");
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<Status>("disconnected");
  const [loggedIn, setLoggedIn] = useState(false);
  const [lastDtmf, setLastDtmf] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const uaRef = useRef<any>(null);
  const sessionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const statusText: Record<Status, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting...",
    online: `Online as ${ext}`,
    ringing: "📞 Incoming Call...",
    incall: "🔊 In Call",
  };

  const statusColor: Record<Status, string> = {
    disconnected: "#334155",
    connecting: "#334155",
    online: "#065f46",
    ringing: "#854d0e",
    incall: "#0284c7",
  };

  async function loginAs(selectedExt: string) {
    setExt(selectedExt);
    setStatus("connecting");

    if (selectedExt === "2001" || selectedExt === "2002") {
      setTarget("8000"); // Customer calls IVR by default
    } else if (selectedExt === "1001") {
      setTarget("1002");
    } else {
      setTarget("1001");
    }

    // Expose JsSIP to window
    (window as any).JsSIP = JsSIP;
    JsSIP.debug.enable("JsSIP:*");

    // Pre-warm microphone non-blocking in background
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => {
        console.warn("Microphone access warning:", e);
      });
    }

    const host = window.location.hostname || "localhost";
    const password = `${selectedExt}pass`;

    const isHttps = window.location.protocol === "https:";
    const wsProtocol = isHttps ? "wss:" : "ws:";
    const socketUrl = isHttps
      ? `${wsProtocol}//${window.location.host}/ws`
      : `${wsProtocol}//${host}:8088/ws`;

    const socket = new JsSIP.WebSocketInterface(socketUrl);

    const ua = new JsSIP.UA({
      sockets: [socket],
      uri: `sip:${selectedExt}@${host}`,
      authorization_user: selectedExt,
      password: password,
      register: true,
      realm: "asterisk",
    });

    ua.on("registered", () => {
      setStatus("online");
      setLoggedIn(true);
    });

    ua.on("registrationFailed", (e: any) => {
      console.error("Registration failed:", e?.cause);
      setStatus("disconnected");
    });

    ua.on("newRTCSession", (data: any) => {
      const session = data.session;
      sessionRef.current = session;

      // Attach track listener immediately when PeerConnection is created
      session.on("peerconnection", (pcData: any) => {
        pcData.peerconnection.addEventListener("track", (e: RTCTrackEvent) => {
          console.log("[AUDIO] Received remote audio track:", e.track);
          if (audioRef.current && e.track) {
            audioRef.current.srcObject = e.streams[0] || new MediaStream([e.track]);
            audioRef.current.play().catch((err) => console.warn("Audio autoplay blocked:", err));
          }
        });
      });

      if (session.direction === "incoming") {
        setStatus("ringing");
      }

      session.on("confirmed", () => {
        setStatus("incall");
        attachAudio(session);
      });

      session.on("ended", (e: any) => {
        setStatus("online");
        sessionRef.current = null;
        setLastDtmf("");
        if (e?.cause && e.cause !== "User Terminated") {
          setErrorMessage(`Call ended: ${e.cause}`);
        }
      });

      session.on("failed", (e: any) => {
        setStatus("online");
        sessionRef.current = null;
        setLastDtmf("");
        if (e?.cause && e.cause !== "Canceled" && e.cause !== "User Terminated") {
          setErrorMessage(`Call failed: ${e.cause}`);
        }
      });
    });

    ua.start();
    uaRef.current = ua;
  }

  function logout() {
    if (sessionRef.current) {
      sessionRef.current.terminate();
      sessionRef.current = null;
    }
    if (uaRef.current) {
      uaRef.current.stop();
      uaRef.current = null;
    }
    setLoggedIn(false);
    setStatus("disconnected");
    setRole("none");
    setExt("");
    setLastDtmf("");
    setErrorMessage("");
  }

  async function startCall(dialTarget?: string) {
    setErrorMessage("");
    const toCall = dialTarget || target;
    if (!uaRef.current || !toCall) return;

    // Check if browser allows microphone
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage("Microphone blocked: Browser disables mic on HTTP. Needs HTTPS or Chrome flag.");
      return;
    }

    try {
      // Test microphone access
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      setErrorMessage(`Microphone access error: ${err.message || err.name}`);
      return;
    }

    const AUDIO_CONSTRAINTS = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    try {
      const host = window.location.hostname || "localhost";
      const session = uaRef.current.call(`sip:${toCall}@${host}`, {
        mediaConstraints: { audio: AUDIO_CONSTRAINTS, video: false },
      });

      sessionRef.current = session;
      setStatus("connecting");
    } catch (err: any) {
      setErrorMessage(`Call start error: ${err.message}`);
    }
  }

  function answerCall() {
    sessionRef.current?.answer({
      mediaConstraints: {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      },
    });
  }

  function hangup() {
    sessionRef.current?.terminate();
    sessionRef.current = null;
    setStatus("online");
    setLastDtmf("");
  }

  function sendDtmf(digit: string) {
    if (sessionRef.current && status === "incall") {
      sessionRef.current.sendDTMF(digit);
      setLastDtmf(digit);
    }
  }

  function attachAudio(session: any) {
    if (!session?.connection) return;

    // Listen for incoming audio track from Asterisk
    session.connection.addEventListener("track", (e: RTCTrackEvent) => {
      if (audioRef.current && e.track) {
        audioRef.current.srcObject = e.streams[0] || new MediaStream([e.track]);
        audioRef.current.play().catch((err) => console.warn("Audio autoplay blocked:", err));
      }
    });

    // Also check existing receivers
    const stream = new MediaStream();
    session.connection.getReceivers().forEach((r: RTCRtpReceiver) => {
      if (r.track) stream.addTrack(r.track);
    });
    if (audioRef.current && stream.getTracks().length > 0) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch((err) => console.warn("Audio autoplay blocked:", err));
    }
  }

  // Keyboard shortcut listener for DTMF when in call
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (status === "incall" && ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*", "#"].includes(e.key)) {
        sendDtmf(e.key);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ ...styles.title, margin: 0 }}>
            {role === "customer" ? "🛍️ Customer Portal" : role === "employee" ? "💼 Employee Console" : "🌐 VoIP PBX"}
          </h2>
          {loggedIn && (
            <button style={styles.btnSmall} onClick={logout}>
              Log out
            </button>
          )}
        </div>

        {/* Status Bar */}
        {loggedIn && (
          <div style={{ ...styles.status, background: statusColor[status] }}>
            {statusText[status]}
          </div>
        )}

        {/* Error Message Banner */}
        {errorMessage && (
          <div style={{ background: "#7f1d1d", border: "1px solid #ef4444", color: "#fecaca", padding: "10px", borderRadius: "8px", fontSize: "12px", marginBottom: "12px", textAlign: "center" }}>
            ⚠️ {errorMessage}
          </div>
        )}

        {/* 1. INITIAL ROLE SELECTION */}
        {role === "none" && !loggedIn && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, margin: "0 0 4px" }}>
              Choose your portal to begin:
            </p>
            <button
              style={{ ...styles.btnRole, background: "#0284c7" }}
              onClick={() => setRole("customer")}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>🛍️</div>
              <div style={{ fontWeight: "bold", fontSize: 15 }}>Customer Portal</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Call company hotline & IVR</div>
            </button>
            <button
              style={{ ...styles.btnRole, background: "#475569" }}
              onClick={() => setRole("employee")}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>💼</div>
              <div style={{ fontWeight: "bold", fontSize: 15 }}>Employee Portal</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Log in as Sales or Support agent</div>
            </button>
          </div>
        )}

        {/* 2. CUSTOMER LOGIN SCREEN */}
        {role === "customer" && !loggedIn && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, margin: "0 0 6px" }}>
              Welcome! Log in as an external customer:
            </p>
            <button style={styles.btnBlue} onClick={() => loginAs("2001")}>
              👤 Customer 1 (2001)
            </button>
            <button style={{ ...styles.btnBlue, background: "#0369a1" }} onClick={() => loginAs("2002")}>
              👤 Customer 2 (2002)
            </button>
            <button style={styles.btnBack} onClick={() => setRole("none")}>
              ← Back to role selection
            </button>
          </div>
        )}

        {/* 3. EMPLOYEE LOGIN SCREEN */}
        {role === "employee" && !loggedIn && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, margin: "0 0 4px" }}>
              Select your employee extension:
            </p>
            <button style={styles.btnBlue} onClick={() => loginAs("1001")}>
              🧑‍💼 Agent 1001 (Sales 1)
            </button>
            <button style={{ ...styles.btnBlue, background: "#1d4ed8" }} onClick={() => loginAs("1003")}>
              🧑‍💼 Agent 1003 (Sales 2)
            </button>
            <button style={{ ...styles.btnBlue, background: "#0284c7" }} onClick={() => loginAs("1002")}>
              👨‍💻 Agent 1002 (Support 1)
            </button>
            <button style={{ ...styles.btnBlue, background: "#0369a1" }} onClick={() => loginAs("1004")}>
              👨‍💻 Agent 1004 (Support 2)
            </button>
            <button style={styles.btnBack} onClick={() => setRole("none")}>
              ← Back to role selection
            </button>
          </div>
        )}

        {/* 4. ACTIVE CALL VIEW FOR CUSTOMER */}
        {loggedIn && role === "customer" && (
          <div>
            {status === "online" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  style={{ ...styles.btnGreen, padding: "16px", fontSize: 15 }}
                  onClick={() => startCall("8000")}
                >
                  📞 Call Company Hotline (8000)
                </button>

                <div style={{ marginTop: 10 }}>
                  <label style={styles.label}>Or dial specific extension:</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      style={{ ...styles.input, marginBottom: 0 }}
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      placeholder="e.g. 1001"
                    />
                    <button style={{ ...styles.btnBlue, width: "auto" }} onClick={() => startCall(target)}>
                      Call
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* In-Call: Interactive Keypad for IVR */}
            {status === "incall" && (
              <div>
                <p style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", margin: "0 0 8px" }}>
                  Press keys on your keyboard or tap below:
                </p>

                {/* Quick IVR Options */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button style={styles.btnIvr} onClick={() => sendDtmf("1")}>
                    <span style={{ fontSize: 18, fontWeight: "bold" }}>1</span>
                    <span style={{ fontSize: 11 }}>Sales</span>
                  </button>
                  <button style={styles.btnIvr} onClick={() => sendDtmf("2")}>
                    <span style={{ fontSize: 18, fontWeight: "bold" }}>2</span>
                    <span style={{ fontSize: 11 }}>Support</span>
                  </button>
                </div>

                {/* Dialpad Matrix */}
                <div style={styles.dialpadGrid}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
                    <button key={d} style={styles.btnKey} onClick={() => sendDtmf(d)}>
                      {d}
                    </button>
                  ))}
                </div>

                {lastDtmf && (
                  <p style={{ textAlign: "center", color: "#38bdf8", fontSize: 12, margin: "6px 0 10px" }}>
                    Sent DTMF: <strong>{lastDtmf}</strong>
                  </p>
                )}

                <button style={{ ...styles.btnRed, marginTop: 10 }} onClick={hangup}>
                  ❌ Hang Up
                </button>
              </div>
            )}

            {status === "connecting" && (
              <button style={styles.btnRed} onClick={hangup}>
                ❌ Cancel Call
              </button>
            )}
          </div>
        )}

        {/* 5. ACTIVE CALL VIEW FOR EMPLOYEE */}
        {loggedIn && role === "employee" && (
          <div>
            {status === "online" && (
              <div>
                <label style={styles.label}>Call another extension or customer</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  <input
                    style={{ ...styles.input, marginBottom: 0 }}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                  <button style={{ ...styles.btnBlue, width: "auto" }} onClick={() => startCall(target)}>
                    📞 Call
                  </button>
                </div>
                <div style={{ background: "#0f172a", padding: 12, borderRadius: 8, textAlign: "center" }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
                    Ready for incoming calls from customers or IVR transfers.
                  </p>
                </div>
              </div>
            )}

            {status === "ringing" && (
              <div style={{ display: "flex", gap: "8px" }}>
                <button style={{ ...styles.btnGreen, flex: 1 }} onClick={answerCall}>
                  ✅ Answer
                </button>
                <button style={{ ...styles.btnRed, flex: 1 }} onClick={hangup}>
                  ❌ Reject
                </button>
              </div>
            )}

            {(status === "incall" || status === "connecting") && (
              <button style={styles.btnRed} onClick={hangup}>
                ❌ Hangup Call
              </button>
            )}
          </div>
        )}

        <audio ref={audioRef} autoPlay />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, -apple-system, sans-serif", background: "#0f172a", color: "#f8fafc", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", margin: 0, padding: 16, boxSizing: "border-box" },
  card: { background: "#1e293b", padding: 24, borderRadius: 16, width: 340, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" },
  title: { fontSize: 17, textAlign: "center" },
  status: { padding: 9, borderRadius: 8, marginBottom: 14, textAlign: "center", fontSize: 13, fontWeight: "bold" },
  label: { fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 },
  input: { width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: "1px solid #334155", background: "#0f172a", color: "white", fontSize: 14 },
  btnRole: { width: "100%", padding: 14, borderRadius: 10, border: "none", color: "white", cursor: "pointer", textAlign: "center", transition: "transform 0.1s" },
  btnBlue: { width: "100%", padding: 12, borderRadius: 8, border: "none", fontWeight: "bold", cursor: "pointer", background: "#2563eb", color: "white", fontSize: 14 },
  btnGreen: { width: "100%", padding: 12, borderRadius: 8, border: "none", fontWeight: "bold", cursor: "pointer", background: "#16a34a", color: "white", fontSize: 14 },
  btnRed: { width: "100%", padding: 12, borderRadius: 8, border: "none", fontWeight: "bold", cursor: "pointer", background: "#dc2626", color: "white", fontSize: 14 },
  btnBack: { width: "100%", padding: 8, borderRadius: 6, border: "none", background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer" },
  btnSmall: { padding: "4px 8px", fontSize: 11, background: "#334155", color: "#cbd5e1", border: "none", borderRadius: 4, cursor: "pointer" },
  btnIvr: { flex: 1, padding: 10, background: "#0369a1", color: "white", border: "none", borderRadius: 8, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center" },
  dialpadGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, margin: "6px 0" },
  btnKey: { padding: "10px 0", background: "#334155", color: "white", border: "none", borderRadius: 6, fontSize: 16, fontWeight: "bold", cursor: "pointer" },
};

