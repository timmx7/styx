import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { BookOpen } from 'lucide-react';

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <DocsLayout
            tree={source.pageTree}
            nav={{
                title: (
                    <div className="flex items-center gap-2 font-semibold">
                        <BookOpen className="w-5 h-5" />
                        <span>Styx Docs</span>
                    </div>
                )
            }}
        >
            {children}
        </DocsLayout>
    );
}
