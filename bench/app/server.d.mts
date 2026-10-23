export const LOGIN: { email: string; password: string };
export function startServer(port?: number): Promise<{ url: string; close: () => void }>;
