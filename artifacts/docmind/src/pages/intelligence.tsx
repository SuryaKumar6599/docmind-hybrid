import { useEffect, useRef, useState, useCallback } from "react";
import {
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  ExternalLink,
  FileText,
  Github,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import {
  supabase,
  isSupabaseConfigured,
  type Resume,
  type Stage1Analysis,
  type Stage2Content,
  type RewrittenBullet,
} from "../lib/supabase";
import { useApiUrl } from "../lib/useApiUrl";

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.detail) detail = String(errJson.detail);
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── GitHub types ──────────────────────────────────────────────────────────────
interface GithubRepo {
  id: number;
  name: string;
  description: string | null;
  html_url: string;
  topics: string[];
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  fork: boolean;
}

interface SkillProject {
  skill: string;
  repo: GithubRepo;
  relevanceScore: number;
}

// ── skill-to-repo matching ───────────────────────────────────────────────────
const SKILL_ALIASES: Record<string, string[]> = {
  "react": ["react", "reactjs", "next", "nextjs"],
  "python": ["python", "django", "flask", "fastapi"],
  "typescript": ["typescript", "ts"],
  "machine learning": ["ml", "machine-learning", "sklearn", "pytorch", "tensorflow", "keras"],
  "deep learning": ["deep-learning", "neural", "pytorch", "tensorflow"],
  "data science": ["data-science", "pandas", "numpy", "jupyter", "analysis"],
  "sql": ["sql", "postgres", "mysql", "database", "db"],
  "docker": ["docker", "containerization", "kubernetes"],
  "aws": ["aws", "amazon", "s3", "ec2", "lambda"],
  "node": ["node", "nodejs", "express", "backend"],
  "go": ["golang", "go-lang"],
  "rust": ["rust", "wasm"],
  "api": ["api", "rest", "graphql", "fastapi", "flask"],
  "nlp": ["nlp", "text", "bert", "transformers", "llm"],
  "llm": ["llm", "langchain", "openai", "gpt", "gemini", "ollama"],
  "rag": ["rag", "retrieval", "vector", "embedding", "semantic"],
};

function matchSkillToRepos(skill: string, repos: GithubRepo[]): SkillProject[] {
  const lower = skill.toLowerCase();
  const aliases = SKILL_ALIASES[lower] ?? [lower];

  return repos
    .filter((r) => !r.fork)
    .map((repo) => {
      const searchable = [
        repo.name,
        repo.description ?? "",
        ...repo.topics,
        repo.language ?? "",
      ].join(" ").toLowerCase();

      let score = 0;
      for (const alias of aliases) {
        if (searchable.includes(alias)) score += alias === lower ? 3 : 1;
      }
      if (repo.topics.some((t) => aliases.includes(t.toLowerCase()))) score += 2;

      return { skill, repo, relevanceScore: score };
    })
    .filter((m) => m.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 2);
}

// ── Resume section parser (simple markdown) ───────────────────────────────────
interface ResumeSection {
  heading: string;
  content: string;
  isExperience: boolean;
  isProjects: boolean;
}

function parseResumeSections(markdown: string): ResumeSection[] {
  const lines = markdown.split("\n");
  const sections: ResumeSection[] = [];
  let current: ResumeSection | null = null;

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      if (current) sections.push(current);
      const heading = line.replace(/^#+\s*/, "");
      current = {
        heading,
        content: "",
        isExperience: /experience|work|employment|career/i.test(heading),
        isProjects: /project|portfolio|work/i.test(heading),
      };
    } else if (current) {
      current.content += line + "\n";
    }
  }
  if (current) sections.push(current);
  return sections;
}

