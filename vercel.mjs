import { createVercelConfig } from "./hosting/vercel-config.mjs";

export const config = createVercelConfig(process.env.RAILWAY_API_URL);
