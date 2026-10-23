// Device sizes a recording or a reproduce run can emulate (CSS pixels).
export type Device = { id: string; label: string; width: number; height: number; scale: number; mobile: boolean };

export const DEVICES: Device[] = [
  { id: "iphone-15", label: "iPhone 15", width: 393, height: 852, scale: 3, mobile: true },
  { id: "pixel-8", label: "Pixel 8", width: 412, height: 915, scale: 2.625, mobile: true },
  { id: "ipad", label: "iPad Air", width: 820, height: 1180, scale: 2, mobile: true },
];

export const SCAN_WIDTHS = [360, 390, 768, 1024, 1440];

export const deviceLabel = (d: Device) => `${d.label} (${d.width}×${d.height})`;

/** Emulates a device on a tab the debugger is attached to. */
export async function emulate(target: { tabId: number }, d: { width: number; height: number; scale: number; mobile: boolean }) {
  await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", { width: d.width, height: d.height, deviceScaleFactor: d.scale, mobile: d.mobile });
  // maxTouchPoints must be 1–16 when given, so it's only sent when touch is on.
  await chrome.debugger.sendCommand(target, "Emulation.setTouchEmulationEnabled", d.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
}
