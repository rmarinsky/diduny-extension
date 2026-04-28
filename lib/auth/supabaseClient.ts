import { createClient } from "@supabase/supabase-js";
import { chromeStorageAdapter } from "./chromeStorageAdapter";

/**
 * Supabase project coordinates — safe to embed in client bundles.
 * Per ADR-0003: publishable key (anon key equivalent in new key format)
 * is designed for client-side use. Never use the secret key here.
 *
 * Per ADR-0005: singleton lives in the service worker. The chrome.storage.local
 * adapter persists session state across SW suspension cycles.
 */
const SUPABASE_URL = "https://oplmqfsttetsosglilkb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
	"sb_publishable_kLAVgHi1AGvXF_ZTdAdaEA_Yyfgvv_o";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
	auth: {
		storage: chromeStorageAdapter,
		persistSession: true,
		autoRefreshToken: true,
		// Disable the built-in URL change detection — service workers have no window
		detectSessionInUrl: false,
	},
});
