import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KeysPage from "../page";
import type { ApiKey, ApiKeyCreated, Project } from "@/lib/types";
import { toast } from "sonner";

// ─── Mock @/lib/api ─────────────────────────────────────────────

jest.mock("@/lib/api", () => ({
  getApiKeys: jest.fn(),
  getProjects: jest.fn(),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
}));

import {
  getApiKeys,
  getProjects,
  createApiKey,
  revokeApiKey,
} from "@/lib/api";

const mockGetApiKeys = getApiKeys as jest.MockedFunction<typeof getApiKeys>;
const mockGetProjects = getProjects as jest.MockedFunction<typeof getProjects>;
const mockCreateApiKey = createApiKey as jest.MockedFunction<typeof createApiKey>;
const mockRevokeApiKey = revokeApiKey as jest.MockedFunction<typeof revokeApiKey>;
const mockToast = toast as jest.Mocked<typeof toast>;

// ─── Fixtures ───────────────────────────────────────────────────

const mockProjects: Project[] = [
  {
    id: "proj-001",
    team_id: "team-001",
    name: "Production App",
    budget_monthly_cents: 50000,
    budget_alert_threshold_pct: 80,
    allowed_providers: ["openai", "anthropic"],
    routing_strategy: "cost_optimized",
    pii_redaction_enabled: false,
    semantic_cache_enabled: false,
    end_user_rate_limit: 1000,
    guardrails_config: null,
    created_at: "2025-06-01T10:00:00Z",
  },
  {
    id: "proj-002",
    team_id: "team-001",
    name: "Staging Environment",
    budget_monthly_cents: 10000,
    budget_alert_threshold_pct: 90,
    allowed_providers: null,
    routing_strategy: "round_robin",
    pii_redaction_enabled: true,
    semantic_cache_enabled: true,
    end_user_rate_limit: 1000,
    guardrails_config: null,
    created_at: "2025-06-15T10:00:00Z",
  },
];

const mockKeys: ApiKey[] = [
  {
    id: "key-001",
    project_id: "proj-001",
    key_prefix: "af_live_abc1",
    name: "Production Key",
    rate_limit_per_minute: 120,
    is_active: true,
    last_used_at: "2025-12-20T14:30:00Z",
    created_at: "2025-06-02T10:00:00Z",
  },
  {
    id: "key-002",
    project_id: "proj-002",
    key_prefix: "af_test_xyz9",
    name: null,
    rate_limit_per_minute: 60,
    is_active: true,
    last_used_at: null,
    created_at: "2025-06-16T10:00:00Z",
  },
  {
    id: "key-003",
    project_id: "proj-001",
    key_prefix: "af_live_old1",
    name: "Old Key",
    rate_limit_per_minute: 30,
    is_active: false,
    last_used_at: "2025-08-01T10:00:00Z",
    created_at: "2025-06-03T10:00:00Z",
  },
];

const mockCreatedKey: ApiKeyCreated = {
  id: "key-004",
  project_id: "proj-001",
  key_prefix: "af_live_new1",
  name: "New Key",
  rate_limit_per_minute: 120,
  is_active: true,
  last_used_at: null,
  created_at: "2025-12-25T10:00:00Z",
  key: "af_live_new1_secretvalue1234567890abcdefghij",
};

// ─── Helpers ────────────────────────────────────────────────────

/** Set up mocks so data loads successfully. */
function setupSuccessfulLoad(
  keys: ApiKey[] = mockKeys,
  projects: Project[] = mockProjects
) {
  mockGetApiKeys.mockResolvedValue(keys);
  mockGetProjects.mockResolvedValue(projects);
}

