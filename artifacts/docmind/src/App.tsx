import { Switch, Route, Router as WouterRouter } from "wouter";
import { Nav } from "@/components/nav";
import Home from "@/pages/home";
import Resumes from "@/pages/resumes";
import Tracker from "@/pages/tracker";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/resumes" component={Resumes} />
      <Route path="/tracker" component={Tracker} />
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
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <div className="flex min-h-screen flex-col">
        <Nav />
        <div className="flex-1 pb-16 sm:pb-0">
          <Router />
        </div>
      </div>
    </WouterRouter>
  );
}
