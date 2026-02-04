'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation({ user }) {
    const pathname = usePathname();

    const isActive = (path) => pathname === path;

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
                        <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                            <Link
                                href="/dashboard"
                                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/dashboard')
                                    ? 'border-blue-500 text-gray-900'
                                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                    }`}
                            >
                                Dashboard
                            </Link>

                            {user?.isAdmin && (
                                <Link
                                    href="/analytics"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/analytics')
                                        ? 'border-purple-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    Analytics
                                </Link>
                            )}

                            {user?.isAdmin && (
                                <Link
                                    href="/test"
                                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${isActive('/test')
                                        ? 'border-green-500 text-gray-900'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                        }`}
                                >
                                    Test Page
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
