// The seeded bugs in the bench fixture (bench/app), how a user would hit each one, and how to check the
// agent really saw it. `test` names the fixture test that fails while the bug is there.
import type { Page } from "playwright-core";

export type BenchBug = {
  id: string;
  /** What the user would type as the report's note. */
  title: string;
  start: string;
  /** The user's actions while recording; a frame is taken after each. */
  record: ((page: Page) => Promise<unknown>)[];
  /** The analysis should name this in suspectedCause/evidence (or layout, for responsive bugs). */
  cause: RegExp;
  /** A planted security problem the analysis should flag. */
  security?: RegExp;
  /** After the agent finishes: is the bug visible on its page right now? */
  check: (page: Page) => Promise<boolean>;
  /** Fixture test (node --test name pattern) that passes once the bug is fixed. */
  test?: string;
  /** A layout bug: captured as a responsive scan, verified by measuring the page after the fix. */
  responsive?: { widths: number[]; fixed: (overflowX: number) => boolean };
  /** A claim that isn't a bug: the agent should finish with reproduced=false. */
  control?: { steps: string[]; expected: string; actual: string };
};

const text = (page: Page) => page.locator("body").innerText();

export const BUGS: BenchBug[] = [
  {
    id: "coupon-nan",
    title: "Coupon makes the total NaN",
    start: "/checkout",
    record: [(p) => p.click("#coupon"), (p) => p.fill("#coupon", "SAVE10"), (p) => p.click("#apply")],
    cause: /percent_off|\brate\b/i,
    security: /token|secret|key|query|url/i,
    check: async (p) => /NaN/.test(await p.locator("#total").innerText()),
    test: "10% coupon",
  },
  {
    id: "profile-silent-500",
    title: "Profile name doesn't save",
    start: "/profile",
    record: [(p) => p.fill("#name", "Priya S."), (p) => p.click("#save"), (p) => p.reload()],
    cause: /500|display_name|column|server error/i,
    check: async (p) => p.url().endsWith("/profile") && (await p.locator("#name").inputValue()) === "Priya Sharma",
    test: "saving the profile",
  },
  {
    id: "orders-dead-link",
    title: "Orders link goes nowhere",
    start: "/checkout",
    record: [(p) => p.click("text=Orders")],
    cause: /404|account\/orders|not found|route|link/i,
    check: async (p) => /Page not found/.test(await text(p)),
    test: "every link in the header",
  },
  {
    id: "email-plus-rejected",
    title: "Can't save my alert email",
    start: "/settings",
    record: [(p) => p.fill("#email", "priya+alerts@example.com"), (p) => p.click("#save")],
    cause: /\+|plus|regex|regular expression|validation|pattern/i,
    check: async (p) => /valid email/.test(await text(p)),
    test: "emails with \\+",
  },
  {
    id: "cart-plus-two",
    title: "Quantity jumps by two",
    start: "/cart",
    record: [(p) => p.click("#plus")],
    cause: /\b2\b|two|increment|double|by 2/i,
    check: async (p) => Number(await p.locator("#qty").innerText()) % 2 === 1 && Number(await p.locator("#qty").innerText()) > 1,
    test: "adds one",
  },
  {
    id: "checkout-overflow-mobile",
    title: "Checkout scrolls sideways on my phone",
    start: "/checkout",
    record: [],
    cause: /coupon|min-width|overflow|460/i,
    check: async () => false,
    responsive: { widths: [360, 390, 768, 1024, 1440], fixed: (overflowX) => overflowX === 0 },
  },
  {
    id: "control-sign-out",
    title: "Sign out button does nothing",
    start: "/checkout",
    record: [],
    cause: /.^/,
    check: async () => false,
    control: {
      steps: ['Click "Sign out" in the header'],
      expected: "You're signed out and see the sign-in page",
      actual: "Nothing happens, you stay signed in",
    },
  },
];
