import { Link, useLocation } from "wouter";
import { Bot, FileText, LayoutDashboard } from "lucide-react";

const NAV_ITEMS = [
  { to: "/", icon: Bot, label: "Search" },
  { to: "/resumes", icon: FileText, label: "Resumes" },
  { to: "/tracker", icon: LayoutDashboard, label: "Tracker" },
] as const;

export function Nav() {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-ink/10 bg-paper/95 backdrop-blur-sm sm:static sm:border-b sm:border-t-0">
      <div className="mx-auto flex max-w-7xl items-center justify-around px-4 py-2 sm:justify-start sm:gap-1 sm:px-6 sm:py-0">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const active = location === to || (to !== "/" && location.startsWith(to));
          return (
            <Link
              key={to}
              href={to}
              className={`flex flex-col items-center gap-0.5 rounded-md px-3 py-2 text-xs font-medium transition-colors sm:flex-row sm:gap-2 sm:my-1 sm:text-sm ${
                active ? "bg-moss/10 text-moss" : "text-ink/60 hover:text-ink"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
