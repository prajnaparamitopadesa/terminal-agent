// Stub file — overwritten by scripts/build-exe.ts when packaging the Windows exe.
// In dev mode this exports null, causing the backend to serve files from the filesystem.
export const frontendAssets: Map<string, { content: Buffer; mimeType: string }> | null = null;
