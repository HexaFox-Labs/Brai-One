export interface ServiceGeneratorSchema {
  name: string;
  kind?: "service" | "worker";
  database?: boolean;
}
