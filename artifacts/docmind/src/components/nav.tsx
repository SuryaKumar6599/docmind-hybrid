import { Link, useLocation } from "wouter";
import { Bot, FileCode2, FileText, LayoutDashboard, BrainCircuit, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { to: "/tracker", icon: LayoutDashboard, label: "Tracker" },
  { to: "/resumes", icon: FileText, label: "Resumes" },
  { to: "/convert", icon: FileCode2, label: "Convert" },
] as const;

export function Nav() {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-ink/10 bg-paper/95 backdrop-blur-sm sm:static sm:border-b sm:border-t-0 dark:bg-ink/5 dark:border-ink/20">
      <div className="mx-auto flex max-w-7xl items-center px-4 py-2 sm:px-6 sm:py-0">
        <div className="flex flex-1 justify-around sm:justify-start sm:gap-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const active = location === to || (to !== "/" && location.startsWith(to));
            return (
              <Link
                key={to}
                href={to}
                className={`flex flex-col items-center gap-0.5 rounded-md px-3 py-2 text-xs font-medium transition-colors sm:flex-row sm:gap-2 sm:my-1 sm:text-sm ${
                  active ? "bg-moss/10 text-moss" : "text-ink/60 hover:text-ink dark:text-cream/60 dark:hover:text-cream"
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </div>
        
        {mounted && (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="hidden sm:flex items-center justify-center rounded-md p-2 text-ink/60 hover:bg-ink/5 hover:text-ink dark:text-cream/60 dark:hover:bg-cream/10 dark:hover:text-cream transition-colors"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        )}
      </div>
    </nav>
  );
}
