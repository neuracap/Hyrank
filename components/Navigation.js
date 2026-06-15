'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

function NavDropdown({ label, items, pathname }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    const isAnyActive = items.some(i => i.href === pathname);

    useEffect(() => {
        const handleClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    return (
        <div ref={ref} className="relative inline-flex items-center">
            <button
                onClick={() => setOpen(prev => !prev)}
                className={`inline-flex items-center gap-1 px-1 pt-1 border-b-2 text-sm font-medium h-full ${isAnyActive
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
            >
                {label}
                <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                    {items.map(item => (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className={`block px-4 py-2 text-sm ${pathname === item.href
                                ? 'bg-blue-50 text-blue-700 font-semibold'
                                : 'text-gray-700 hover:bg-gray-50'
                                }`}
                        >
                            {item.label}
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function Navigation({ user }) {
    const pathname = usePathname();

    const isActive = (path) => pathname === path;

    // Build "Review Tools" dropdown items based on user role
    const reviewItems = [];
    if (user?.isAdmin) {
        reviewItems.push({ href: '/question-review', label: 'Question Review' });
        reviewItems.push({ href: '/answer-conflicts', label: 'Answer Conflicts' });
        reviewItems.push({ href: '/admin/issues', label: 'Student Reports' });
        reviewItems.push({ href: '/image-audit', label: 'Image Audit' });
        reviewItems.push({ href: '/blank-options', label: 'Blank Options' });
    }
    if (user?.isAdmin || [2, 3].includes(user?.id)) {
        reviewItems.push({ href: '/verify-unlink', label: 'Verify UnLink' });
    }
    reviewItems.push({ href: '/flagged', label: 'Flagged' });
    if (user?.isAdmin) {
        reviewItems.push({ href: '/test', label: 'Test Page' });
        reviewItems.push({ href: '/analytics', label: 'Analytics' });
    }

    return (
        <nav className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between h-16">
                    <div className="flex">
                        <div className="flex-shrink-0 flex items-center">
                            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                                Hyrank
                            </span>
                        </div>
                        <div className="hidden sm:ml-6 sm:flex sm:space-x-8 items-stretch">
                            <Link
                                href="/dashboard"
                                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/dashboard')
                                    ? 'border-blue-500 text-gray-900'
                                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                    }`}
                            >
                                Dashboard
                            </Link>

                            <Link
                                href="/test-review"
                                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/test-review')
                                    ? 'border-blue-500 text-gray-900'
                                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                    }`}
                            >
                                Test Review
                            </Link>

                            {user?.isAdmin && (
                                <Link
                                    href="/cgl-mock-builder"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/cgl-mock-builder')
                                        ? 'border-green-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    CGL Mock Builder
                                </Link>
                            )}

                            {!user?.isAdmin && (
                                <Link
                                    href="/my-reviews"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/my-reviews')
                                        ? 'border-green-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    My Reviews
                                </Link>
                            )}

                            {user?.isAdmin && (
                                <Link
                                    href="/solution-review"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/solution-review')
                                        ? 'border-indigo-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    Solution Review
                                </Link>
                            )}

                            {user?.isAdmin && (
                                <Link
                                    href="/solution-review-bilingual"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/solution-review-bilingual')
                                        ? 'border-indigo-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    Bilingual Solutions
                                </Link>
                            )}

                            {user?.isAdmin && (
                                <NavDropdown
                                    label="Image"
                                    items={[
                                        { href: '/image-solutions', label: 'Solo' },
                                        { href: '/image-solutions-bilingual', label: 'Bilingual' },
                                    ]}
                                    pathname={pathname}
                                />
                            )}

                            <NavDropdown
                                label="Review Tools"
                                items={reviewItems}
                                pathname={pathname}
                            />

                            {user?.isAdmin && (
                                <Link
                                    href="/question-entry"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/question-entry')
                                        ? 'border-teal-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    Question Entry
                                </Link>
                            )}

                            {user?.isAdmin && (
                                <NavDropdown
                                    label="Mock"
                                    items={[
                                        { href: '/mock-tests',          label: 'Mock Tests' },
                                        { href: '/cgl-mock-builder',    label: 'CGL T1 Builder' },
                                        { href: '/mock-blueprint',      label: 'Blueprint Editor' },
                                        { href: '/mock-test-builder',   label: 'General Builder' },
                                        { href: '/section-test-builder', label: 'Section Builder' },
                                    ]}
                                    pathname={pathname}
                                />
                            )}

                            {user?.isAdmin && (
                                <Link
                                    href="/social-media"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/social-media')
                                        ? 'border-cyan-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    Social Media
                                </Link>
                            )}

                            {user?.isAdmin && (
                                <Link
                                    href="/admin/daily-quiz"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/admin/daily-quiz')
                                        ? 'border-amber-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    GK Approval
                                </Link>
                            )}
                        </div>
                    </div>
                    <div className="hidden sm:ml-6 sm:flex sm:items-center">
                        <div className="text-sm text-gray-500 mr-4">
                            {user?.email || 'Guest'}
                            {user?.isAdmin && <span className="ml-2 text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">ADMIN</span>}
                        </div>
                        <button
                            onClick={async () => {
                                await fetch('/api/auth/logout', { method: 'POST' });
                                window.location.href = '/login';
                            }}
                            className="text-sm text-red-600 hover:text-red-800 font-medium"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
}