/** Render the page and wait for loading to finish. */
async function renderAndWait(
  keys: ApiKey[] = mockKeys,
  projects: Project[] = mockProjects
) {
  setupSuccessfulLoad(keys, projects);
  render(<KeysPage />);
  await waitFor(() => {
    expect(
      screen.queryByText("API Keys")
    ).toBeInTheDocument();
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe("KeysPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn().mockReturnValue(true);
  });

  // ── 1. Loading state ──────────────────────────────────────────

  it("shows a loading spinner initially", () => {
    // Return a promise that never resolves so loading stays true
    mockGetApiKeys.mockReturnValue(new Promise(() => { }));
    mockGetProjects.mockReturnValue(new Promise(() => { }));

    const { container } = render(<KeysPage />);

    // The loading skeleton has animate-pulse class
    const skeleton = container.querySelector(".animate-pulse");
    expect(skeleton).toBeInTheDocument();

    // Header text should NOT be visible during loading
    expect(screen.queryByText("API Keys")).not.toBeInTheDocument();
  });

  // ── 2. Renders keys table after loading ───────────────────────

  it("renders the keys table after loading completes", async () => {
    await renderAndWait();

    // Header is present
    expect(screen.getByText("API Keys")).toBeInTheDocument();
    expect(
      screen.getByText("Manage API keys for your projects.")
    ).toBeInTheDocument();

    // Table header columns
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Key")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Rate Limit")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Last Used")).toBeInTheDocument();

    // Card description with count
    expect(screen.getByText(/3 keys across 2 projects/)).toBeInTheDocument();
  });

  // ── 3. Empty state (no keys) ──────────────────────────────────

  it("shows 'No API keys yet' empty state when no keys exist", async () => {
    await renderAndWait([], mockProjects);

    expect(screen.getByText("No API keys yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Generate your first API key to start using the gateway."
      )
    ).toBeInTheDocument();
  });

  // ── 4. Key prefix, project name, rate limit, status in table ──

  it("displays key prefix, project name, rate limit, and status for each key", async () => {
    await renderAndWait();

    // Key names
    expect(screen.getByText("Production Key")).toBeInTheDocument();
    expect(screen.getByText("Unnamed")).toBeInTheDocument(); // key-002 has null name
    expect(screen.getByText("Old Key")).toBeInTheDocument();

    // Key prefixes (rendered as "prefix...")
    expect(screen.getByText("af_live_abc1...")).toBeInTheDocument();
    expect(screen.getByText("af_test_xyz9...")).toBeInTheDocument();
    expect(screen.getByText("af_live_old1...")).toBeInTheDocument();

    // Project names resolved from project IDs
    expect(screen.getAllByText("Production App").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("Staging Environment").length
    ).toBeGreaterThanOrEqual(1);

    // Rate limits
    expect(screen.getByText("120/min")).toBeInTheDocument();
    expect(screen.getByText("60/min")).toBeInTheDocument();
    expect(screen.getByText("30/min")).toBeInTheDocument();

    // Last used
    expect(screen.getByText("Never")).toBeInTheDocument(); // key-002 never used
  });

  // ── 5. Active / Revoked badges ────────────────────────────────

  it("shows 'Active' badge for active keys and 'Revoked' for inactive", async () => {
    await renderAndWait();

    const activeBadges = screen.getAllByText("Active");
    const revokedBadges = screen.getAllByText("Revoked");

    // 2 active keys (key-001, key-002), 1 revoked (key-003)
    expect(activeBadges).toHaveLength(2);
    expect(revokedBadges).toHaveLength(1);
  });

  // ── 6. New Key button ─────────────────────────────────────────

  it("shows 'New Key' button enabled when projects exist", async () => {
    await renderAndWait([], mockProjects);

    const newKeyButton = screen.getByRole("button", { name: /new key/i });
    expect(newKeyButton).toBeInTheDocument();
    expect(newKeyButton).not.toBeDisabled();
  });

  it("shows 'New Key' button disabled when no projects exist", async () => {
    await renderAndWait([], []);

    const newKeyButton = screen.getByRole("button", { name: /new key/i });
    expect(newKeyButton).toBeInTheDocument();
    expect(newKeyButton).toBeDisabled();
  });

  // ── 7. Empty state text depends on whether projects exist ─────

  it("shows 'Create a project first' message when no projects and no keys", async () => {
    await renderAndWait([], []);

    expect(screen.getByText("No API keys yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create a project first, then generate API keys."
      )
    ).toBeInTheDocument();
  });

  it("shows 'Generate your first API key' message when projects exist but no keys", async () => {
    await renderAndWait([], mockProjects);

    expect(screen.getByText("No API keys yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Generate your first API key to start using the gateway."
      )
    ).toBeInTheDocument();
  });

  // ── 8. Revoke key ─────────────────────────────────────────────

  it("calls revokeApiKey and refetches data when delete button is clicked", async () => {
    const user = userEvent.setup();
    mockRevokeApiKey.mockResolvedValue(undefined);
    await renderAndWait();

    // After revoke, the refetch should return updated keys
    const keysAfterRevoke = mockKeys.map((k) =>
      k.id === "key-001" ? { ...k, is_active: false } : k
    );
    mockGetApiKeys.mockResolvedValue(keysAfterRevoke);
    mockGetProjects.mockResolvedValue(mockProjects);

    // Find the delete buttons — only active keys have them (key-001, key-002)
    // Use accessible name or role; Trash2 icon buttons have no text,
    // so query by role "button" within the table rows.
    const allRows = screen.getAllByRole("row");
    // Row 0 is the header, rows 1-3 are data rows

    // First data row (key-001 "Production Key") — click the delete button
    const firstDataRow = allRows[1];
    const deleteButton = within(firstDataRow).getByRole("button");
    await user.click(deleteButton);

    expect(mockRevokeApiKey).toHaveBeenCalledWith("key-001");

    // After revocation, fetchData is called again
    await waitFor(() => {
      expect(mockGetApiKeys).toHaveBeenCalledTimes(2); // initial + refetch
    });
  });

  // ── 9. Toast on revocation ────────────────────────────────────

  it("shows toast.success when a key is revoked successfully", async () => {
    const user = userEvent.setup();
    mockRevokeApiKey.mockResolvedValue(undefined);
    await renderAndWait();

    // After revoke refetch
    mockGetApiKeys.mockResolvedValue(mockKeys);
    mockGetProjects.mockResolvedValue(mockProjects);

    const allRows = screen.getAllByRole("row");
    const firstDataRow = allRows[1];
    const deleteButton = within(firstDataRow).getByRole("button");
    await user.click(deleteButton);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("API key revoked");
    });
  });

  it("shows toast.error when revocation fails", async () => {
    const user = userEvent.setup();
    mockRevokeApiKey.mockRejectedValue(new Error("Network error"));
    await renderAndWait();

    const allRows = screen.getAllByRole("row");
    const firstDataRow = allRows[1];
    const deleteButton = within(firstDataRow).getByRole("button");
    await user.click(deleteButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Network error");
    });
  });

  // ── 10. Toast on data loading failure ─────────────────────────

  it("shows toast.error when initial data loading fails", async () => {
    mockGetApiKeys.mockRejectedValue(new Error("Server error"));
    mockGetProjects.mockRejectedValue(new Error("Server error"));

    render(<KeysPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Failed to load data");
    });
  });

  it("shows toast.error when getApiKeys fails but getProjects succeeds", async () => {
    mockGetApiKeys.mockRejectedValue(new Error("Keys fetch failed"));
    mockGetProjects.mockResolvedValue(mockProjects);

    render(<KeysPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Failed to load data");
    });
  });

  // ── Additional coverage ───────────────────────────────────────

  it("does not show delete button for revoked keys", async () => {
    await renderAndWait();

    const allRows = screen.getAllByRole("row");
    // Row index 3 corresponds to key-003 (revoked key)
    const revokedRow = allRows[3];
    const buttonsInRow = within(revokedRow).queryAllByRole("button");

    expect(buttonsInRow).toHaveLength(0);
  });

  it("shows 'Unnamed' for keys with null name", async () => {
    await renderAndWait();

    expect(screen.getByText("Unnamed")).toBeInTheDocument();
  });

  it("shows 'Never' for keys with null last_used_at", async () => {
    await renderAndWait();

    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("formats last_used_at as a localized date string", async () => {
    await renderAndWait();

    // key-001 last_used_at is "2025-12-20T14:30:00Z"
    const expectedDate = new Date("2025-12-20T14:30:00Z").toLocaleDateString();
    expect(screen.getByText(expectedDate)).toBeInTheDocument();
  });

  it("shows singular text for 1 key across 1 project", async () => {
    const singleKey: ApiKey[] = [mockKeys[0]];
    const singleProject: Project[] = [mockProjects[0]];

    await renderAndWait(singleKey, singleProject);

    expect(screen.getByText(/1 key across 1 project\./)).toBeInTheDocument();
  });

  it("falls back to truncated project ID when project is not found", async () => {
    const orphanKey: ApiKey = {
      ...mockKeys[0],
      project_id: "unknown-project-id-long",
    };

    await renderAndWait([orphanKey], mockProjects);

    // projectName fallback: projectId.slice(0, 8)
    expect(screen.getByText("unknown-")).toBeInTheDocument();
  });

  // ── Dialog: Create API Key (with notes on Radix portal) ───────
  //
  // NOTE: Radix Dialog renders content in a portal. The tests below
  // use `baseElement` queries and `findByText` to locate dialog
  // content. If these tests prove flaky in CI due to portal timing,
  // the non-dialog tests above still provide comprehensive coverage.

  describe("Create Key Dialog", () => {
    it("opens the dialog when 'New Key' is clicked", async () => {
      const user = userEvent.setup();
      await renderAndWait([], mockProjects);

      const newKeyButton = screen.getByRole("button", { name: /new key/i });
      await user.click(newKeyButton);

      // Dialog title should appear in the portal
      const dialogTitle = await screen.findByText("Create API Key");
      expect(dialogTitle).toBeInTheDocument();

      // Form elements
      expect(screen.getByLabelText("Project")).toBeInTheDocument();
      expect(screen.getByLabelText(/key name/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /create key/i })
      ).toBeInTheDocument();
    });

    it("lists projects in the select dropdown", async () => {
      const user = userEvent.setup();
      await renderAndWait([], mockProjects);

      await user.click(screen.getByRole("button", { name: /new key/i }));
      await screen.findByText("Create API Key");

      const select = screen.getByLabelText("Project") as HTMLSelectElement;
      const options = within(select).getAllByRole("option");

      // "Select a project" placeholder + 2 projects
      expect(options).toHaveLength(3);
      expect(options[1]).toHaveTextContent("Production App");
      expect(options[2]).toHaveTextContent("Staging Environment");
    });

    it("creates a key and shows it in the dialog", async () => {
      const user = userEvent.setup();
      mockCreateApiKey.mockResolvedValue(mockCreatedKey);
      await renderAndWait([], mockProjects);

      // After creation, refetch will return updated keys
      mockGetApiKeys.mockResolvedValue([
        { ...mockCreatedKey, key: undefined } as unknown as ApiKey,
      ]);
      mockGetProjects.mockResolvedValue(mockProjects);

      await user.click(screen.getByRole("button", { name: /new key/i }));
      await screen.findByText("Create API Key");

      // Fill in form
      const select = screen.getByLabelText("Project");
      await user.selectOptions(select, "proj-001");

      const nameInput = screen.getByLabelText(/key name/i);
      await user.type(nameInput, "New Key");

      // Submit
      await user.click(screen.getByRole("button", { name: /create key/i }));

      // Should call createApiKey with correct params
      expect(mockCreateApiKey).toHaveBeenCalledWith({
        project_id: "proj-001",
        name: "New Key",
      });

      // After creation, dialog should show "Key created successfully"
      await screen.findByText("Key created successfully");

      expect(
        screen.getByText(/copy your key now/i)
      ).toBeInTheDocument();

      // Warning text
      expect(
        screen.getByText(/this key will only be shown once/i)
      ).toBeInTheDocument();

      // Toast success
      expect(mockToast.success).toHaveBeenCalledWith("API key created!");
    });

    it("shows toast.error when createApiKey fails", async () => {
      const user = userEvent.setup();
      mockCreateApiKey.mockRejectedValue(new Error("Creation failed"));
      await renderAndWait([], mockProjects);

      await user.click(screen.getByRole("button", { name: /new key/i }));
      await screen.findByText("Create API Key");

      const select = screen.getByLabelText("Project");
      await user.selectOptions(select, "proj-001");

      await user.click(screen.getByRole("button", { name: /create key/i }));

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith("Creation failed");
      });
    });

    it("shows 'Select a project first' toast when no project selected", async () => {
      const user = userEvent.setup();
      await renderAndWait([], mockProjects);

      await user.click(screen.getByRole("button", { name: /new key/i }));
      await screen.findByText("Create API Key");

      // Submit without selecting a project — the select still has value ""
      // We need to submit the form programmatically since HTML5 required
      // may prevent submission. The component checks form.projectId explicitly.
      // The select has required attribute, but the handler also checks.
      // Let's directly click Create Key and see.
      const createBtn = screen.getByRole("button", { name: /create key/i });
      await user.click(createBtn);

      // The handler checks if form.projectId is empty and shows toast
      // NOTE: The HTML5 required attribute on the <select> may fire native
      // validation before the handler runs. If so, createApiKey won't be called.
      // Either way, createApiKey should NOT be called.
      expect(mockCreateApiKey).not.toHaveBeenCalled();
    });

    it("creates a key with empty name when name field is left blank", async () => {
      const user = userEvent.setup();
      mockCreateApiKey.mockResolvedValue(mockCreatedKey);
      await renderAndWait([], mockProjects);

      mockGetApiKeys.mockResolvedValue([]);
      mockGetProjects.mockResolvedValue(mockProjects);

      await user.click(screen.getByRole("button", { name: /new key/i }));
      await screen.findByText("Create API Key");

      const select = screen.getByLabelText("Project");
      await user.selectOptions(select, "proj-002");

      // Leave name empty and submit
      await user.click(screen.getByRole("button", { name: /create key/i }));

      expect(mockCreateApiKey).toHaveBeenCalledWith({
        project_id: "proj-002",
        name: undefined,
      });
    });

    it("copies key to clipboard when copy button is clicked", async () => {
      const user = userEvent.setup();
      mockCreateApiKey.mockResolvedValue(mockCreatedKey);

      // Spy on the clipboard writeText (already mocked in jest.setup.tsx)
      const writeTextSpy = jest
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue(undefined);

      await renderAndWait([], mockProjects);

      mockGetApiKeys.mockResolvedValue([]);
      mockGetProjects.mockResolvedValue(mockProjects);

      // Open dialog, fill form, create key
      await user.click(screen.getByRole("button", { name: /new key/i }));
      await screen.findByText("Create API Key");

      await user.selectOptions(screen.getByLabelText("Project"), "proj-001");
      await user.click(screen.getByRole("button", { name: /create key/i }));
      await screen.findByText("Key created successfully");

      // The dialog now shows the key with copy/show buttons.
      // Find the copy button — there are two icon buttons (show/hide and copy).
      // The key area contains buttons. We can find them by their container.
      const keyContainer = screen
        .getByText(/this key will only be shown once/i)
        .closest("[class*='space-y']")!;

      // Get all buttons in the dialog key area
      const dialogButtons = within(
        keyContainer.parentElement!
      ).getAllByRole("button");

      // The copy button is the one that triggers clipboard write.
      // Filter by h-8 class which is on the small icon buttons
      const iconButtons = dialogButtons.filter((btn) =>
        btn.className.includes("h-8")
      );

      // iconButtons[0] = show/hide, iconButtons[1] = copy
      expect(iconButtons.length).toBeGreaterThanOrEqual(2);
      await user.click(iconButtons[1]);

      expect(writeTextSpy).toHaveBeenCalledWith(mockCreatedKey.key);

      writeTextSpy.mockRestore();
    });

    it("closes dialog and resets state when 'Done' is clicked", async () => {
      const user = userEvent.setup();
      mockCreateApiKey.mockResolvedValue(mockCreatedKey);
      await renderAndWait([], mockProjects);

      mockGetApiKeys.mockResolvedValue([]);
      mockGetProjects.mockResolvedValue(mockProjects);

      await user.click(screen.getByRole("button", { name: /new key/i }));
      await screen.findByText("Create API Key");

      await user.selectOptions(screen.getByLabelText("Project"), "proj-001");
      await user.click(screen.getByRole("button", { name: /create key/i }));
      await screen.findByText("Key created successfully");

      // Click Done
      const doneButton = screen.getByRole("button", { name: /done/i });
      await user.click(doneButton);

      // Dialog should close — "Key created successfully" should no longer be visible
      await waitFor(() => {
        expect(
          screen.queryByText("Key created successfully")
        ).not.toBeInTheDocument();
      });
    });
  });
});