// ── Session State Hook ────────────────────────────────────────────────────────
function useSessionState<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = window.sessionStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);

  return [state, setState];
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Intelligence() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useSessionState<string>("docmind_resumeId", "");
  const [jdText, setJdText] = useSessionState("docmind_jdText", "");
  const [company, setCompany] = useSessionState("docmind_company", "");
  const [role, setRole] = useSessionState("docmind_role", "");

  const [analyzing, setAnalyzing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const API_URL = useApiUrl();

  const isConfigured = Boolean(API_URL) && isSupabaseConfigured;
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useSessionState<Stage1Analysis | null>("docmind_analysis", null);
  const [tailoredContent, setTailoredContent] = useSessionState<Stage2Content | null>("docmind_tailored", null);

  const [editedSummary, setEditedSummary] = useSessionState("docmind_summary", "");
  const [editedBullets, setEditedBullets] = useSessionState<RewrittenBullet[]>("docmind_bullets", []);

  // GitHub integration
  const [githubUsername, setGithubUsername] = useSessionState("docmind_githubUsername", "");
  const [githubRepos, setGithubRepos] = useSessionState<GithubRepo[]>("docmind_githubRepos", []);
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [skillProjects, setSkillProjects] = useState<SkillProject[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [projectsAdded, setProjectsAdded] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useSessionState<"editor" | "preview">("docmind_activeTab", "editor");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const selectedResume = resumes.find((r) => r.id === selectedResumeId) ?? null;
  const resumeSections = selectedResume?.markdown_content
    ? parseResumeSections(selectedResume.markdown_content)
    : [];

  useEffect(() => {
    if (isSupabaseConfigured) fetchResumes();
  }, []);

  // Warn before closing if there is active work
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (analysis || jdText.length > 50) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [analysis, jdText]);

  // Auto-compute skill→project matches when analysis or repos change
  useEffect(() => {
    if (!analysis?.missing_keywords?.length || !githubRepos.length) {
      setSkillProjects([]);
      return;
    }
    const matches: SkillProject[] = [];
    for (const skill of analysis.missing_keywords) {
      matches.push(...matchSkillToRepos(skill, githubRepos));
    }
    // Deduplicate by repo id
    const seen = new Set<number>();
    const unique = matches.filter((m) => {
      if (seen.has(m.repo.id)) return false;
      seen.add(m.repo.id);
      return true;
    });
    setSkillProjects(unique);
  }, [analysis, githubRepos]);

  async function fetchResumes() {
    const { data } = await supabase
      .from("resumes")
      .select("*")
      .eq("status", "ready")
      .order("created_at", { ascending: false });
    if (data) setResumes(data as Resume[]);
  }

  async function fetchGithubRepos() {
    if (!githubUsername.trim()) return;
    setFetchingRepos(true);
    setRepoError(null);
    try {
      const res = await fetch(
        `https://api.github.com/users/${githubUsername.trim()}/repos?per_page=100&sort=updated`
      );
      if (!res.ok) throw new Error(`GitHub: ${res.status} ${res.statusText}`);
      const data: GithubRepo[] = await res.json();
      setGithubRepos(data);
    } catch (e) {
      setRepoError(e instanceof Error ? e.message : "Failed to fetch repos");
    } finally {
      setFetchingRepos(false);
    }
  }

  async function analyzeAndTailor() {
    if (!selectedResumeId || !jdText.trim()) {
      setError("Please select a resume and paste a Job Description.");
      return;
    }
    if (!company.trim() || !role.trim()) {
      setError("Please fill in Company and Role.");
      return;
    }
    if (!API_URL) {
      setError("Backend not connected — start the local backend first.");
      return;
    }

    const resume = resumes.find((r) => r.id === selectedResumeId);
    if (!resume?.markdown_content) {
      setError("Selected resume has no extracted content. Re-upload and wait for processing.");
      return;
    }

    const cacheKey = `ai_cache_${selectedResumeId}_${company.trim()}_${role.trim()}_${jdText.length}`;
    const cachedStr = window.sessionStorage.getItem(cacheKey);
    if (cachedStr) {
      try {
        const cached = JSON.parse(cachedStr);
        setAnalysis(cached.analysisData);
        setTailoredContent(cached.tailoredData);
        setEditedSummary(cached.tailoredData.tailored_summary);
        setEditedBullets(cached.tailoredData.rewritten_bullets);
        setActiveTab("editor");
        return;
      } catch (e) {}
    }

    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setTailoredContent(null);
    setSkillProjects([]);
    setSelectedProjects(new Set());
    setProjectsAdded(false);

    try {
      // Stage 1: Gap Analysis
      const analysisData = await fetchJson<Stage1Analysis>(`${API_URL}/extract-skills`, {
        resume_text: resume.markdown_content,
        jd_text: jdText,
      });
      setAnalysis(analysisData);

      // Stage 2: Tailored Content
      const tailoredData = await fetchJson<Stage2Content>(`${API_URL}/generate-tailored`, {
        resume_text: resume.markdown_content,
        analysis: analysisData,
        company,
        role,
      });
      setTailoredContent(tailoredData);
      setEditedSummary(tailoredData.tailored_summary);
      setEditedBullets(tailoredData.rewritten_bullets);

      try {
        window.sessionStorage.setItem(
          cacheKey,
          JSON.stringify({ analysisData, tailoredData })
        );
      } catch (e) {}

      setActiveTab("editor");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleProjectSelection(repoName: string) {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(repoName)) next.delete(repoName);
      else next.add(repoName);
      return next;
    });
  }

  function injectSelectedProjects() {
    if (!selectedProjects.size) return;
    const selected = skillProjects.filter((p) => selectedProjects.has(p.repo.name));

    // Build a project bullets block
    const projectLines = selected
      .map(
        (p) =>
          `• ${p.repo.name}${p.repo.description ? ` — ${p.repo.description}` : ""} [${p.skill}]`
      )
      .join("\n");

    // Inject after the last bullet
    setEditedBullets((prev) => [
      ...prev,
      ...selected.map((p) => ({
        original: "",
        rewritten: `${p.repo.name}: ${p.repo.description ?? p.skill} — demonstrates ${p.skill}`,
        priority: 1,
      })),
    ]);

    // Mark injected
    setProjectsAdded(true);
    setSelectedProjects(new Set());
  }

  function handleBulletChange(idx: number, newText: string) {
    setEditedBullets((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], rewritten: newText };
      return updated;
    });
  }

  function removeBullet(idx: number) {
    setEditedBullets((prev) => prev.filter((_, i) => i !== idx));
  }

  async function downloadDocx() {
    if (!tailoredContent || !API_URL) return;
    const resume = resumes.find((r) => r.id === selectedResumeId);
    const candidateName = resume?.original_filename?.replace(/\.[^.]+$/, "") || "Candidate";

    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/export-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: {
            ...tailoredContent,
            tailored_summary: editedSummary,
            rewritten_bullets: editedBullets,
          },
          candidate_name: candidateName,
          company,
          role,
        }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson?.detail) detail = String(errJson.detail);
        } catch {}
        throw new Error(detail);
      }
      const blob = await res.blob();
      const dateStr = new Date().toISOString().split("T")[0];
      const safe = company.replace(/\s+/g, "_").replace(/\//g, "-");
      triggerDownload(blob, `Tailored_Resume_${safe}_${dateStr}.docx`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  const canAnalyze = !analyzing && !!selectedResumeId && !!jdText && !!company && !!role;

  const scoreColor =
    !analysis
      ? ""
      : analysis.match_score >= 70
      ? "text-moss"
      : analysis.match_score >= 45
      ? "text-amber-500"
      : "text-red-500";

  const scoreBg =
    !analysis
      ? ""
      : analysis.match_score >= 70
      ? "bg-moss"
      : analysis.match_score >= 45
      ? "bg-amber-500"
      : "bg-red-500";

  return (
    <div className="min-h-screen py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* ── Header ── */}
        <header className="mb-6 border-b border-ink/10 pb-5">
          <p className="text-sm font-semibold text-moss">DocMind</p>
          <h1 className="mt-1 text-3xl font-semibold text-ink">Resume Intelligence</h1>
          <p className="mt-1 text-sm text-ink/60">
            AI-powered gap analysis · GitHub project injection · Live editing
          </p>
        </header>

        {/* ── Errors ── */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* ══════════════════════════════════════════════════════
               LEFT PANEL — Inputs + Gap Analysis + GitHub
          ══════════════════════════════════════════════════════ */}
          <div className="space-y-5">
            {/* ── Step 1: Inputs ── */}
            <section className="rounded-lg border border-ink/10 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-moss text-xs font-bold text-white">1</span>
                <h2 className="font-semibold text-ink">Setup</h2>
              </div>

              {/* Resume selector */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Base Resume
                </label>
                <select
                  id="resume-select"
                  className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink focus:border-moss/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-moss/20 disabled:opacity-50"
                  value={selectedResumeId}
                  onChange={(e) => setSelectedResumeId(e.target.value)}
                  disabled={!isSupabaseConfigured}
                >
                  <option value="">— Choose a processed resume —</option>
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.original_filename}
                    </option>
                  ))}
                </select>
                {isSupabaseConfigured && resumes.length === 0 && (
                  <p className="mt-1.5 text-xs text-ink/40">
                    No processed resumes yet.{" "}
                    <a href="/resumes" className="text-moss underline">Upload one →</a>
                  </p>
                )}
              </div>

              {/* Company + Role */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/60">Company</label>
                  <input
                    id="company-input"
                    type="text"
                    placeholder="Google"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-moss/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-moss/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/60">Role</label>
                  <input
                    id="role-input"
                    type="text"
                    placeholder="Senior Engineer"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-moss/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-moss/20"
                  />
                </div>
              </div>

              {/* JD */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Job Description
                </label>
                <textarea
                  id="jd-textarea"
                  className="h-36 w-full resize-none rounded-lg border border-ink/10 bg-ink/5 p-3 text-sm text-ink placeholder:text-ink/30 focus:border-moss/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-moss/20"
                  placeholder="Paste the full job description here…"
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                />
              </div>

              <button
                id="analyze-btn"
                onClick={analyzeAndTailor}
                disabled={!canAnalyze}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-moss py-3 text-sm font-semibold text-white shadow-md shadow-sm transition hover:bg-moss/90  disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {analyzing ? (
                  <><Loader2 size={16} className="animate-spin" /> Analyzing… (30–60 s)</>
                ) : (
                  <><Wand2 size={16} /> Analyze &amp; Tailor Resume</>
                )}
              </button>
            </section>

            {/* ── Step 2: Gap Analysis ── */}
            {analysis && (
              <section className="rounded-lg border border-ink/10 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-moss text-xs font-bold text-white">2</span>
                  <h2 className="font-semibold text-ink">Gap Analysis</h2>
                </div>

                {/* Score ring */}
                <div className="mb-5 flex items-center gap-4 rounded-lg bg-ink/5 p-4">
                  <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
                    <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="15.9" fill="none"
                        stroke={analysis.match_score >= 70 ? "#10b981" : analysis.match_score >= 45 ? "#f59e0b" : "#ef4444"}
                        strokeWidth="3"
                        strokeDasharray={`${analysis.match_score} ${100 - analysis.match_score}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className={`text-xl font-bold ${scoreColor}`}>{analysis.match_score}%</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Match Score</p>
                    {analysis.one_line_pitch && (
                      <p className="mt-1 text-sm italic text-ink/70">{analysis.one_line_pitch}</p>
                    )}
                  </div>
                </div>

                {/* Matched skills */}
                <div className="mb-4">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-moss">
                    <CheckCircle2 size={12} /> Matched ({analysis.matched_skills.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.matched_skills.map((s, i) => (
                      <span key={i} className="rounded-full bg-moss/10 px-2.5 py-0.5 text-xs font-medium text-moss">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Missing skills */}
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600">
                    <AlertCircle size={12} /> Missing ({analysis.missing_keywords.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.missing_keywords.map((s, i) => (
                      <span key={i} className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ── Step 3: GitHub Project Injection ── */}
            {analysis && (
              <section className="rounded-lg border border-ink/10 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-moss/90 text-xs font-bold text-white">3</span>
                  <h2 className="font-semibold text-ink">GitHub Projects</h2>
                </div>
                <p className="mb-3 text-xs text-ink/60">
                  Fetch your repos. We'll find which ones cover the missing skills above and inject them as project bullets.
                </p>

                <div className="mb-3 flex gap-2">
                  <div className="relative flex-1">
                    <Github size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
                    <input
                      type="text"
                      placeholder="your-github-username"
                      value={githubUsername}
                      onChange={(e) => setGithubUsername(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && fetchGithubRepos()}
                      className="w-full rounded-lg border border-ink/10 bg-ink/5 py-2 pl-8 pr-3 text-sm text-ink placeholder:text-ink/30 focus:border-ink/30 focus:bg-white focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={fetchGithubRepos}
                    disabled={!githubUsername.trim() || fetchingRepos}
                    className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm font-medium text-ink/80 hover:bg-ink/10 disabled:opacity-50"
                  >
                    {fetchingRepos ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Fetch
                  </button>
                </div>

                {repoError && (
                  <p className="mb-3 text-xs text-red-500">{repoError}</p>
                )}

                {githubRepos.length > 0 && (
                  <p className="mb-3 text-xs text-ink/60">
                    {githubRepos.length} repos fetched. {skillProjects.length} match missing skills.
                  </p>
                )}

                {skillProjects.length > 0 && (
                  <div className="space-y-2">
                    {skillProjects.map((sp) => (
                      <label
                        key={sp.repo.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                          selectedProjects.has(sp.repo.name)
                            ? "border-moss/40 bg-moss/10"
                            : "border-ink/10 bg-white hover:border-ink/20"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-emerald-500"
                          checked={selectedProjects.has(sp.repo.name)}
                          onChange={() => toggleProjectSelection(sp.repo.name)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink truncate">{sp.repo.name}</span>
                            <a
                              href={sp.repo.html_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-ink/40 hover:text-ink/70"
                            >
                              <ExternalLink size={11} />
                            </a>
                          </div>
                          {sp.repo.description && (
                            <p className="mt-0.5 text-xs text-ink/60 line-clamp-2">{sp.repo.description}</p>
                          )}
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              fills: {sp.skill}
                            </span>
                            {sp.repo.language && (
                              <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-medium text-ink/70">
                                {sp.repo.language}
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}

                    <button
                      onClick={injectSelectedProjects}
                      disabled={!selectedProjects.size}
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-moss py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90 disabled:opacity-40"
                    >
                      <Zap size={14} />
                      Inject {selectedProjects.size > 0 ? selectedProjects.size : ""} Project{selectedProjects.size !== 1 ? "s" : ""} into Resume
                    </button>

                    {projectsAdded && (
                      <p className="text-center text-xs text-moss">
                        ✓ Projects added to Experience Bullets section
                      </p>
                    )}
                  </div>
                )}

                {githubRepos.length > 0 && skillProjects.length === 0 && (
                  <div className="rounded-lg border border-ink/10 bg-ink/5 p-4 text-center text-xs text-ink/40">
                    <Code2 size={20} className="mx-auto mb-2 opacity-40" />
                    No repos matched the missing skills. Add projects covering: {analysis.missing_keywords.slice(0, 3).join(", ")}…
                  </div>
                )}
              </section>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════
               RIGHT PANEL — Live Resume Editor / Preview
          ══════════════════════════════════════════════════════ */}
          <div className="flex flex-col">
            <div className="sticky top-4 flex flex-col rounded-lg border border-ink/10 bg-white shadow-sm" style={{ minHeight: "80vh" }}>
              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-ink/10 px-5 pt-4">
                <button
                  onClick={() => setActiveTab("editor")}
                  className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium transition ${
                    activeTab === "editor"
                      ? "border-b-2 border-moss/50 text-moss"
                      : "text-ink/60 hover:text-ink/80"
                  }`}
                >
                  <Wand2 size={14} /> AI Editor
                  {tailoredContent && (
                    <span className="ml-1 rounded-full bg-moss/20 px-1.5 py-0.5 text-[10px] font-bold text-moss">
                      LIVE
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("preview")}
                  className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium transition ${
                    activeTab === "preview"
                      ? "border-b-2 border-moss/50 text-moss"
                      : "text-ink/60 hover:text-ink/80"
                  }`}
                >
                  <FileText size={14} /> Base Resume
                  {selectedResume && (
                    <span className="ml-1 rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] font-medium text-ink/70">
                      {selectedResume.original_filename.split(".")[0].slice(0, 12)}
                    </span>
                  )}
                </button>
                {tailoredContent && (
                  <button
                    onClick={downloadDocx}
                    disabled={downloading}
                    className="ml-auto flex items-center gap-1.5 rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-moss/90 disabled:opacity-50"
                  >
                    {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    Export DOCX
                  </button>
                )}
              </div>

              {/* ── EDITOR TAB ── */}
              {activeTab === "editor" && (
                <div className="flex-1 overflow-y-auto p-5">
                  {tailoredContent ? (
                    <div className="space-y-6">
                      {/* Summary */}
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <Target size={14} className="text-moss" />
                          <label className="text-sm font-semibold text-ink">
                            Professional Summary
                            <span className="ml-2 text-xs font-normal text-moss">(AI-tailored · editable)</span>
                          </label>
                        </div>
                        <textarea
                          id="summary-editor"
                          value={editedSummary}
                          onChange={(e) => setEditedSummary(e.target.value)}
                          className="h-32 w-full resize-none rounded-lg border border-ink/10 bg-ink/5 p-3 text-sm leading-relaxed text-ink transition focus:border-moss/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-moss/20"
                        />
                      </div>

                      {/* Bullets */}
                      <div>
                        <div className="mb-3 flex items-center gap-2">
                          <Sparkles size={14} className="text-moss" />
                          <label className="text-sm font-semibold text-ink">
                            Experience &amp; Project Bullets
                            <span className="ml-2 text-xs font-normal text-ink/40">
                              {editedBullets.length} bullet{editedBullets.length !== 1 ? "s" : ""}
                            </span>
                          </label>
                        </div>
                        <div className="space-y-2.5">
                          {editedBullets.map((bullet, idx) => (
                            <div key={idx} className="group relative">
                              <div className="flex items-start gap-2">
                                <span className="mt-3.5 shrink-0 text-moss/80">•</span>
                                <textarea
                                  id={`bullet-editor-${idx}`}
                                  value={bullet.rewritten}
                                  onChange={(e) => handleBulletChange(idx, e.target.value)}
                                  className="flex-1 resize-none rounded-lg border border-ink/10 bg-ink/5 p-3 text-sm leading-relaxed text-ink transition focus:border-moss/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-moss/20"
                                  rows={2}
                                />
                                <button
                                  onClick={() => removeBullet(idx)}
                                  className="mt-3 shrink-0 rounded-md p-1 text-ink/30 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                              {bullet.original === "" && (
                                <span className="ml-5 text-[10px] font-semibold text-moss">
                                  ✦ GitHub project injected
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Skills to add */}
                      {tailoredContent.skills_to_add?.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <Zap size={14} className="text-amber-500" />
                            <label className="text-sm font-semibold text-ink">Suggested Skills to Add</label>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {tailoredContent.skills_to_add.map((s, i) => (
                              <span key={i} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                + {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Cover letter opener */}
                      {tailoredContent.cover_letter_opening && (
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <FileText size={14} className="text-ink/60" />
                            <label className="text-sm font-semibold text-ink">Cover Letter Opening</label>
                          </div>
                          <div className="rounded-lg border border-ink/10 bg-ink/5 p-4 text-sm italic leading-relaxed text-ink/70">
                            {tailoredContent.cover_letter_opening}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <div className="text-center">
                        {analyzing ? (
                          <div className="mx-auto w-full max-w-md space-y-5 text-left">
                            <div className="flex items-center justify-center mb-8">
                              <Loader2 className="mr-3 animate-spin text-moss" size={24} />
                              <div className="text-center">
                                <span className="block text-sm font-semibold text-moss">AI is tailoring your resume</span>
                                <span className="text-xs text-ink/40">Evaluating gap analysis against JD…</span>
                              </div>
                            </div>
                            <div className="h-4 w-1/3 animate-pulse rounded bg-ink/20" />
                            <div className="h-28 w-full animate-pulse rounded-lg bg-ink/10" />
                            <div className="mt-8 h-4 w-1/4 animate-pulse rounded bg-ink/20" />
                            <div className="space-y-3">
                              <div className="h-12 w-full animate-pulse rounded-lg bg-ink/10" />
                              <div className="h-12 w-full animate-pulse rounded-lg bg-ink/10" />
                              <div className="h-12 w-4/5 animate-pulse rounded-lg bg-ink/10" />
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-ink/10">
                              <Wand2 className="text-ink/40" size={28} />
                            </div>
                            <p className="text-sm font-medium text-ink/70">No content yet</p>
                            <p className="mt-1 text-xs text-ink/40">
                              Select a resume, paste a JD, and hit Analyze
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── PREVIEW TAB — Base resume sections ── */}
              {activeTab === "preview" && (
                <div className="flex-1 overflow-y-auto p-5">
                  {selectedResume ? (
                    <div className="space-y-3">
                      <div className="mb-4 rounded-lg border border-moss/20 bg-moss/10 px-4 py-3 text-xs text-moss">
                        <strong>Base template:</strong> {selectedResume.original_filename} — this content is preserved as-is. AI tailoring adds to it, not replaces it.
                      </div>
                      {resumeSections.length > 0 ? (
                        resumeSections.map((section, i) => {
                          const isOpen = expandedSection === section.heading;
                          const hasAiChanges =
                            tailoredContent &&
                            (section.isExperience || section.isProjects);

                          return (
                            <div
                              key={i}
                              className={`overflow-hidden rounded-lg border transition ${
                                hasAiChanges
                                  ? "border-moss/20 bg-moss/10/50"
                                  : "border-ink/10 bg-white"
                              }`}
                            >
                              <button
                                className="flex w-full items-center justify-between px-4 py-3 text-left"
                                onClick={() => setExpandedSection(isOpen ? null : section.heading)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-ink">
                                    {section.heading}
                                  </span>
                                  {hasAiChanges && (
                                    <span className="rounded-full bg-moss px-2 py-0.5 text-[10px] font-bold text-white">
                                      AI ENHANCED
                                    </span>
                                  )}
                                </div>
                                {isOpen ? (
                                  <ChevronDown size={14} className="text-ink/40" />
                                ) : (
                                  <ChevronRight size={14} className="text-ink/40" />
                                )}
                              </button>
                              {isOpen && (
                                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink/70">
                                    {section.content.trim()}
                                  </pre>
                                  {hasAiChanges && editedBullets.length > 0 && (
                                    <div className="mt-3 border-t border-moss/20 pt-3">
                                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-moss">
                                        ✦ AI-Added Bullets
                                      </p>
                                      <div className="space-y-1.5">
                                        {editedBullets.slice(0, 3).map((b, bi) => (
                                          <p key={bi} className="text-xs leading-relaxed text-moss">
                                            • {b.rewritten}
                                          </p>
                                        ))}
                                        {editedBullets.length > 3 && (
                                          <p className="text-xs text-moss">
                                            +{editedBullets.length - 3} more in Editor tab
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <pre className="rounded-lg bg-ink/5 p-4 text-xs leading-relaxed text-ink/70 whitespace-pre-wrap">
                          {selectedResume.markdown_content}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <div className="text-center">
                        <FileText className="mx-auto mb-3 text-slate-200" size={36} />
                        <p className="text-sm text-ink/40">Select a resume to preview</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
