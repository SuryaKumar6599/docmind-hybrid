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
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-ink/10 bg-paper/95 backdrop-blur-sm sm:static sm:flex sm:w-60 sm:shrink-0 sm:flex-col sm:h-screen sm:border-r sm:border-t-0 dark:bg-ink/5 dark:border-ink/20">
      
      {/* Brand (Desktop only) */}
      <div className="hidden sm:flex items-center gap-3 px-6 py-8">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-moss text-white shadow-sm">
          <BrainCircuit size={18} />
        </div>
        <span className="text-lg font-bold tracking-tight text-ink">DOCMIND</span>
      </div>

      {/* Nav Items */}
      <div className="flex flex-row justify-around sm:flex-col sm:justify-start sm:flex-1 sm:gap-2 sm:px-4 sm:py-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const active = location === to || (to !== "/" && location.startsWith(to));
          return (
            <Link
              key={to}
              href={to}
              title={label}
              className={`flex flex-col sm:flex-row items-center sm:justify-start gap-1 sm:gap-3 rounded-xl p-2 sm:px-4 sm:py-3 transition-colors ${
                active 
                  ? "bg-signal/15 text-ink font-semibold dark:bg-signal/20 dark:text-cream shadow-sm" 
                  : "text-ink/60 hover:bg-ink/5 hover:text-ink dark:text-ink/60 dark:hover:bg-cream/10 dark:hover:text-cream"
              }`}
            >
              <Icon size={18} className={active ? "text-signal" : ""} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] sm:text-sm">{label}</span>
            </Link>
          );
        })}
      </div>
      
      {/* Footer / Profile Settings (Desktop only) */}
      <div className="hidden sm:flex flex-col px-4 pb-6 mt-auto space-y-4">
        
        {/* Settings Links */}
        <div className="space-y-1">
          {mounted && (
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-ink/60 hover:bg-ink/5 hover:text-ink dark:text-ink/60 dark:hover:bg-cream/10 dark:hover:text-cream transition-colors"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              <span>Theme</span>
            </button>
          )}
          
          <button
            className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-ink/60 hover:bg-ink/5 hover:text-ink dark:text-ink/60 dark:hover:bg-cream/10 dark:hover:text-cream transition-colors"
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </div>

        {/* Profile Block */}
        <div className="mt-4 flex flex-col gap-2 rounded-xl bg-ink/5 p-4 dark:bg-cream/5">
          <p className="text-xs font-medium text-ink/50 px-1 mb-1">Redesigned Profile</p>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-signal/20 text-signal overflow-hidden">
              <img src="https://ui-avatars.com/api/?name=Alexander+G&background=random" alt="Avatar" className="h-full w-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-semibold text-ink">Alexander G.</p>
            </div>
          </div>
          <button
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink/60 hover:bg-ink/10 hover:text-ink transition-colors"
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        </div>

      </div>
    </nav>
  );
}
