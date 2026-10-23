// DOM recording with rrweb, injected only into tabs that are being recorded or have instant replay on.
// Inputs are masked and passwords never recorded. Events stay in this tab until the background asks.
import { record } from "@rrweb/record";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

type Event = { type: number; timestamp: number };
type State = { segments: Event[][]; keepAll: boolean; stop?: () => void };

const MAX_BYTES = 15 * 1024 * 1024;

export default defineUnlistedScript(() => {
  const w = window as unknown as { __reproReplay?: State };
  if (w.__reproReplay) return;
  // Each segment starts with a full snapshot. Instant replay keeps the last two (30 to 60 seconds);
  // during a recording everything since Record is kept.
  const state: State = (w.__reproReplay = { segments: [[]], keepAll: false });

  state.stop = record({
    emit(event, isCheckout) {
      if (isCheckout) {
        state.segments.push([]);
        if (!state.keepAll && state.segments.length > 3) state.segments.shift();
      }
      state.segments.at(-1)!.push(event as Event);
    },
    checkoutEveryNms: 30_000,
    maskAllInputs: true,
    maskInputOptions: { password: true },
    blockClass: "repro-block",
    recordCanvas: false,
    collectFonts: false,
    sampling: { mousemove: 50, scroll: 150, input: "last" },
  });

  chrome.runtime.onMessage.addListener((msg: { type: string; keepAll?: boolean; windowMs?: number }, _sender, reply) => {
    if (msg.type === "replay:keep-all") {
      // Start of a recording: begin a fresh segment so the replay starts exactly at Record.
      state.keepAll = Boolean(msg.keepAll);
      if (state.keepAll) {
        state.segments = [[]];
        record.takeFullSnapshot(true);
      }
      reply({ ok: true });
    } else if (msg.type === "replay:collect") {
      // The last complete segments that cover the window, oldest dropped first when over the size cap.
      let events = state.segments.flat();
      if (msg.windowMs && !state.keepAll) {
        const since = Date.now() - msg.windowMs;
        const start = state.segments.findLastIndex((seg) => seg[0] && seg[0].timestamp <= since);
        events = state.segments.slice(Math.max(0, start)).flat();
      }
      let json = JSON.stringify(events);
      let dropped = false;
      while (json.length > MAX_BYTES && state.segments.length > 1) {
        state.segments.shift();
        events = state.segments.flat();
        json = JSON.stringify(events);
        dropped = true;
      }
      reply({ json, count: events.length, dropped, start: events[0]?.timestamp ?? Date.now(), end: events.at(-1)?.timestamp ?? Date.now() });
    }
  });
});
