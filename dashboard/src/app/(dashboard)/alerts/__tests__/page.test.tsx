import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Alert } from "@/lib/types";

// ─── Mocks ──────────────────────────────────────────────────────────

jest.mock("@/lib/api", () => ({
  getAlerts: jest.fn(),
  markAlertRead: jest.fn(),
  markAllAlertsRead: jest.fn(),
}));

import { getAlerts, markAlertRead, markAllAlertsRead } from "@/lib/api";
import AlertsPage from "../page";

const mockGetAlerts = getAlerts as jest.MockedFunction<typeof getAlerts>;
const mockMarkAlertRead = markAlertRead as jest.MockedFunction<
  typeof markAlertRead
>;
const mockMarkAllAlertsRead = markAllAlertsRead as jest.MockedFunction<
  typeof markAllAlertsRead
>;

// ─── Fixtures ───────────────────────────────────────────────────────

const criticalUnread: Alert = {
  id: "alert-1",
  project_id: "proj-1",
  team_id: "team-1",
  alert_type: "budget_exceeded",
  severity: "critical",
  title: "Budget exceeded on Production",
  message: "Project Production has exceeded its monthly budget.",
  is_read: false,
  budget_cents: 10000,
  spent_cents: 12500,
  threshold_pct: 100,
  created_at: "2025-06-15T10:30:00Z",
};

const warningUnread: Alert = {
  id: "alert-2",
  project_id: "proj-2",
  team_id: "team-1",
  alert_type: "budget_warning",
  severity: "warning",
  title: "Budget warning on Staging",
  message: "Project Staging has reached 80% of its budget.",
  is_read: false,
  budget_cents: 5000,
  spent_cents: 4000,
  threshold_pct: 80,
  created_at: "2025-06-14T08:00:00Z",
};

const infoRead: Alert = {
  id: "alert-3",
  project_id: null,
  team_id: "team-1",
  alert_type: "system_notice",
  severity: "info",
  title: "System maintenance scheduled",
  message: "Scheduled maintenance window on Sunday 2am-4am UTC.",
  is_read: true,
  budget_cents: null,
  spent_cents: null,
  threshold_pct: null,
  created_at: "2025-06-13T16:00:00Z",
};

const criticalRead: Alert = {
  id: "alert-4",
  project_id: "proj-1",
  team_id: "team-1",
  alert_type: "budget_exceeded",
  severity: "critical",
  title: "Budget exceeded on API-v2",
  message: "Project API-v2 has exceeded its monthly budget.",
  is_read: true,
  budget_cents: 20000,
  spent_cents: 21000,
  threshold_pct: 100,
  created_at: "2025-06-12T12:00:00Z",
};

const allAlerts: Alert[] = [criticalUnread, warningUnread, infoRead, criticalRead];

// ─── Helpers ────────────────────────────────────────────────────────

