import React from "react";
import { styles } from "../styles";
import type { Role } from "../types";

interface RoleSelectorProps {
  role: Role;
  setRole: (role: Role) => void;
  onLogin: (ext: string) => void;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({
  role,
  setRole,
  onLogin,
}) => {
  if (role === "none") {
    return (
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
    );
  }

  if (role === "customer") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, margin: "0 0 6px" }}>
          Welcome! Log in as an external customer:
        </p>
        <button style={styles.btnBlue} onClick={() => onLogin("2001")}>
          👤 Enter as Customer (2001)
        </button>
        <button style={styles.btnBack} onClick={() => setRole("none")}>
          ← Back to role selection
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, margin: "0 0 6px" }}>
        Select your employee extension:
      </p>
      <button style={styles.btnBlue} onClick={() => onLogin("1001")}>
        🧑‍💼 Agent 1001 (Sales Team)
      </button>
      <button style={styles.btnBlue} onClick={() => onLogin("1002")}>
        👨‍💻 Agent 1002 (Support Team)
      </button>
      <button style={styles.btnBack} onClick={() => setRole("none")}>
        ← Back to role selection
      </button>
    </div>
  );
};
