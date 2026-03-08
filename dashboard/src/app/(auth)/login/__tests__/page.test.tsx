import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "../page";
import { toast } from "sonner";
import { mockPush } from "../../../../../jest.setup";

// ─── Mocks ──────────────────────────────────────────────────────

jest.mock("next/link", () => {
  return ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
});

const mockSignInWithPassword = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
    },
  }),
}));

jest.mock("@/lib/api", () => ({
  API_BASE: "http://localhost:8000",
}));

jest.mock("@/components/auth/LoginScene", () => {
  return () => <div data-testid="login-scene" />;
});

// ─── Helpers ────────────────────────────────────────────────────

const mockedToast = toast as jest.Mocked<typeof toast>;

function setup() {
  const user = userEvent.setup();
  render(<LoginPage />);
  return { user };
}

// ─── Tests ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe("LoginPage", () => {
  // ── Rendering ───────────────────────────────────────────────

  describe("default login view", () => {
    it("renders the login form with heading", () => {
      setup();
      expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    });

    it("shows 'Sign in' submit button", () => {
      setup();
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    });

    it("shows email and password inputs", () => {
      setup();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it("shows correct placeholders for email and password", () => {
      setup();
      expect(screen.getByPlaceholderText("you@company.com")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Enter your password")).toBeInTheDocument();
    });

    it("does not show name field in login mode", () => {
      setup();
      expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument();
    });

    it("shows link to switch to sign up", () => {
      setup();
      expect(screen.getByRole("link", { name: /create one/i })).toBeInTheDocument();
    });
  });


  // ── Login flow ──────────────────────────────────────────────

  describe("login submission", () => {
    it("calls supabase signInWithPassword and navigates to /overview", async () => {
      mockSignInWithPassword.mockResolvedValueOnce({ error: null });
      const { user } = setup();

      await user.type(screen.getByLabelText(/email/i), "user@test.com");
      await user.type(screen.getByLabelText(/password/i), "secret123");
      await user.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(mockSignInWithPassword).toHaveBeenCalledWith({
          email: "user@test.com",
          password: "secret123",
        });
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/overview");
      });
    });

    it("shows toast.success with 'Welcome back!' on successful login", async () => {
      mockSignInWithPassword.mockResolvedValueOnce({ error: null });
      const { user } = setup();

      await user.type(screen.getByLabelText(/email/i), "user@test.com");
      await user.type(screen.getByLabelText(/password/i), "secret123");
      await user.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(mockedToast.success).toHaveBeenCalledWith("Welcome back!");
      });
    });

    it("shows toast.error with error message on login failure", async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        error: { message: "Invalid credentials" },
      });
      const { user } = setup();

      await user.type(screen.getByLabelText(/email/i), "bad@test.com");
      await user.type(screen.getByLabelText(/password/i), "wrong");
      await user.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(mockedToast.error).toHaveBeenCalledWith("Invalid credentials");
      });
    });

    it("shows toast.error with 'Something went wrong' for unexpected errors", async () => {
      mockSignInWithPassword.mockRejectedValueOnce("unexpected failure");
      const { user } = setup();

      await user.type(screen.getByLabelText(/email/i), "bad@test.com");
      await user.type(screen.getByLabelText(/password/i), "wrong");
      await user.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(mockedToast.error).toHaveBeenCalledWith("Something went wrong");
      });
    });
  });


  // ── Loading state ───────────────────────────────────────────

  describe("loading state", () => {
    it("disables the submit button and shows spinner during login submission", async () => {
      let resolveLogin: (value: any) => void;
      mockSignInWithPassword.mockImplementationOnce(
        () => new Promise((resolve) => { resolveLogin = resolve; })
      );
      const { user } = setup();

      await user.type(screen.getByLabelText(/email/i), "user@test.com");
      await user.type(screen.getByLabelText(/password/i), "secret123");
      await user.click(screen.getByRole("button", { name: /sign in/i }));

      // Button should be disabled during loading
      await waitFor(() => {
        const buttons = screen.getAllByRole("button");
        const submitButton = buttons.find((b) => b.getAttribute("type") === "submit");
        expect(submitButton).toBeDisabled();
      });

      // Resolve to clean up
      resolveLogin!({ error: null });

      await waitFor(() => {
        const submitButton = screen.getByRole("button", { name: /sign in/i });
        expect(submitButton).not.toBeDisabled();
      });
    });
  });

  // ── Does not navigate on error ──────────────────────────────

  describe("error handling", () => {
    it("does not navigate to /overview when login fails", async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        error: { message: "Network error" },
      });
      const { user } = setup();

      await user.type(screen.getByLabelText(/email/i), "user@test.com");
      await user.type(screen.getByLabelText(/password/i), "secret123");
      await user.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(mockedToast.error).toHaveBeenCalledWith("Network error");
      });

      expect(mockPush).not.toHaveBeenCalled();
    });

    it("re-enables the submit button after a failed login", async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        error: { message: "Error" },
      });
      const { user } = setup();

      await user.type(screen.getByLabelText(/email/i), "user@test.com");
      await user.type(screen.getByLabelText(/password/i), "secret123");
      await user.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(mockedToast.error).toHaveBeenCalled();
      });

      const submitButton = screen.getByRole("button", { name: /sign in/i });
      expect(submitButton).not.toBeDisabled();
    });
  });
});
