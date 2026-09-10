import type { Hono } from "hono";
import { currentUser } from "./helpers";

type App = Hono<{ Bindings: Env }>;

/**
 * Where the academy trains.
 *
 * One list, read by everything that has to name a branch: the filter above the
 * intake queue, and the form that says which branch a squad trains at. Both
 * stored the branch as text before this existed, which was fine for recording
 * what somebody chose and useless for offering the choice — nothing could say
 * which branches there are, only which had already been typed.
 *
 * Anything already recorded that is not on the list comes back beside it, with
 * no area. A branch that closes stops being offered while the squads and
 * applications naming it stay findable, which a list read only from the table
 * would lose and a list read only from the records never had.
 */
export function registerBranchRoutes(app: App): void {
  app.get("/api/v1/branches", async (c) => {
    // Any signed-in account may read where the academy trains; it is on the
    // public application form. Nothing here is anybody's private business.
    await currentUser(c);
    const [branches, used] = await Promise.all([
      c.env.DB.prepare("SELECT name, area FROM branches WHERE is_active=1 ORDER BY sort_order, name").all<{ name: string; area: string }>(),
      c.env.DB.prepare(`SELECT DISTINCT branch FROM (
          SELECT branch FROM newcomer_applications WHERE branch IS NOT NULL AND branch <> ''
          UNION SELECT branch FROM teams WHERE branch IS NOT NULL AND branch <> ''
        ) ORDER BY branch COLLATE NOCASE`).all<{ branch: string }>(),
    ]);
    const known = new Set(branches.results.map((row) => row.name));
    return c.json({
      items: [
        ...branches.results.map((row) => ({ name: row.name, area: row.area })),
        ...used.results.filter((row) => !known.has(row.branch)).map((row) => ({ name: row.branch, area: null })),
      ],
    });
  });
}
