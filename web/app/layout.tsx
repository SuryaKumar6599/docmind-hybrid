import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocMind",
  description: "Private document search powered by a local Ollama backend"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
