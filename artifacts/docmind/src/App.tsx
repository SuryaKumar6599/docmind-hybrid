import { Switch, Route, Router as WouterRouter } from "wouter";
import { Nav } from "@/components/nav";
import Resumes from "@/pages/resumes";
import Tracker from "@/pages/tracker";
import Convert from "@/pages/convert";
import { Toaster } from "sonner";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeProvider } from "next-themes";

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => {
        window.location.replace("/tracker");
        return null;
      }} />
      <Route path="/resumes" component={Resumes} />
      <Route path="/tracker" component={Tracker} />
      <Route path="/convert" component={Convert} />
      <Route>
        <div className="flex min-h-screen items-center justify-center text-ink/40">
          Page not found
        </div>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <div className="flex min-h-screen flex-col sm:flex-row bg-cream dark:bg-[#0f1115] text-ink dark:text-cream transition-colors duration-300">
          <Nav />
          <div className="flex-1 flex flex-col min-w-0 pb-16 sm:pb-0 h-screen overflow-y-auto">
            <Router />
          </div>
        </div>
        <Toaster position="bottom-right" />
        <CommandPalette />
      </WouterRouter>
    </ThemeProvider>
  );
}
