// Public Supabase settings. The publishable key is designed to ship in browser code;
// row-level security in the database decides what each signed-in user can read or write.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://oobanimkfekkyejekgjb.supabase.co";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_1Fn-xqYK2Vt2QKT-_IDEzg_iuAVLmEN";
export const DEFAULT_MODEL = "claude-sonnet-5-5";
