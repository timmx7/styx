import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Cinzel, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cinzel",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
};

export const metadata: Metadata = {
  title: "Styx — The MCP-Native AI Gateway",
  description:
    "Connect any AI tool to every model provider through the Model Context Protocol. One MCP server, every model, zero code changes.",
  manifest: "/manifest.json",
  keywords: [
    "MCP",
    "Model Context Protocol",
    "AI gateway",
    "OpenAI",
    "Anthropic",
    "Claude",
    "GPT-4",
    "Gemini",
    "Mistral",
    "API gateway",
    "LLM routing",
    "AI proxy",
    "MCP server",
  ],
  openGraph: {
    title: "Styx — The MCP-Native AI Gateway",
    description:
      "Connect any AI tool to every model provider through MCP. One server, every model, zero code changes.",
    url: "https://styx.sh",
    siteName: "Styx",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Styx — The MCP-Native AI Gateway",
    description:
      "Connect any AI tool to every model provider through MCP. One server, every model, zero code changes.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Styx",
  },
  robots: {
    index: true,
    follow: true,
  },
};

function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Styx",
  description:
    "MCP-native AI gateway. Connect any AI tool to every model provider through the Model Context Protocol.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Cross-platform",
  url: "https://styx.sh",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free tier: 10,000 requests/month",
  },
  featureList: [
    "Model Context Protocol (MCP) native support",
    "OpenAI, Anthropic, Google, Mistral — one API key",
    "Semantic caching — up to 80% cost reduction",
    "Automatic failover across providers",
    "Real-time analytics and cost tracking",
    "BYOK (Bring Your Own Keys) mode",
    "OpenAI SDK compatible REST API",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <Script id="styx-theme-antiflash" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("styx-theme");if(t!=="dark"&&t!=="light")t="dark";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`}
        </Script>
        <Script id="json-ld" type="application/ld+json">
          {safeJsonLd(jsonLd)}
        </Script>
      </head>
      <body
        className={`${cinzel.variable} ${inter.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
