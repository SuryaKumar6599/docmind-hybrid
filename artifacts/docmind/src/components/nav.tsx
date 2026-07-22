import { Link, useLocation } from "wouter";
import { FileCode2, FileText, LayoutDashboard, BrainCircuit, Moon, Sun, Settings, LogOut, User } from "lucide-react";
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-ink/10 bg-paper/95 backdrop-blur-sm sm:static sm:flex sm:w-20 sm:flex-col sm:h-screen sm:border-r sm:border-t-0 dark:bg-ink/5 dark:border-ink/20">
      
      {/* Brand (Desktop only) */}
      <div className="hidden sm:flex flex-col items-center justify-center py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BrainCircuit size={24} />
        </div>
      </div>

      {/* Nav Items */}
      <div className="flex flex-row justify-around sm:flex-col sm:justify-start sm:flex-1 sm:gap-4 sm:px-3 sm:py-6">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const active = location === to || (to !== "/" && location.startsWith(to));
          return (
            <Link
              key={to}
              href={to}
              title={label}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl p-2 sm:h-14 sm:w-14 transition-colors ${
                active 
                  ? "bg-primary/10 text-primary dark:bg-primary/20" 
                  : "text-neutral hover:bg-ink/5 hover:text-ink dark:text-body dark:hover:bg-cream/10 dark:hover:text-cream"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] sm:hidden font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
      
      {/* Footer / Profile Settings (Desktop only) */}
      <div className="hidden sm:flex flex-col items-center gap-4 pb-6 px-3">
        {mounted && (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-neutral hover:bg-ink/5 hover:text-ink dark:text-body dark:hover:bg-cream/10 dark:hover:text-cream transition-colors"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        )}
        
        <button
          className="flex h-10 w-10 items-center justify-center rounded-xl text-neutral hover:bg-ink/5 hover:text-ink dark:text-body dark:hover:bg-cream/10 dark:hover:text-cream transition-colors"
          title="Settings"
        >
          <Settings size={20} />
        </button>

        <div className="h-px w-10 bg-ink/10 dark:bg-ink/20 my-2" />

        {/* Auth Placeholder */}
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/10 text-ink dark:bg-cream/10 dark:text-cream hover:opacity-80 transition-opacity"
          title="Profile"
        >
          <User size={18} />
        </button>
      </div>
    </nav>
  );
}
