import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { themeInitScript } from "@/components/theme/theme";

export const metadata: Metadata = {
  title: "Humor Study",
  description: "Humor Study participant portal",
  formatDetection: {
    address: false,
    date: false,
    email: false,
    telephone: false,
    url: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
