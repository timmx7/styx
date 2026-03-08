import Link from 'next/link';

export default function HomePage() {
    return (
        <main className="flex min-h-screen flex-col items-center justify-center p-24 text-center">
            <h1 className="text-5xl font-bold tracking-tight mb-6">Styx Documentation</h1>
            <p className="text-xl text-neutral-400 max-w-2xl mb-12">
                The complete guide to connecting your AI tools to every model provider through MCP and REST API.
            </p>
            <div className="flex gap-4">
                <Link
                    href="/docs"
                    className="rounded-full bg-white text-black px-8 py-3 font-medium hover:bg-neutral-200 transition-colors"
                >
                    Read the Docs
                </Link>
                <Link
                    href="/docs/mcp-server"
                    className="rounded-full border border-neutral-700 px-8 py-3 font-medium hover:bg-neutral-900 transition-colors"
                >
                    MCP Server
                </Link>
            </div>
        </main>
    );
}
