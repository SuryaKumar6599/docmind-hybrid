import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useLocation } from "wouter";
import { Search, FileText, Briefcase, Sparkles, LayoutDashboard } from "lucide-react";
import { supabase } from "../lib/supabase";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const [apps, setApps] = useState<{ id: string; company_name: string; role: string }[]>([]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (open) {
      supabase
        .from("job_applications")
        .select("id, company_name, role")
        .order("created_at", { ascending: false })
        .limit(10)
        .then(({ data }) => {
          if (data) setApps(data);
        });
    }
  }, [open]);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <>
      <div 
        className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} 
        onClick={() => setOpen(false)} 
      />
      
      <div className={`fixed left-[50%] top-[20%] z-50 w-full max-w-xl -translate-x-[50%] transition-all ${open ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-95"}`}>
        <Command
          className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-[#1a1a1a] dark:ring-white/10"
          shouldFilter={true}
        >
          <div className="flex items-center border-b border-black/5 px-3 dark:border-white/5">
            <Search className="mr-2 h-4 w-4 shrink-0 text-ink/40" />
            <Command.Input
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-ink/40 dark:text-cream dark:placeholder:text-cream/40"
              placeholder="Type a command or search..."
              autoFocus={open}
            />
          </div>
          
          <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-2">
            <Command.Empty className="py-6 text-center text-sm text-ink/40">
              No results found.
            </Command.Empty>

            <Command.Group heading={<div className="px-2 py-1.5 text-xs font-semibold text-ink/40">Navigation</div>}>
              <Command.Item
                onSelect={() => runCommand(() => setLocation("/tracker"))}
                className="flex cursor-pointer select-none items-center rounded-lg px-2 py-2 text-sm text-ink aria-selected:bg-ink/5 dark:text-cream dark:aria-selected:bg-cream/5"
              >
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Job Tracker
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => setLocation("/resumes"))}
                className="flex cursor-pointer select-none items-center rounded-lg px-2 py-2 text-sm text-ink aria-selected:bg-ink/5 dark:text-cream dark:aria-selected:bg-cream/5"
              >
                <FileText className="mr-2 h-4 w-4" />
                My Resumes
              </Command.Item>
              <Command.Item
                onSelect={() => runCommand(() => setLocation("/convert"))}
                className="flex cursor-pointer select-none items-center rounded-lg px-2 py-2 text-sm text-ink aria-selected:bg-ink/5 dark:text-cream dark:aria-selected:bg-cream/5"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Markdown & XML Generator
              </Command.Item>
            </Command.Group>

            {apps.length > 0 && (
              <Command.Group heading={<div className="px-2 py-1.5 text-xs font-semibold text-ink/40 mt-2">Recent Applications</div>}>
                {apps.map((app) => (
                  <Command.Item
                    key={app.id}
                    value={`${app.company_name} ${app.role}`}
                    onSelect={() => runCommand(() => {
                      // Navigate to tracker if not there, then ideally open the app.
                      // For now, just navigate to tracker. (Could pass a query param ?app=id)
                      setLocation(`/tracker?app=${app.id}`);
                    })}
                    className="flex cursor-pointer select-none items-center rounded-lg px-2 py-2 text-sm text-ink aria-selected:bg-ink/5 dark:text-cream dark:aria-selected:bg-cream/5"
                  >
                    <Briefcase className="mr-2 h-4 w-4 text-ink/40" />
                    <span className="font-medium">{app.company_name}</span>
                    <span className="ml-2 text-ink/50 dark:text-cream/50">{app.role}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </>
  );
}
