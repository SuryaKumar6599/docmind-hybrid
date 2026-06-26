import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[DocMind] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set. " +
      "Supabase features (resumes, tracker) will be unavailable."
  );
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder"
);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// ---------------------------------------------------------------------------
// Types (mirrors supabase/schema.sql)
// ---------------------------------------------------------------------------

export type ResumeStatus =
  | "pending_processing"
  | "processing"
  | "ready"
  | "error";

export type ApplicationStatus =
  | "to_apply"
  | "pending_processing"
  | "processing"
  | "stage1_complete"
  | "ready"
  | "error"
  | "applied"
  | "interview"
  | "offer"
  | "rejected";

export interface Resume {
  id: string;
  user_id: string;
  original_filename: string;
  storage_path: string;
  status: ResumeStatus;
  document_id: string | null;
  chunk_count: number | null;
  markdown_content: string | null;
  parent_resume_id: string | null;
  error_message: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Stage1Analysis {
  missing_keywords: string[];
  matched_skills: string[];
  match_score: number;
  recommended_projects: Array<{
    project_name: string;
    relevance_reason: string;
    suggested_highlight: string;
  }>;
  core_highlights: string[];
  one_line_pitch: string;
}

export interface RewrittenBullet {
  original: string;
  rewritten: string;
  priority: number;
  is_github_injection?: boolean;
}


export interface Stage2Content {
  tailored_summary: string;
  rewritten_bullets: RewrittenBullet[];
  skills_to_add: string[];
  cover_letter_opening: string;
}

export interface JobApplication {
  id: string;
  user_id: string;
  resume_id: string;
  company_name: string;
  role: string;
  jd_url: string | null;
  jd_storage_path: string | null;
  jd_content: string | null;
  status: ApplicationStatus;
  application_date: string | null;
  match_score: number | null;
  stage1_analysis: Stage1Analysis | null;
  stage2_content: Stage2Content | null;
  docx_url: string | null;
  pdf_url: string | null;
  notes: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
