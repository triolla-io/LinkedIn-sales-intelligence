import { handlers } from "@/lib/auth";

// Destructure so GET and POST are the actual handler functions, not the handlers object.
// @ts-ignore — NextAuth v5 beta type doesn't match Next.js 16 route constraint.
export const { GET, POST } = handlers;
