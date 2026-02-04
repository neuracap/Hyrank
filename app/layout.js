import { Inter } from "next/font/google";
import "./globals.css";
import Navigation from '@/components/Navigation';
import { getCurrentUser } from "@/lib/auth-edge";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
    title: "Internal MCQ Editor",
    description: "Review and edit MCQ questions and solutions.",
};

export default async function RootLayout({ children }) {
    let user = null;
    try {
        user = await getCurrentUser();
    } catch (error) {
        console.error("Failed to fetch user in RootLayout:", error);
    }

    return (
        <html lang="en">
            <body className={inter.className}>
                {user && <Navigation user={user} />}
                {children}
            </body>
        </html>
    );
}