/** Render the page and wait for loading to finish */
async function renderAndWait() {
  render(<AlertsPage />);
  await waitFor(() => {
    expect(screen.queryByText("Alerts")).toBeInTheDocument();
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("AlertsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAlerts.mockResolvedValue(allAlerts);
    mockMarkAlertRead.mockResolvedValue({ ok: true });
    mockMarkAllAlertsRead.mockResolvedValue({ marked_read: 2 });
  });

  // ─── 1. Loading state ──────────────────────────────────────────

  it("shows a loading spinner initially", () => {
    // Use a never-resolving promise to keep loading state
    mockGetAlerts.mockReturnValue(new Promise(() => {}));

    const { container } = render(<AlertsPage />);

    // The spinner has animate-spin class
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();

    // Should not show the header yet
    expect(screen.queryByText("Alerts")).not.toBeInTheDocument();
  });

  // ─── 2. Renders alerts after loading ───────────────────────────

  it("renders the header and stats cards after loading", async () => {
    await renderAndWait();

    // Header
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(
      screen.getByText("Budget warnings and system notifications.")
    ).toBeInTheDocument();

    // Stats card labels
    expect(screen.getByText("Total Alerts")).toBeInTheDocument();
    expect(screen.getByText("Unread")).toBeInTheDocument();
    // "Critical" appears as both a stats card title and severity badges
    expect(screen.getAllByText("Critical").length).toBeGreaterThanOrEqual(1);
  });

  // ─── 3. Empty state ───────────────────────────────────────────

  it('shows "No alerts" empty state when API returns []', async () => {
    mockGetAlerts.mockResolvedValue([]);

    await renderAndWait();

    expect(screen.getByText("No alerts")).toBeInTheDocument();
    expect(
      screen.getByText("No alerts have been generated yet.")
    ).toBeInTheDocument();
  });

  it('shows "All alerts have been read." in empty state when filtering unread', async () => {
    // First render with alerts, then toggle unread filter
    mockGetAlerts.mockResolvedValueOnce(allAlerts);
    // Second call (after filter toggle) returns empty
    mockGetAlerts.mockResolvedValueOnce([]);

    render(<AlertsPage />);
    await waitFor(() => {
      expect(screen.getByText("Alerts")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText("Show all"));

    await waitFor(() => {
      expect(screen.getByText("All alerts have been read.")).toBeInTheDocument();
    });
  });

  // ─── 4. Alert card content ────────────────────────────────────

  it("shows title, message, and severity badge for each alert", async () => {
    await renderAndWait();

    // Titles
    expect(
      screen.getByText("Budget exceeded on Production")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Budget warning on Staging")
    ).toBeInTheDocument();
    expect(
      screen.getByText("System maintenance scheduled")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Budget exceeded on API-v2")
    ).toBeInTheDocument();

    // Messages
    expect(
      screen.getByText(
        "Project Production has exceeded its monthly budget."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Scheduled maintenance window on Sunday 2am-4am UTC."
      )
    ).toBeInTheDocument();

    // Severity badges
    expect(screen.getAllByText("Critical")).toHaveLength(
      // 2 critical alerts + 1 stats card label = the badge text appears twice
      // But the stats card title is "Critical" too, so let's just check for the badge
      3 // 2 badges + 1 card title
    );
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("shows alert_type badge with underscores replaced by spaces", async () => {
    await renderAndWait();

    expect(screen.getAllByText("budget exceeded")).toHaveLength(2);
    expect(screen.getByText("budget warning")).toBeInTheDocument();
    expect(screen.getByText("system notice")).toBeInTheDocument();
  });

  it("shows spend/budget info when both values are present", async () => {
    await renderAndWait();

    // criticalUnread: spent_cents=12500, budget_cents=10000
    expect(screen.getByText(/\$125\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
  });

  // ─── 5. "Mark read" button for unread alerts ──────────────────

  it('shows "Mark read" button for unread alerts', async () => {
    await renderAndWait();

    const markReadButtons = screen.getAllByRole("button", {
      name: "Mark read",
    });

    // 2 unread alerts: criticalUnread and warningUnread
    expect(markReadButtons).toHaveLength(2);
  });

  // ─── 6. No "Mark read" button for already-read alerts ─────────

  it('does NOT show "Mark read" button for already-read alerts', async () => {
    // Render only read alerts
    mockGetAlerts.mockResolvedValue([infoRead, criticalRead]);

    await renderAndWait();

    const markReadButtons = screen.queryAllByRole("button", {
      name: "Mark read",
    });
    expect(markReadButtons).toHaveLength(0);
  });

  // ─── 7. Mark individual alert as read ─────────────────────────

  it("calls markAlertRead and updates UI when clicking Mark read", async () => {
    mockGetAlerts.mockResolvedValue([criticalUnread]);

    render(<AlertsPage />);
    await waitFor(() => {
      expect(screen.getByText("Alerts")).toBeInTheDocument();
    });

    const user = userEvent.setup();

    // Verify the Mark read button is present
    const markReadBtn = screen.getByRole("button", { name: "Mark read" });
    expect(markReadBtn).toBeInTheDocument();

    await user.click(markReadBtn);

    // API was called with the correct alert id
    expect(mockMarkAlertRead).toHaveBeenCalledWith("alert-1");
    expect(mockMarkAlertRead).toHaveBeenCalledTimes(1);

    // After marking read, the button should disappear
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Mark read" })
      ).not.toBeInTheDocument();
    });
  });

  // ─── 8. Mark all read ─────────────────────────────────────────

  it('"Mark all read" button is visible when unread alerts exist', async () => {
    await renderAndWait();

    expect(
      screen.getByRole("button", { name: /Mark all read/ })
    ).toBeInTheDocument();
  });

  it('"Mark all read" button is NOT visible when all alerts are read', async () => {
    mockGetAlerts.mockResolvedValue([infoRead, criticalRead]);

    await renderAndWait();

    expect(
      screen.queryByRole("button", { name: /Mark all read/ })
    ).not.toBeInTheDocument();
  });

  it("calls markAllAlertsRead and updates all alerts when clicking Mark all read", async () => {
    render(<AlertsPage />);
    await waitFor(() => {
      expect(screen.getByText("Alerts")).toBeInTheDocument();
    });

    const user = userEvent.setup();

    // Before: 2 individual "Mark read" buttons
    expect(
      screen.getAllByRole("button", { name: "Mark read" })
    ).toHaveLength(2);

    // Click "Mark all read"
    await user.click(
      screen.getByRole("button", { name: /Mark all read/ })
    );

    expect(mockMarkAllAlertsRead).toHaveBeenCalledTimes(1);

    // After: no individual "Mark read" buttons left
    await waitFor(() => {
      expect(
        screen.queryAllByRole("button", { name: "Mark read" })
      ).toHaveLength(0);
    });

    // "Mark all read" button should also disappear (unreadCount = 0)
    expect(
      screen.queryByRole("button", { name: /Mark all read/ })
    ).not.toBeInTheDocument();
  });

  // ─── 9. Stats cards show correct counts ───────────────────────

  it("stats cards show correct total, unread, and critical counts", async () => {
    await renderAndWait();

    // Total Alerts = 4
    // Unread = 2 (criticalUnread + warningUnread)
    // Critical = 2 (criticalUnread + criticalRead)
    //
    // We look for the bold number text inside each stats card.
    // The stats grid is md:grid-cols-3.
    const statsGrid = screen.getByText("Total Alerts").closest(".grid")!;
    const statsCards = statsGrid.querySelectorAll("[class*='rounded-xl']");
    expect(statsCards).toHaveLength(3);

    // Card 0: Total Alerts = 4
    expect(within(statsCards[0] as HTMLElement).getByText("Total Alerts")).toBeInTheDocument();
    expect(within(statsCards[0] as HTMLElement).getByText("4")).toBeInTheDocument();

    // Card 1: Unread = 2
    expect(within(statsCards[1] as HTMLElement).getByText("Unread")).toBeInTheDocument();
    expect(within(statsCards[1] as HTMLElement).getByText("2")).toBeInTheDocument();

    // Card 2: Critical = 2
    expect(within(statsCards[2] as HTMLElement).getByText("Critical")).toBeInTheDocument();
    expect(within(statsCards[2] as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("stats update after marking all alerts read", async () => {
    render(<AlertsPage />);
    await waitFor(() => {
      expect(screen.getByText("Alerts")).toBeInTheDocument();
    });

    const user = userEvent.setup();

    // Before: Unread count is 2
    const unreadCardBefore = screen.getByText("Unread").closest("[class*='card']")!;
    expect(
      within(unreadCardBefore as HTMLElement).getByText("2")
    ).toBeInTheDocument();

    // Click "Mark all read"
    await user.click(
      screen.getByRole("button", { name: /Mark all read/ })
    );

    // After: Unread count is 0
    await waitFor(() => {
      const unreadCardAfter = screen.getByText("Unread").closest("[class*='card']")!;
      expect(
        within(unreadCardAfter as HTMLElement).getByText("0")
      ).toBeInTheDocument();
    });
  });

  // ─── 10. Filter toggle ────────────────────────────────────────

  it("filter button toggles unreadOnly and refetches alerts", async () => {
    const user = userEvent.setup();

    render(<AlertsPage />);
    await waitFor(() => {
      expect(screen.getByText("Alerts")).toBeInTheDocument();
    });

    // Initial call: getAlerts(100, false)
    expect(mockGetAlerts).toHaveBeenCalledWith(100, false);
    expect(mockGetAlerts).toHaveBeenCalledTimes(1);

    // Click the filter button to toggle to unread only
    const filterButton = screen.getByRole("button", { name: /Show all/ });
    expect(filterButton).toBeInTheDocument();

    // Prepare the second call
    mockGetAlerts.mockResolvedValueOnce([criticalUnread, warningUnread]);

    await user.click(filterButton);

    // Should refetch with unreadOnly = true
    await waitFor(() => {
      expect(mockGetAlerts).toHaveBeenCalledWith(100, true);
    });

    // Button text should change to "Showing unread"
    expect(
      screen.getByRole("button", { name: /Showing unread/ })
    ).toBeInTheDocument();
  });

  it("filter button toggles back to show all", async () => {
    const user = userEvent.setup();

    render(<AlertsPage />);
    await waitFor(() => {
      expect(screen.getByText("Alerts")).toBeInTheDocument();
    });

    // Toggle ON (unread only)
    mockGetAlerts.mockResolvedValueOnce([criticalUnread, warningUnread]);
    await user.click(screen.getByRole("button", { name: /Show all/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Showing unread/ })
      ).toBeInTheDocument();
    });

    // Toggle OFF (show all)
    mockGetAlerts.mockResolvedValueOnce(allAlerts);
    await user.click(
      screen.getByRole("button", { name: /Showing unread/ })
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Show all/ })
      ).toBeInTheDocument();
    });

    // Third call should be with unreadOnly = false again
    expect(mockGetAlerts).toHaveBeenLastCalledWith(100, false);
  });

  // ─── Edge cases ───────────────────────────────────────────────

  it("handles getAlerts API error gracefully (does not crash)", async () => {
    mockGetAlerts.mockRejectedValue(new Error("Network error"));

    render(<AlertsPage />);

    // Should finish loading and show empty state
    await waitFor(() => {
      expect(screen.getByText("Alerts")).toBeInTheDocument();
    });

    // Since the catch swallows the error, alerts stays as [],
    // and the empty state is shown
    expect(screen.getByText("No alerts")).toBeInTheDocument();
  });

  it("renders only one Mark read button per unread alert", async () => {
    // Mix of read and unread
    mockGetAlerts.mockResolvedValue([
      criticalUnread,
      infoRead,
      warningUnread,
      criticalRead,
    ]);

    await renderAndWait();

    const markReadButtons = screen.getAllByRole("button", {
      name: "Mark read",
    });
    expect(markReadButtons).toHaveLength(2);
  });

  it("calls getAlerts with correct default parameters on mount", async () => {
    render(<AlertsPage />);
    await waitFor(() => {
      expect(screen.getByText("Alerts")).toBeInTheDocument();
    });

    expect(mockGetAlerts).toHaveBeenCalledWith(100, false);
  });
});
