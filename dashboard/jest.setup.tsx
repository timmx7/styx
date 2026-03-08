import "@testing-library/jest-dom";

// ─── Mock next/navigation ────────────────────────────────────────
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockPathname = "/overview";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    prefetch: jest.fn(),
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

// ─── Mock framer-motion (avoid animation issues in tests) ────────
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, transition, whileHover, whileTap, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
    span: ({ children, ...props }: any) => {
      const { initial, animate, transition, ...rest } = props;
      return <span {...rest}>{children}</span>;
    },
    button: ({ children, ...props }: any) => {
      const { initial, animate, transition, whileHover, whileTap, ...rest } = props;
      return <button {...rest}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// ─── Mock sonner (toast notifications) ───────────────────────────
jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
  Toaster: () => null,
}));

// ─── Mock ResizeObserver (used by Radix) ─────────────────────────
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ─── Mock IntersectionObserver ───────────────────────────────────
global.IntersectionObserver = class {
  constructor() {}
  observe() { return null; }
  unobserve() { return null; }
  disconnect() { return null; }
} as any;

// ─── Mock clipboard API ─────────────────────────────────────────
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
    readText: jest.fn().mockResolvedValue(""),
  },
});

// ─── Mock window.matchMedia ─────────────────────────────────────
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// ─── Export mocks for test assertions ────────────────────────────
export { mockPush, mockReplace, mockBack };
