export const ASTERISK_URL = "http://localhost:8088";
export const ARI_USER = "node_user";
export const ARI_PASS = "nodepass";
export const APP_NAME = "node-ari";

export type DepartmentKey = "sales" | "support";

export interface DepartmentConfig {
  name: string;
  agents: string[];
}

export const DEPARTMENTS: Record<DepartmentKey, DepartmentConfig> = {
  sales: {
    name: "Sales",
    agents: ["1001"],
  },
  support: {
    name: "Support",
    agents: ["1002"],
  },
};
