import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fjexweubnccjrinhxrct.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_DRZfiimKuXLYdLvE-7iVxQ_yZLMr2OS';

export const supabase = createClient(supabaseUrl, supabaseKey);
