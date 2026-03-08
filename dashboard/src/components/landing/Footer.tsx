"use client";

import { StyxLogo } from "./StyxLogo";

const GITHUB_URL = "https://github.com/timmx7/styx";

const columns = [
  {
    title: "Project",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Roadmap", href: `${GITHUB_URL}/issues` },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Getting Started", href: "/docs/getting-started" },
      { label: "API Reference", href: "/docs/api" },
      { label: "MCP Server", href: "/docs/mcp-server" },
      { label: "Changelog", href: `${GITHUB_URL}/releases` },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Contributing", href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` },
      { label: "Issues", href: `${GITHUB_URL}/issues` },
      { label: "Discussions", href: `${GITHUB_URL}/discussions` },
      { label: "Security", href: `${GITHUB_URL}/blob/main/SECURITY.md` },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Apache 2.0", href: `${GITHUB_URL}/blob/main/LICENSE` },
      { label: "Code of Conduct", href: `${GITHUB_URL}/blob/main/CODE_OF_CONDUCT.md` },
      { label: "Privacy", href: "/privacy" },
      { label: "styx.app ↗", href: "https://styx.app" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border pt-16 pb-12 px-6 bg-background">
      <div className="max-w-[1100px] mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8 mb-16">
          {/* Logo + tagline */}
          <div className="col-span-2">
            <div className="mb-4">
              <StyxLogo size="sm" />
            </div>
            <p className="text-sm font-body text-muted-foreground">
              Open-source AI gateway.
            </p>
            <p className="text-sm font-body mt-1 text-muted-foreground opacity-60">
              Apache 2.0 · Self-Hosted · Free Forever
            </p>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-medium mb-4 font-body text-foreground">
                {col.title}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.href.startsWith("http") ? "_blank" : undefined}
                      rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="text-sm font-body text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-8">
          <p className="text-[13px] font-body text-muted-foreground opacity-50">
            &copy; 2026 Styx. Open source under Apache 2.0.
          </p>
        </div>
      </div>
    </footer>
  );
}
